const nodeCrypto = require('node:crypto');
const { NODE_TYPES, FILE_TYPES } = require('../constants/projectConstants');
const { toMainFileName } = require('../validators/projectValidator');

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
 * @param {object} node
 * @returns {boolean}
 */
function isTextFile(node) {
  return node.tipo_nodo === NODE_TYPES.FILE && typeof node.contenido_actual === 'string';
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
      contenido_actual: node.contenido_actual,
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
  return clonedNodes.filter(isTextFile).map(node => ({
    archivo_id: node.id,
    numero_version: 1,
    contenido_snapshot: node.contenido_actual,
    modificado_por: userId,
    resumen_cambio: summary
  }));
}

/**
 * Nombre con extensión para el archivo binario copiado en Storage.
 * @param {string} nodeName
 * @param {string} sourceStoragePath
 * @returns {string}
 */
function resolveBinaryFileName(nodeName, sourceStoragePath) {
  if (nodeName.includes('.')) return nodeName;
  const extension = sourceStoragePath.includes('.') ? sourceStoragePath.split('.').pop() : 'bin';
  return `${nodeName}.${extension}`;
}

module.exports = {
  isMainTexNode,
  isTextFile,
  buildIdMap,
  buildClonedNodes,
  buildInitialVersions,
  resolveBinaryFileName
};
