const { diffArrays } = require('diff');

/**
 * Comparación línea a línea entre dos textos (algoritmo de Myers, mediante jsdiff).
 * Funciones puras: no dependen de la base de datos ni de Express.
 */

const LINE_TYPES = Object.freeze({
  EQUAL: 'equal',
  ADDED: 'added',
  REMOVED: 'removed'
});

/**
 * Divide un texto en líneas, aceptando saltos de línea de Windows y Unix.
 * Un salto de línea al final no genera una línea vacía extra.
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  if (!text) return [];
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function partType(part) {
  if (part.added) return LINE_TYPES.ADDED;
  if (part.removed) return LINE_TYPES.REMOVED;
  return LINE_TYPES.EQUAL;
}

/**
 * Compara dos textos y devuelve cada línea con su tipo y su número en cada versión.
 *
 * @param {string} oldText Texto anterior
 * @param {string} newText Texto nuevo
 * @returns {{ lines: Array<{ type: string, oldNumber: number|null, newNumber: number|null, text: string }>,
 *             stats: { added: number, removed: number, unchanged: number } }}
 */
function computeLineDiff(oldText, newText) {
  const lines = [];
  const stats = { added: 0, removed: 0, unchanged: 0 };
  let oldNumber = 0;
  let newNumber = 0;

  for (const part of diffArrays(splitLines(oldText), splitLines(newText))) {
    const type = partType(part);
    for (const text of part.value) {
      if (type !== LINE_TYPES.ADDED) oldNumber += 1;
      if (type !== LINE_TYPES.REMOVED) newNumber += 1;
      lines.push({
        type,
        oldNumber: type === LINE_TYPES.ADDED ? null : oldNumber,
        newNumber: type === LINE_TYPES.REMOVED ? null : newNumber,
        text
      });
    }
    const statKey = type === LINE_TYPES.EQUAL ? 'unchanged' : type;
    stats[statKey] += part.value.length;
  }

  return { lines, stats };
}

/**
 * Solo las cantidades de líneas agregadas y eliminadas (para el listado del historial).
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ added: number, removed: number }}
 */
function countLineChanges(oldText, newText) {
  const { stats } = computeLineDiff(oldText, newText);
  return { added: stats.added, removed: stats.removed };
}

module.exports = {
  LINE_TYPES,
  splitLines,
  computeLineDiff,
  countLineChanges
};
