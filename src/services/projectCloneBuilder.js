const nodeCrypto = require('node:crypto');
const { NODE_TYPES, FILE_TYPES } = require('../constants/projectConstants');
const { toMainFileName } = require('../validators/projectValidator');
const { isTextFile: isTextFileName } = require('../utils/fileTypes');

const MAX_FOLDER_DEPTH = 64;

/**
 * Funciones puras para construir la copia de un proyecto.
 * No acceden a la base de datos ni a Storage, por lo que se pueden probar de forma aislada.
 */

/**
 * @param {object} node
 * @returns {boolean}
 */
function isMainTexNode(node) {
  return node.tipo_nodo === NODE_TYPES.FILE && node.tipo_archivo === FILE_TYPES.TEX && !node.padre_id;
}

/**
 * Archivo editable como texto (.tex, .bib, .txt...) según su extensión.
 * Los binarios (imágenes, PDFs...) no guardan contenido en la base de datos, solo en Storage.
 * @param {object} node
 * @returns {boolean}
 */
function isTextNode(node) {
  return node.tipo_nodo === NODE_TYPES.FILE && isTextFileName(node.nombre);
}

/**
 * @param {object} node
 * @returns {boolean}
 */
function hasTextContent(node) {
  return isTextNode(node) && typeof node.contenido_actual === 'string';
}

/**
 * Genera un identificador nuevo para cada nodo de origen.
 * @param {object[]} sourceNodes
 * @returns {Map<string, string>} id origen -> id copia
 */
function buildIdMap(sourceNodes) {
  return new Map(sourceNodes.map(node => [node.id, nodeCrypto.randomUUID()]));
}

/**
 * Construye las filas de "nodos" de la copia conservando la jerarquía de carpetas.
 * Si el archivo principal llevaba el nombre del proyecto, se renombra con el nombre de la copia.
 *
 * @param {object} params
 * @param {object[]} params.sourceNodes Nodos del proyecto original
 * @param {Map<string, string>} params.idMap Relación id origen -> id copia
 * @param {object} params.sourceProject Proyecto original
 * @param {object} params.targetProject Proyecto copia ya creado
 * @param {string} params.userId Usuario que duplica
 * @returns {object[]}
 */
function buildClonedNodes({ sourceNodes, idMap, sourceProject, targetProject, userId }) {
  const sourceMainName = toMainFileName(sourceProject.nombre);
  const mainNode = sourceNodes.find(isMainTexNode);

  return sourceNodes.map(node => {
    const keepsProjectName = node === mainNode && node.nombre === sourceMainName;
    return {
      id: idMap.get(node.id),
      proyecto_id: targetProject.id,
      padre_id: node.padre_id ? (idMap.get(node.padre_id) ?? null) : null,
      nombre: keepsProjectName ? toMainFileName(targetProject.nombre) : node.nombre,
      tipo_nodo: node.tipo_nodo,
      tipo_archivo: node.tipo_archivo,
      contenido_actual: isTextNode(node) ? node.contenido_actual : null,
      // Cada copia tendrá su propio archivo en Storage (se asigna después de insertar)
      storage_path: null,
      tamano_bytes: node.tamano_bytes,
      creado_por: userId
    };
  });
}

/**
 * Snapshot inicial (versión 1) para cada archivo de texto de la copia.
 * @param {object[]} clonedNodes
 * @param {string} userId
 * @param {string} summary
 * @returns {object[]}
 */
function buildInitialVersions(clonedNodes, userId, summary) {
  return clonedNodes.filter(hasTextContent).map(node => ({
    archivo_id: node.id,
    numero_version: 1,
    contenido_snapshot: node.contenido_actual,
    modificado_por: userId,
    resumen_cambio: summary
  }));
}

/**
 * Ruta relativa de un nodo dentro del proyecto (ej. "capitulos/intro.tex"), recorriendo sus carpetas.
 * @param {object} node
 * @param {Map<string, object>} nodesById
 * @returns {string}
 */
function buildRelativePath(node, nodesById) {
  const parts = [];
  let current = node;
  while (current && parts.length < MAX_FOLDER_DEPTH) {
    parts.unshift(current.nombre);
    current = current.padre_id ? nodesById.get(current.padre_id) : null;
  }
  return parts.join('/');
}

module.exports = {
  isMainTexNode,
  isTextNode,
  hasTextContent,
  buildIdMap,
  buildClonedNodes,
  buildInitialVersions,
  buildRelativePath
};
