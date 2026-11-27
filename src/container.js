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
const { emitAccessChanged, emitCommentsChanged } = require('./realtime/accessEvents');
const commentRepository = require('./repositories/commentRepository');
const { createCommentService } = require('./services/commentService');
const templateFileRepository = require('./repositories/templateFileRepository');
const templateRepository = require('./repositories/templateRepository');
const { createTemplateService } = require('./services/templateService');

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

// HU-25: comentarios en hilos (se avisa en tiempo real a quienes tienen el archivo abierto)
const commentService = createCommentService({
  comments: commentRepository,
  projects: projectRepository,
  onCommentsChanged: emitCommentsChanged
});

// HU-16: plantillas LaTeX del sistema (solo lectura; usarlas crea una copia como proyecto nuevo)
const templateService = createTemplateService({
  files: templateFileRepository,
  catalog: templateRepository,
  logger
});

module.exports = {
  templateService,
  versionService,
  invitationService,
  memberService,
  commentService
};
