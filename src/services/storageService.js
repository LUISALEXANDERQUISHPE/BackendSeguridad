const supabase = require('../config/supabase');
const config = require('../config');

const BUCKET = config.storageBucket;
// Todo se guarda cifrado: el tipo real del archivo no se expone en el bucket
const ENCRYPTED_CONTENT_TYPE = 'application/octet-stream';
const PROJECT_PATH_PATTERN = /^proyectos\/([0-9a-fA-F-]{36})\//;

// Se pide al usarse: la capa de seguridad depende de la configuración de Supabase
const dataProtection = () => require('../security').getSecurity().dataProtection;

/** Proyecto dueño de una ruta del bucket (su llave cifra el archivo). */
function projectIdFromPath(storagePath) {
  const match = PROJECT_PATH_PATTERN.exec(String(storagePath || ''));
  if (!match) throw new Error(`La ruta ${storagePath} no pertenece a ningún proyecto`);
  return match[1];
}

/**
 * Todos los archivos de un proyecto viven bajo su propia carpeta en el bucket,
 * con el mismo nombre que tienen en el sistema:
 *   proyectos/<proyecto_id>/<nombre>.tex   código fuente
 *   proyectos/<proyecto_id>/<nombre>.pdf   último PDF compilado con éxito
 * La carpeta usa el identificador del proyecto porque dos usuarios pueden tener
 * proyectos con el mismo nombre.
 */
function getProjectFolder(projectId) {
  return `proyectos/${projectId}`;
}

/**
 * Convierte un nombre de archivo en uno válido para Storage: sin tildes ni
 * caracteres que el bucket rechaza o que permitan salir de la carpeta del proyecto.
 */
function toSafeFileName(name) {
  const safeName = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\.{2,}/g, '.')
    .trim();

  return safeName && safeName !== '.' ? safeName : 'documento';
}

function getFilePath(projectId, fileName) {
  return `${getProjectFolder(projectId)}/${toSafeFileName(fileName)}`;
}

function getNestedFilePath(projectId, fileName) {
  const parts = String(fileName || '').split('/').map(toSafeFileName).filter(Boolean);
  return `${getProjectFolder(projectId)}/${parts.join('/')}`;
}

/**
 * Ruta del PDF compilado de un archivo .tex (mismo nombre, extensión .pdf)
 */
function getPdfPath(node) {
  return getFilePath(node.proyecto_id, `${node.nombre.replace(/\.tex$/i, '')}.pdf`);
}

/**
 * Sube (o reemplaza) un archivo cifrado: Huffman + AES-256-CTR con la llave de su proyecto.
 * @returns {Promise<string>} Ruta del archivo dentro del bucket
 */
async function uploadEncrypted(storagePath, bytes) {
  const sealed = await dataProtection().protectBytes(projectIdFromPath(storagePath), bytes);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, sealed, { contentType: ENCRYPTED_CONTENT_TYPE, upsert: true });
  if (error) throw error;
  return storagePath;
}

/** Sube (o reemplaza) un archivo de texto del proyecto. */
function uploadSource(storagePath, content) {
  return uploadEncrypted(storagePath, Buffer.from(content ?? '', 'utf8'));
}

/** Sube (o reemplaza) un archivo binario (imagen, PDF...). El tipo real viaja solo dentro del cifrado. */
function uploadBinary(storagePath, buffer) {
  return uploadEncrypted(storagePath, buffer);
}

/**
 * Sube (o reemplaza) el PDF compilado de un archivo .tex.
 * @param {object} node Archivo .tex compilado
 * @param {Buffer} pdfBuffer PDF en claro
 * @returns {Promise<string>} Ruta del archivo dentro del bucket
 */
function uploadPdf(node, pdfBuffer) {
  return uploadEncrypted(getPdfPath(node), pdfBuffer);
}

