const { templateService } = require('../container');
const { sendFile } = require('../utils/httpFile');

/**
 * Controlador HTTP de la HU-16 "Plantillas LaTeX".
 * Solo de lectura: las plantillas del sistema no se crean, modifican ni eliminan por la API.
 * Para usar una plantilla se crea un proyecto: POST /api/projects con { templateId }.
 *
 * @param {ReturnType<typeof import('../services/templateService').createTemplateService>} service
 */
function createTemplateController(service) {
  return {
    /** GET /api/templates */
    async listTemplates(req, res) {
      res.json({ templates: await service.listTemplates() });
    },

    /** GET /api/templates/:id */
    async getTemplate(req, res) {
      res.json({ template: await service.getTemplate(req.params.id) });
    },

    /** GET /api/templates/:id/preview */
    async getPreview(req, res) {
      const { fileName, content } = await service.getPreview(req.params.id);
      await sendFile(res, { fileName, contentType: 'application/pdf', disposition: 'inline', buffer: content });
    }
  };
}

module.exports = createTemplateController(templateService);
module.exports.createTemplateController = createTemplateController;
