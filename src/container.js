const projectRepository = require('./repositories/projectRepository');
const versionRepository = require('./repositories/versionRepository');
const storageService = require('./services/storageService');
const logger = require('./utils/logger');
const { createVersionService } = require('./services/versionService');
const invitationRepository = require('./repositories/invitationRepository');
const auditRepository = require('./repositories/auditRepository');
const userNotifier = require('./realtime/userNotifier');
const { createInvitationService } = require('./services/invitationService');
const { createMemberService } = require('./services/memberService');
const { emitAccessChanged } = require('./realtime/accessEvents');

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

// HU-25: invitaciones a proyectos
const invitationService = createInvitationService({
  invitations: invitationRepository,
  projects: projectRepository,
  audit: auditRepository,
  notifier: userNotifier,
  logger
});

// HU-25: cambiar rol, quitar acceso y salir del proyecto (se aplica en caliente a los editores abiertos)
const memberService = createMemberService({
  projects: projectRepository,
  audit: auditRepository,
  notifier: userNotifier,
  onAccessChanged: emitAccessChanged,
  logger
});

module.exports = {
  versionService,
  invitationService,
  memberService
};
