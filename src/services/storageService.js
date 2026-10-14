const fsp = require('fs/promises');
const supabase = require('../config/supabase');
const config = require('../config');

const BUCKET = config.storageBucket;

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

/**
 * Ruta del PDF compilado de un archivo .tex (mismo nombre, extensión .pdf)
 */
function getPdfPath(node) {
  return getFilePath(node.proyecto_id, `${node.nombre.replace(/\.tex$/i, '')}.pdf`);
}

/**
 * Sube (o reemplaza) un archivo de texto del proyecto
 * @returns {Promise<string>} Ruta del archivo dentro del bucket
 */
async function uploadSource(storagePath, content) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, Buffer.from(content ?? '', 'utf8'), {
      contentType: 'text/plain; charset=utf-8',
      upsert: true
    });

  if (error) throw error;
  return storagePath;
}

/**
 * Sube (o reemplaza) el PDF compilado a partir del archivo local generado por pdflatex
 * @returns {Promise<string>} Ruta del archivo dentro del bucket
 */
async function uploadPdf(node, localPdfPath) {
  const storagePath = getPdfPath(node);
  const pdfBuffer = await fsp.readFile(localPdfPath);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });

  if (error) throw error;
  return storagePath;
}

/**
 * Descarga un archivo del bucket
 * @returns {Promise<Buffer|null>} Contenido del archivo o null si no existe
 */
async function downloadFile(storagePath) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Copia un archivo dentro del bucket (usado al duplicar proyectos con binarios)
 */
async function copyFile(fromPath, toPath) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .copy(fromPath, toPath);

  if (error) throw error;
  return toPath;
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
    const storagePath = await uploadSource(getFilePath(node.proyecto_id, node.nombre), content);

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
  getPdfPath,
  uploadSource,
  uploadPdf,
  downloadFile,
  copyFile,
  removeProjectFiles,
  syncNodeSource
};
