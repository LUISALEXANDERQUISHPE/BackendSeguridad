const { ForbiddenError, NotFoundError } = require('../errors/AppError');
const { PROJECT_ROLES } = require('../constants/projectConstants');
const { validateProjectId } = require('../validators/projectValidator');

/**
 * Servicio de control de acceso a proyectos.
 * Resuelve el rol del usuario y aplica las reglas de autorización (principio de responsabilidad única).
 *
 * @param {{ repository: object }} deps
 */
function createProjectAccessService({ repository }) {
  /**
   * Obtiene el proyecto y el rol del usuario dentro de él.
   * @param {string} projectId
   * @param {string} userId
   * @returns {Promise<{ project: object, role: string }>}
   */
  async function resolve(projectId, userId) {
    validateProjectId(projectId);

    const project = await repository.findById(projectId);
    if (!project) {
      throw new NotFoundError('Proyecto no encontrado');
    }

    if (project.propietario_id === userId) {
      return { project, role: PROJECT_ROLES.OWNER };
    }

    const role = await repository.findMemberRole(project.id, userId);
    if (!role) {
      throw new ForbiddenError('No tienes permisos para acceder a este proyecto');
    }

    return { project, role };
  }

  /**
   * Igual que resolve, pero exige que el usuario sea el propietario del proyecto.
   * @param {string} projectId
   * @param {string} userId
   * @param {string} action Verbo de la acción, usado en el mensaje de error (ej. "eliminar")
   * @returns {Promise<{ project: object, role: string }>}
   */
  async function resolveAsOwner(projectId, userId, action) {
    const access = await resolve(projectId, userId);
    if (access.role !== PROJECT_ROLES.OWNER) {
      throw new ForbiddenError(`Solo el propietario puede ${action} este proyecto`);
    }
    return access;
  }

  return { resolve, resolveAsOwner };
}

module.exports = { createProjectAccessService };
