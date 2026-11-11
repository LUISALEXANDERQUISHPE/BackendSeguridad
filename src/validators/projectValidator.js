const { ValidationError } = require('../errors/AppError');
const { PROJECT_LIMITS, TEX_EXTENSION } = require('../constants/projectConstants');
const { isValidUuid, hasForbiddenNameChars } = require('../utils/validators');

const TEX_EXTENSION_PATTERN = /\.tex$/i;

/**
 * Valida que el identificador del proyecto sea un UUID.
 * @param {unknown} projectId
 * @returns {string}
 */
function validateProjectId(projectId) {
  if (!isValidUuid(projectId)) {
    throw new ValidationError('Identificador de proyecto inválido (debe ser un UUID válido)');
  }
  return projectId;
}

/**
 * Valida y normaliza el nombre de un proyecto (sin la extensión .tex).
 * @param {unknown} name
 * @returns {string}
 */
function validateName(name) {
  const cleanName = typeof name === 'string'
    ? name.trim().replace(TEX_EXTENSION_PATTERN, '').trim()
    : '';

  if (!cleanName) {
    throw new ValidationError('El nombre del proyecto es requerido');
  }

  if (cleanName.length > PROJECT_LIMITS.MAX_NAME_LENGTH) {
    throw new ValidationError(
      `El nombre del proyecto no puede superar los ${PROJECT_LIMITS.MAX_NAME_LENGTH} caracteres`
    );
  }

  if (hasForbiddenNameChars(cleanName)) {
    throw new ValidationError(
      'El nombre del proyecto contiene caracteres no permitidos (< > : " / \\ | ? *)'
    );
  }

  return cleanName;
}

/**
 * Valida y normaliza la descripción (opcional) de un proyecto.
 * @param {unknown} description
 * @returns {string|null}
 */
function validateDescription(description) {
  if (description === undefined || description === null || description === '') {
    return null;
  }

  if (typeof description !== 'string') {
    throw new ValidationError('La descripción debe ser un texto');
  }

  const cleanDescription = description.trim();

  if (cleanDescription.length > PROJECT_LIMITS.MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `La descripción no puede superar los ${PROJECT_LIMITS.MAX_DESCRIPTION_LENGTH} caracteres`
    );
  }

  return cleanDescription || null;
}

/**
 * Valida el código LaTeX inicial de un proyecto. Si no se envía, se usa la plantilla indicada.
 * @param {unknown} content
 * @param {string} fallback
 * @returns {string}
 */
function validateContent(content, fallback) {
  if (content === undefined || content === null) {
    return fallback;
  }

  if (typeof content !== 'string') {
    throw new ValidationError('El contenido del proyecto debe ser texto');
  }

  if (Buffer.byteLength(content, 'utf8') > PROJECT_LIMITS.MAX_CONTENT_BYTES) {
    throw new ValidationError('El contenido supera el tamaño máximo permitido (2 MB)');
  }

  return content;
}

/**
 * Valida el cuerpo de una petición de modificación (nombre y/o descripción).
 * @param {{ name?: unknown, description?: unknown }} payload
 * @returns {{ nombre?: string, descripcion?: string|null }}
 */
function validateUpdatePayload({ name, description } = {}) {
  if (name === undefined && description === undefined) {
    throw new ValidationError('No se enviaron datos para modificar');
  }

  const changes = {};
  if (name !== undefined) changes.nombre = validateName(name);
  if (description !== undefined) changes.descripcion = validateDescription(description);
  return changes;
}

/**
 * Nombre por defecto de la copia de un proyecto, respetando la longitud máxima.
 * @param {string} sourceName
 * @returns {string}
 */
function buildCopyName(sourceName) {
  const maxBaseLength = PROJECT_LIMITS.MAX_NAME_LENGTH - PROJECT_LIMITS.COPY_SUFFIX.length;
  return `${sourceName.slice(0, maxBaseLength)}${PROJECT_LIMITS.COPY_SUFFIX}`;
}

/**
 * Nombre del archivo principal .tex asociado al nombre del proyecto.
 * @param {string} projectName
 * @returns {string}
 */
function toMainFileName(projectName) {
  return `${projectName}${TEX_EXTENSION}`;
}

module.exports = {
  validateProjectId,
  validateName,
  validateDescription,
  validateContent,
  validateUpdatePayload,
  buildCopyName,
  toMainFileName
};
