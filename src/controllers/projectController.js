const projectRepository = require('../repositories/projectRepository');
const storageService = require('../services/storageService');
const latexService = require('../services/latexService');
const logger = require('../utils/logger');
const { createProjectService } = require('../services/projectService');

/**
 * Controlador HTTP de la HU-17 "Gestión de proyectos".
 * Solo traduce peticiones HTTP a llamadas del servicio y da forma a la respuesta;
 * la validación, autorización y persistencia viven en sus propias capas.
 * Express 5 propaga al middleware de errores cualquier promesa rechazada.
 *
 * @param {ReturnType<typeof createProjectService>} projectService
 */
function createProjectController(projectService) {
  return {
    /** GET /api/projects?archived=true|false */
    async listProjects(req, res) {
      const archived = req.query.archived === 'true';
      const projects = await projectService.listProjects(req.user.id, { archived });
      res.json({ projects });
    },

    /** POST /api/projects */
    async createProject(req, res) {
      const { project, storageSynced } = await projectService.createProject(req.user.id, req.body);
      res.status(201).json({ message: 'Proyecto creado exitosamente', project, storageSynced });
    },

    /** GET /api/projects/:id */
    async getProjectById(req, res) {
      const project = await projectService.getProject(req.user.id, req.params.id);
      res.json({ project });
    },

    /** PUT /api/projects/:id */
    async updateProject(req, res) {
      const project = await projectService.updateProject(req.user.id, req.params.id, req.body);
      res.json({ message: 'Proyecto actualizado exitosamente', project });
    },

    /** POST /api/projects/:id/archive */
    async archiveProject(req, res) {
      const project = await projectService.setArchived(req.user.id, req.params.id, true);
      res.json({ message: 'Proyecto archivado exitosamente', project });
    },

    /** POST /api/projects/:id/restore */
    async restoreProject(req, res) {
      const project = await projectService.setArchived(req.user.id, req.params.id, false);
      res.json({ message: 'Proyecto restaurado exitosamente', project });
    },

    /** POST /api/projects/:id/duplicate */
    async duplicateProject(req, res) {
      const project = await projectService.duplicateProject(req.user.id, req.params.id, req.body);
      res.status(201).json({ message: 'Proyecto duplicado exitosamente', project });
    },

    /** DELETE /api/projects/:id */
    async deleteProject(req, res) {
      await projectService.deleteProject(req.user.id, req.params.id);
      res.json({ message: 'Proyecto eliminado exitosamente' });
    }
  };
}

// Raíz de composición: aquí se conectan las implementaciones concretas
const projectService = createProjectService({
  repository: projectRepository,
  storage: storageService,
  compiledFiles: latexService,
  logger
});

module.exports = createProjectController(projectService);
module.exports.createProjectController = createProjectController;
