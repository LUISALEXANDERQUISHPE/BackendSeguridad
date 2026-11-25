const { EventEmitter } = require('events');

/**
 * HU-25: Avisos internos de cambios de acceso a un proyecto.
 *
 * Los servicios de negocio emiten 'member-access-changed' al cambiar el rol de un colaborador
 * o quitarle el acceso; el servidor de colaboración en tiempo real lo escucha y aplica el
 * cambio a las conexiones abiertas. Así los servicios no dependen de los WebSockets.
 *
 * Evento: 'member-access-changed' -> { projectId: string, userId: string, role: string|null }
 *   role = null significa que el usuario ya no tiene acceso al proyecto.
 */
const ACCESS_CHANGED = 'member-access-changed';

const accessEvents = new EventEmitter();

function emitAccessChanged({ projectId, userId, role }) {
  accessEvents.emit(ACCESS_CHANGED, { projectId, userId, role: role || null });
}

module.exports = { accessEvents, emitAccessChanged, ACCESS_CHANGED };
