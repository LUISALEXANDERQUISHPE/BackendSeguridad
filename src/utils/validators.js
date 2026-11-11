const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Caracteres no permitidos en nombres visibles de archivos (Windows / Storage)
const FORBIDDEN_NAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

// Rango de caracteres de control ASCII (U+0000–U+001F y U+007F)
const LAST_CONTROL_CHAR_CODE = 0x1f;
const DELETE_CHAR_CODE = 0x7f;

/**
 * Indica si el valor es un UUID (versiones 1 a 5) válido.
 * @param {unknown} id
 * @returns {boolean}
 */
function isValidUuid(id) {
  return typeof id === 'string' && UUID_PATTERN.test(id);
}

/**
 * Indica si el carácter es de control (no imprimible).
 * @param {string} char
 * @returns {boolean}
 */
function isControlChar(char) {
  const code = char.codePointAt(0);
  return code <= LAST_CONTROL_CHAR_CODE || code === DELETE_CHAR_CODE;
}

/**
 * Indica si el texto contiene caracteres de control o reservados para nombres de archivo.
 * @param {string} text
 * @returns {boolean}
 */
function hasForbiddenNameChars(text) {
  return [...text].some(char => isControlChar(char) || FORBIDDEN_NAME_CHARS.has(char));
}

module.exports = {
  isValidUuid,
  hasForbiddenNameChars
};
