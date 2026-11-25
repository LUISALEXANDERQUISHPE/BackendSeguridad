const { ValidationError, ForbiddenError, NotFoundError } = require('../errors/AppError');
const { AUDIT_ACTIONS } = require('../constants/invitationConstants');
const { can, isAssignableRole, PROJECT_ACTIONS } = require('../constants/permissions');
const { isValidUuid } = require('../utils/validators');
const { createProjectAccessService } = require('./projectAccessService');

const displayName = (user) => user?.nombre_completo || user?.correo || null;

function validateUserId(userId) {
  if (!isValidUuid(userId)) throw new ValidationError('Identificador de usuario inválido');
  return userId;
}

/**
 * HU-25: Gestión del acceso a un proyecto ("Administrar acceso" de Overleaf):
 *  - el propietario cambia el rol de un colaborador (editor <-> lector) o le quita el acceso;
 *  - un colaborador puede salir del proyecto por su cuenta.
 *
 * Cada cambio se aplica al instante en los editores abiertos (onAccessChanged), se avisa al
 * afectado en tiempo real y queda en el registro de auditoría.
 *
 * @param {object} deps
 * @param {object} deps.projects Repositorio de proyectos
 * @param {object} deps.audit Registro de auditoría
 * @param {{ notify: Function }} [deps.notifier] Avisos en tiempo real
 * @param {(change: { projectId: string, userId: string, role: string|null }) => void} [deps.onAccessChanged]
 * @param {{ warn: Function }} deps.logger
 */
function createMemberService({ projects, audit, notifier = null, onAccessChanged = () => {}, logger }) {
  const access = createProjectAccessService({ repository: projects });

  async function runSafely(description, operation) {
    try {
      await operation();
    } catch (error) {
      logger.warn(`[acceso] No se pudo ${description}:`, error.message);
    }
  }

  const record = (entry) => runSafely('registrar la auditoría', () => audit.record(entry));
  const notify = (userId, payload) => { if (notifier && userId) notifier.notify(userId, payload); };

  /** Carga el proyecto (exigiendo ser propietario) y comprueba que el destino sea un colaborador. */
  async function resolveTarget(ownerId, projectId, targetUserId, action) {
    const { project } = await access.resolveAsOwner(projectId, ownerId, action);
    validateUserId(targetUserId);
    if (targetUserId === project.propietario_id) {
      throw new ForbiddenError('No se puede cambiar el acceso del propietario del proyecto');
    }
    const currentRole = await projects.findMemberRole(project.id, targetUserId);
    if (!currentRole) throw new NotFoundError('Esa persona no colabora en este proyecto');
    return { project, currentRole };
  }

  /**
   * CAMBIAR ROL de un colaborador (solo el propietario). Si la persona tiene el archivo abierto,
   * pasa a solo lectura (o recupera la edición) sin recargar.
   */
  async function changeRole(ownerId, projectId, targetUserId, { role } = {}, context = {}) {
    if (!isAssignableRole(role)) throw new ValidationError('El rol debe ser "editor" o "lector"');
    const { project, currentRole } = await resolveTarget(ownerId, projectId, targetUserId, 'cambiar los permisos de');

    if (currentRole !== role) {
      const updated = await projects.updateMemberRole(project.id, targetUserId, role);
      if (!updated) throw new NotFoundError('Esa persona no colabora en este proyecto');

      onAccessChanged({ projectId: project.id, userId: targetUserId, role });
      notify(targetUserId, { type: 'access-changed', projectId: project.id, projectName: project.nombre, role });
      await record({
        userId: ownerId,
        projectId: project.id,
        action: AUDIT_ACTIONS.CHANGE_ROLE,
        entityType: 'miembro',
        entityId: targetUserId,
        ip: context.ip,
        metadata: { antes: currentRole, despues: role }
      });
    }
    return { userId: targetUserId, role };
  }

  /** QUITAR ACCESO a un colaborador (solo el propietario). Se le desconecta de los editores abiertos. */
  async function removeMember(ownerId, projectId, targetUserId, context = {}) {
    const { project, currentRole } = await resolveTarget(ownerId, projectId, targetUserId, 'quitar el acceso en');

    if (!(await projects.removeMember(project.id, targetUserId))) {
      throw new NotFoundError('Esa persona no colabora en este proyecto');
    }

    onAccessChanged({ projectId: project.id, userId: targetUserId, role: null });
    notify(targetUserId, { type: 'access-removed', projectId: project.id, projectName: project.nombre });
    await record({
      userId: ownerId,
      projectId: project.id,
      action: AUDIT_ACTIONS.REMOVE_MEMBER,
      entityType: 'miembro',
      entityId: targetUserId,
      ip: context.ip,
      metadata: { rol: currentRole }
    });
  }

  /** SALIR del proyecto (cualquier colaborador; el propietario no puede abandonar su proyecto). */
  async function leaveProject(userId, projectId, context = {}) {
    const { project, role } = await access.resolve(projectId, userId);
    if (!can(role, PROJECT_ACTIONS.LEAVE)) {
      throw new ForbiddenError('El propietario no puede salir de su propio proyecto');
    }

    await projects.removeMember(project.id, userId);
    onAccessChanged({ projectId: project.id, userId, role: null });

    const user = await projects.findUserById(userId).catch(() => null);
    notify(project.propietario_id, {
      type: 'member-left',
      projectId: project.id,
      projectName: project.nombre,
      userName: displayName(user)
    });
    await record({
      userId,
      projectId: project.id,
      action: AUDIT_ACTIONS.LEAVE_PROJECT,
      entityType: 'miembro',
      entityId: userId,
      ip: context.ip,
      metadata: { rol: role }
    });
  }

  return { changeRole, removeMember, leaveProject };
}

module.exports = { createMemberService };
