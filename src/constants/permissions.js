const { PROJECT_ROLES } = require('./projectConstants');

/**
 * HU-25: Matriz única de permisos por rol dentro de un proyecto (modelo de Overleaf).
 *
 * Toda decisión de autorización del backend (HTTP y WebSocket) debe pasar por can(): así
 * las reglas viven en un solo lugar y no pueden divergir entre controladores.
 *
 *  | Acción                         | Propietario | Editor | Lector |
 *  |--------------------------------|:-----------:|:------:|:------:|
 *  | Ver, descargar, compilar       |      ✓      |   ✓    |   ✓    |
 *  | Duplicar el proyecto           |      ✓      |   ✓    |   ✓    |
 *  | Ver comentarios e historial    |      ✓      |   ✓    |   ✓    |
 *  | Editar contenido               |      ✓      |   ✓    |        |
 *  | Crear/renombrar/mover archivos |      ✓      |   ✓    |        |
 *  | Guardar/restaurar versiones    |      ✓      |   ✓    |        |
 *  | Comentar y resolver            |      ✓      |   ✓    |        |
 *  | Gestionar acceso (invitar...)  |      ✓      |        |        |
 *  | Renombrar/archivar/eliminar    |      ✓      |        |        |
 *  | Salir del proyecto             |             |   ✓    |   ✓    |
 */
const PROJECT_ACTIONS = Object.freeze({
  VIEW: 'view',
  COMPILE: 'compile',
  DUPLICATE: 'duplicate',
  VIEW_COMMENTS: 'view_comments',
  VIEW_HISTORY: 'view_history',
  EDIT_CONTENT: 'edit_content',
  MANAGE_FILES: 'manage_files',
  MANAGE_VERSIONS: 'manage_versions',
  COMMENT: 'comment',
  RESOLVE_COMMENTS: 'resolve_comments',
  MANAGE_MEMBERS: 'manage_members',
  MANAGE_PROJECT: 'manage_project',
  LEAVE: 'leave'
});

const A = PROJECT_ACTIONS;
const READ_ACTIONS = [A.VIEW, A.COMPILE, A.DUPLICATE, A.VIEW_COMMENTS, A.VIEW_HISTORY];
const WRITE_ACTIONS = [A.EDIT_CONTENT, A.MANAGE_FILES, A.MANAGE_VERSIONS, A.COMMENT, A.RESOLVE_COMMENTS];

// Map y no un objeto literal: un rol como "constructor" o "__proto__" no debe encontrar
// propiedades heredadas de Object.prototype
const ROLE_PERMISSIONS = new Map([
  [PROJECT_ROLES.OWNER, new Set([...READ_ACTIONS, ...WRITE_ACTIONS, A.MANAGE_MEMBERS, A.MANAGE_PROJECT])],
  [PROJECT_ROLES.EDITOR, new Set([...READ_ACTIONS, ...WRITE_ACTIONS, A.LEAVE])],
  [PROJECT_ROLES.VIEWER, new Set([...READ_ACTIONS, A.LEAVE])],
  // Roles heredados del esquema inicial: no se ofrecen en la interfaz
  [PROJECT_ROLES.REVIEWER, new Set([...READ_ACTIONS, A.COMMENT, A.LEAVE])],
  [PROJECT_ROLES.GUEST, new Set([...READ_ACTIONS, A.LEAVE])]
]);

/** Roles que el propietario puede asignar al invitar o al cambiar el acceso de alguien. */
const ASSIGNABLE_ROLES = Object.freeze([PROJECT_ROLES.EDITOR, PROJECT_ROLES.VIEWER]);

/**
 * ¿Puede un rol realizar una acción? Un rol desconocido o vacío no puede hacer nada.
 * @param {string|null|undefined} role
 * @param {string} action Una de PROJECT_ACTIONS
 */
function can(role, action) {
  const permissions = ROLE_PERMISSIONS.get(role);
  return Boolean(permissions && permissions.has(action));
}

/** Lista de acciones permitidas a un rol (la usa el frontend para mostrar u ocultar controles). */
function permissionsOf(role) {
  return [...(ROLE_PERMISSIONS.get(role) || [])];
}

function isAssignableRole(role) {
  return ASSIGNABLE_ROLES.includes(role);
}

module.exports = {
  PROJECT_ACTIONS,
  ASSIGNABLE_ROLES,
  can,
  permissionsOf,
  isAssignableRole
};
