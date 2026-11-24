const projectRepository = require('./repositories/projectRepository');
const versionRepository = require('./repositories/versionRepository');
const storageService = require('./services/storageService');
const logger = require('./utils/logger');
const { createVersionService } = require('./services/versionService');

/**
 * Raíz de composición: único lugar donde se conectan las implementaciones concretas
 * (Supabase, Storage, logger) con los servicios de negocio. Los controladores obtienen
 * los servicios desde aquí y comparten la misma instancia.
 */
const versionService = createVersionService({
  versions: versionRepository,
  projects: projectRepository,
  storage: storageService,
  logger
});

module.exports = {
  versionService
};
