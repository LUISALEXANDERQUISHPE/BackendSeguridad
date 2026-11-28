const nodeCrypto = require('node:crypto');
const { NODE_TYPES } = require('../constants/projectConstants');
const { getFileType, isTextFile } = require('../utils/fileTypes');

/**
 * Construye los nodos (carpetas y archivos) de un proyecto nuevo a partir de los archivos
 * de una plantilla. Funciones puras: no acceden a la base de datos ni a Storage.
 *
 * Cada nodo recibe un identificador NUEVO: el proyecto es una copia independiente y
 * modificarlo o eliminarlo nunca afecta a la plantilla base.
 */

function parentPathOf(relativePath) {
  const index = relativePath.lastIndexOf('/');
  return index === -1 ? '' : relativePath.slice(0, index);
}

function baseNameOf(relativePath) {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

/** Lleva la posición de cada nodo dentro de su carpeta (columna "orden" del árbol de archivos). */
function createOrderCounter() {
  const nextByParent = new Map();
  return parentKey => {
    const position = nextByParent.get(parentKey) ?? 0;
    nextByParent.set(parentKey, position + 1);
    return position;
  };
}

/**
 * @param {object} params
 * @param {Array<{ path: string, content: Buffer }>} params.files Archivos de la plantilla
 * @param {string} params.mainFile Archivo .tex principal (en la raíz)
 * @param {string} params.projectId Proyecto nuevo
 * @param {string} params.userId Usuario que crea el proyecto
 * @param {() => string} [params.createId] Generador de identificadores (inyectable en pruebas)
 * @returns {{ folders: object[], files: object[], uploads: object[], mainNodeId: string|null }}
 *   folders: carpetas ordenadas de la raíz hacia adentro (cada padre antes que sus hijos)
 *   files: archivos, con el principal primero (así es el .tex principal del proyecto)
 *   uploads: contenido a guardar en Storage por cada archivo
 */
function buildTemplateCopy({ files, mainFile, projectId, userId, createId = nodeCrypto.randomUUID }) {
  const folderIds = new Map([['', null]]);
  const nextOrder = createOrderCounter();
  const folders = [];

  const ensureFolder = folderPath => {
    if (folderIds.has(folderPath)) return folderIds.get(folderPath);
    const parentId = ensureFolder(parentPathOf(folderPath));
    const id = createId();
    folderIds.set(folderPath, id);
    folders.push({
      id,
      proyecto_id: projectId,
      padre_id: parentId,
      nombre: baseNameOf(folderPath),
      tipo_nodo: NODE_TYPES.FOLDER,
      tipo_archivo: null,
      contenido_actual: null,
      tamano_bytes: null,
      creado_por: userId,
      orden: nextOrder(parentId)
    });
    return id;
  };

  // El archivo principal va primero: el proyecto toma como principal el primer .tex de la raíz
  const ordered = [...files].sort((a, b) => Number(b.path === mainFile) - Number(a.path === mainFile));

  const fileNodes = [];
  const uploads = [];
  let mainNodeId = null;

  for (const file of ordered) {
    const name = baseNameOf(file.path);
    const parentId = ensureFolder(parentPathOf(file.path));
    const isText = isTextFile(name);
    const id = createId();
    if (file.path === mainFile) mainNodeId = id;

    fileNodes.push({
      id,
      proyecto_id: projectId,
      padre_id: parentId,
      nombre: name,
      tipo_nodo: NODE_TYPES.FILE,
      tipo_archivo: getFileType(name),
      contenido_actual: isText ? file.content.toString('utf8') : null,
      tamano_bytes: file.content.length,
      creado_por: userId,
      orden: nextOrder(parentId)
    });
    uploads.push({ nodeId: id, path: file.path, isText, content: file.content });
  }

  return { folders, files: fileNodes, uploads, mainNodeId };
}

module.exports = { buildTemplateCopy };
