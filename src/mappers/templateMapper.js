const { TEMPLATE_CATEGORIES } = require('../constants/templateConstants');

/**
 * Formato público (API) de una plantilla.
 * @param {object} template Metadatos de la plantilla (template.json normalizado)
 * @param {object} [details] Datos adicionales al consultar una plantilla concreta
 * @param {Array<{ path: string, sizeBytes: number }>} [details.files] Archivos que se copiarán
 * @param {string} [details.mainFileContent] Código del archivo principal (vista previa del código)
 * @param {boolean} [details.hasPreview] Existe una vista previa compilada en PDF
 */
function toTemplateDto(template, { files, mainFileContent, hasPreview } = {}) {
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    categoryLabel: TEMPLATE_CATEGORIES[template.category],
    description: template.description,
    tags: template.tags,
    mainFile: template.mainFile,
    ...(hasPreview !== undefined && { hasPreview }),
    ...(files && { files }),
    ...(mainFileContent !== undefined && { mainFileContent })
  };
}

/**
 * Fila de la tabla "plantillas" para registrar una plantilla del sistema.
 * @param {object} template
 * @param {string} nowIso
 */
function toTemplateRow(template, nowIso) {
  return {
    id: template.id,
    nombre: template.name,
    categoria: template.category,
    descripcion: template.description,
    storage_path: `templates/${template.slug}`,
    es_sistema: true,
    actualizado_en: nowIso
  };
}

module.exports = { toTemplateDto, toTemplateRow };
