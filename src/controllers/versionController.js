const { versionService } = require('../container');
const { parseVersionRef, validateVersionNumber } = require('../validators/versionValidator');

/**
 * Controlador HTTP de la HU-23 "Control de versiones e historial".
 * Solo traduce la petición a una llamada del servicio y da forma a la respuesta.
 * Express 5 propaga al middleware de errores cualquier promesa rechazada.
 *
 * @param {ReturnType<typeof import('../services/versionService').createVersionService>} service
 */
function createVersionController(service) {
  return {
    /** GET /api/documents/:id/versions?limit=&offset= */
    async listVersions(req, res) {
      res.json(await service.listVersions(req.user.id, req.params.id, req.query));
    },

    /** POST /api/documents/:id/versions */
    async createVersion(req, res) {
      const version = await service.createVersion(req.user.id, req.params.id, req.body);
      res.status(201).json({ message: 'Versión guardada exitosamente', version });
    },

    /** GET /api/documents/:id/versions/compare?from=&to= */
    async compareVersions(req, res) {
      const from = parseVersionRef(req.query.from, 'from');
      const to = parseVersionRef(req.query.to, 'to');
      res.json(await service.compareVersions(req.user.id, req.params.id, { from, to }));
    },

    /** GET /api/documents/:id/versions/:number */
    async getVersion(req, res) {
      const version = await service.getVersion(req.user.id, req.params.id, validateVersionNumber(req.params.number));
      res.json({ version });
    },

    /** POST /api/documents/:id/versions/:number/restore */
    async restoreVersion(req, res) {
      const number = validateVersionNumber(req.params.number);
      const result = await service.restoreVersion(req.user.id, req.params.id, number);
      res.json({ message: `Se restauró la versión ${number}`, ...result });
    }
  };
}

module.exports = createVersionController(versionService);
module.exports.createVersionController = createVersionController;
