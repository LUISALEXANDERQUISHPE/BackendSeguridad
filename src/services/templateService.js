const { NotFoundError } = require('../errors/AppError');
const { toTemplateDto, toTemplateRow } = require('../mappers/templateMapper');
const { validateTemplateId } = require('../validators/templateValidator');

/**
 * Servicio de la HU-16 "Plantillas LaTeX": catálogo de plantillas del sistema.
 *
 * Las plantillas son de solo lectura: este servicio permite consultarlas y entregar sus
 * archivos para COPIARLOS a un proyecto nuevo, pero no ofrece forma de modificarlas ni borrarlas.
 *
 * @param {object} deps
 * @param {object} deps.files Repositorio de solo lectura de los archivos de las plantillas
 * @param {object} deps.catalog Repositorio del catálogo en la base de datos
 * @param {object} deps.logger Registro de eventos
 */
function createTemplateService({ files, catalog, logger }) {
  async function findOrFail(templateId) {
    validateTemplateId(templateId);
    const template = await files.findTemplate(templateId);
    if (!template) {
      throw new NotFoundError('Plantilla no encontrada');
    }
    return template;
  }

  /** LISTAR el catálogo de plantillas disponibles. */
  async function listTemplates() {
    const templates = await files.listTemplates();
    return templates.map(template => toTemplateDto(template));
  }

  /** OBTENER una plantilla con la lista de sus archivos y el código del archivo principal. */
  async function getTemplate(templateId) {
    const template = await findOrFail(templateId);
    const [templateFiles, preview] = await Promise.all([files.readFiles(template), files.readPreview(template)]);
    const main = templateFiles.find(file => file.path === template.mainFile);

    return toTemplateDto(template, {
      files: templateFiles.map(file => ({ path: file.path, sizeBytes: file.content.length })),
      mainFileContent: main ? main.content.toString('utf8') : '',
      hasPreview: preview !== null
    });
  }

  /** Vista previa en PDF de la plantilla. */
  async function getPreview(templateId) {
    const template = await findOrFail(templateId);
    const preview = await files.readPreview(template);
    if (!preview) {
      throw new NotFoundError('Esta plantilla no tiene vista previa');
    }
    return { fileName: `${template.slug}.pdf`, content: preview };
  }

  /**
   * Plantilla y sus archivos, para crear un proyecto a partir de ella.
   * Devuelve una lectura nueva de los archivos: quien la use trabaja sobre una copia.
   */
  async function loadForCopy(templateId) {
    const template = await findOrFail(templateId);
    const templateFiles = await files.readFiles(template);
    if (!templateFiles.some(file => file.path === template.mainFile)) {
      throw new Error(`La plantilla "${template.slug}" no contiene su archivo principal ${template.mainFile}`);
    }
    return { template, files: templateFiles };
  }

  /**
   * Registra en la base de datos las plantillas del sistema (alta o actualización).
   * Se ejecuta al iniciar el servidor; si la base no responde, la app sigue funcionando
   * porque el catálogo se sirve desde los archivos.
   * @returns {Promise<number>} Cantidad de plantillas sincronizadas
   */
  async function syncCatalog() {
    const templates = await files.listTemplates();
    const nowIso = new Date().toISOString();
    await catalog.upsertSystemTemplates(templates.map(template => toTemplateRow(template, nowIso)));
    logger.info(`Plantillas del sistema sincronizadas: ${templates.length}`);
    return templates.length;
  }

  return {
    listTemplates,
    getTemplate,
    getPreview,
    loadForCopy,
    syncCatalog
  };
}

module.exports = { createTemplateService };