/** Descarga el archivo tal como está guardado (cifrado), sin descifrar. */
async function downloadRaw(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Descarga y descifra un archivo del bucket. Los archivos anteriores al cifrado se devuelven igual.
 * @returns {Promise<Buffer|null>} Contenido en claro o null si no existe
 */
async function downloadFile(storagePath) {
  const stored = await downloadRaw(storagePath);
  if (!stored) return null;
  return dataProtection().revealBytes(projectIdFromPath(storagePath), stored);
}

/**
 * Copia un archivo dentro del bucket (usado al duplicar proyectos con binarios).
 * Si cambia de proyecto se vuelve a cifrar con la llave del proyecto destino.
 */
async function copyFile(fromPath, toPath) {
  if (projectIdFromPath(fromPath) !== projectIdFromPath(toPath)) {
    const content = await downloadFile(fromPath);
    if (!content) throw new Error(`El archivo ${fromPath} no existe en Storage`);
    return uploadEncrypted(toPath, content);
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .copy(fromPath, toPath);

  if (error) throw error;
  return toPath;
}

async function moveFile(fromPath, toPath) {
  if (projectIdFromPath(fromPath) !== projectIdFromPath(toPath)) {
    await copyFile(fromPath, toPath);
    await removeFiles([fromPath]);
    return toPath;
  }
  const { error } = await supabase.storage.from(BUCKET).move(fromPath, toPath);
  if (error) throw error;
  return toPath;
}

async function removeFiles(paths) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}

/**
 * Elimina todos los archivos de la carpeta de un proyecto
 */
async function removeProjectFiles(projectId) {
  const folder = getProjectFolder(projectId);

  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET)
    .list(folder, { limit: 1000 });

  if (listError) throw listError;
  if (!files || files.length === 0) return;

  const { error: removeError } = await supabase.storage
    .from(BUCKET)
    .remove(files.map(file => `${folder}/${file.name}`));

  if (removeError) throw removeError;
}

/**
 * Guarda en el bucket el contenido vigente de un archivo de texto y registra su ruta en nodos.storage_path.
 * Si el archivo cambió de nombre, el .tex y el PDF anteriores se reemplazan por los del nombre nuevo.
 * Es tolerante a fallos: si Storage no responde, el contenido sigue a salvo en la base de datos.
 * @returns {Promise<string|null>} Ruta en el bucket o null si no se pudo sincronizar
 */
async function syncNodeSource(node, content) {
  try {
    const previousPath = node.storage_path || null;
    const parentFolder = previousPath
      ? previousPath.slice(0, previousPath.lastIndexOf('/'))
      : getProjectFolder(node.proyecto_id);
    const storagePath = await uploadSource(`${parentFolder}/${toSafeFileName(node.nombre)}`, content);

    if (previousPath !== storagePath) {
      const { error } = await supabase
        .from('nodos')
        .update({ storage_path: storagePath })
        .eq('id', node.id);

      if (error) throw error;
      node.storage_path = storagePath;

      if (previousPath) {
        // Llevar el PDF al nombre nuevo (puede no existir si nunca se compiló) y quitar el .tex anterior
        const previousPdfPath = previousPath.replace(/\.[^./]+$/, '.pdf');
        const pdfPath = getPdfPath(node);
        if (previousPdfPath !== pdfPath) {
          await supabase.storage.from(BUCKET).remove([pdfPath]);
          await supabase.storage.from(BUCKET).move(previousPdfPath, pdfPath);
        }
        await supabase.storage.from(BUCKET).remove([previousPath]);
      }
    }

    return storagePath;
  } catch (err) {
    console.warn(`Advertencia al sincronizar el archivo ${node.id} con Storage:`, err.message);
    return null;
  }
}

module.exports = {
  BUCKET,
  getProjectFolder,
  getFilePath,
  getNestedFilePath,
  getPdfPath,
  uploadSource,
  uploadBinary,
  uploadPdf,
  downloadFile,
  downloadRaw,
  projectIdFromPath,
  copyFile,
  moveFile,
  removeFiles,
  removeProjectFiles,
  syncNodeSource
};
