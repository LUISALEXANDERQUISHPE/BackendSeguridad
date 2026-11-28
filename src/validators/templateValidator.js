const { ValidationError } = require('../errors/AppError');
const { TEMPLATE_CATEGORIES } = require('../constants/templateConstants');
const { isValidUuid } = require('../utils/validators');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Identificador de plantilla recibido en la API (UUID).
 * @param {unknown} templateId
 * @returns {string}
 */
function validateTemplateId(templateId) {
  if (!isValidUuid(templateId)) {
    throw new ValidationError('Identificador de plantilla inválido (debe ser un UUID válido)');
  }
  return templateId;
}

function requireText(value, field, slug) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Plantilla "${slug}": el campo "${field}" es obligatorio en template.json`);
  }
  return value.trim();
}

/**
 * Valida el template.json de una plantilla del sistema y lo normaliza.
 * Un manifiesto inválido es un error de quien empaquetó la plantilla (no del usuario),
 * por eso se lanza un Error normal que detiene la carga del catálogo con un mensaje claro.
 *
 * @param {unknown} raw Contenido ya parseado de template.json
 * @param {string} slug Nombre de la carpeta de la plantilla
 * @returns {{ id: string, slug: string, name: string, category: string, description: string,
 *             mainFile: string, tags: string[], order: number }}
 */
function parseManifest(raw, slug) {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Plantilla "${slug}": el nombre de la carpeta solo admite minúsculas, números y guiones`);
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Plantilla "${slug}": template.json debe contener un objeto JSON`);
  }
  if (!isValidUuid(raw.id)) {
    throw new Error(`Plantilla "${slug}": "id" debe ser un UUID válido`);
  }
  if (!Object.hasOwn(TEMPLATE_CATEGORIES, raw.category)) {
    throw new Error(
      `Plantilla "${slug}": categoría "${raw.category}" no válida (${Object.keys(TEMPLATE_CATEGORIES).join(', ')})`
    );
  }

  const mainFile = requireText(raw.mainFile, 'mainFile', slug);
  if (mainFile.includes('/') || !mainFile.toLowerCase().endsWith('.tex')) {
    throw new Error(`Plantilla "${slug}": "mainFile" debe ser un archivo .tex en la raíz de la plantilla`);
  }

  return {
    id: raw.id,
    slug,
    name: requireText(raw.name, 'name', slug),
    category: raw.category,
    description: requireText(raw.description, 'description', slug),
    mainFile,
    tags: Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === 'string') : [],
    order: Number.isInteger(raw.order) ? raw.order : Number.MAX_SAFE_INTEGER
  };
}

module.exports = {
  validateTemplateId,
  parseManifest
};
