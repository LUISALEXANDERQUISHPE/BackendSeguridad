const { ValidationError } = require('../errors/AppError');
const { VERSION_LIMITS, CURRENT_VERSION } = require('../constants/versionConstants');
const { isValidUuid } = require('../utils/validators');

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function validateFileId(fileId) {
  if (!isValidUuid(fileId)) {
    throw new ValidationError('Identificador de archivo inválido (debe ser un UUID válido)');
  }
  return fileId;
}

/**
 * Número de versión recibido en la URL (entero positivo).
 * @param {unknown} value
 * @returns {number}
 */
function validateVersionNumber(value) {
  const text = String(value ?? '');
  if (!POSITIVE_INTEGER.test(text)) {
    throw new ValidationError('El número de versión debe ser un entero positivo');
  }
  return Number(text);
}

/**
 * Versión a comparar: un número o "current" (contenido vigente del archivo).
 * @param {unknown} value
 * @param {string} paramName Nombre del parámetro, para el mensaje de error
 * @returns {number|'current'}
 */
function parseVersionRef(value, paramName) {
  if (value === CURRENT_VERSION) return CURRENT_VERSION;
  if (value === undefined || value === '') {
    throw new ValidationError(`El parámetro "${paramName}" es requerido (número de versión o "${CURRENT_VERSION}")`);
  }
  return validateVersionNumber(value);
}

/**
 * Descripción opcional de una versión.
 * @param {unknown} summary
 * @returns {string|null}
 */
function validateSummary(summary) {
  if (summary === undefined || summary === null) return null;
  if (typeof summary !== 'string') {
    throw new ValidationError('La descripción de la versión debe ser un texto');
  }
  const clean = summary.trim();
  if (clean.length > VERSION_LIMITS.MAX_SUMMARY_LENGTH) {
    throw new ValidationError(
      `La descripción no puede superar los ${VERSION_LIMITS.MAX_SUMMARY_LENGTH} caracteres`
    );
  }
  return clean || null;
}

/**
 * Paginación del historial (?limit=&offset=), con valores por defecto y máximos seguros.
 * @param {{ limit?: unknown, offset?: unknown }} query
 * @returns {{ limit: number, offset: number }}
 */
function parsePagination({ limit, offset } = {}) {
  const parsedLimit = Number.parseInt(limit, 10);
  const parsedOffset = Number.parseInt(offset, 10);
  return {
    limit: Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, VERSION_LIMITS.MAX_PAGE_SIZE)
      : VERSION_LIMITS.DEFAULT_PAGE_SIZE,
    offset: Number.isInteger(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  };
}

module.exports = {
  validateFileId,
  validateVersionNumber,
  parseVersionRef,
  validateSummary,
  parsePagination
};
