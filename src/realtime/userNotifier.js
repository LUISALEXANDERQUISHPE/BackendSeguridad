/**
 * Notificaciones en tiempo real dirigidas a un usuario (ej. "te compartieron un proyecto").
 *
 * Cada usuario puede tener varias conexiones abiertas (pestañas, navegadores); el aviso se
 * envía a todas. Los servicios de negocio solo llaman a notify() y no conocen los WebSockets.
 */
function createUserNotifier({ logger = console } = {}) {
  /** @type {Map<string, Set<{ send: (data: string) => void }>>} */
  const connections = new Map();

  function subscribe(userId, socket) {
    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId).add(socket);
  }

  function unsubscribe(userId, socket) {
    const sockets = connections.get(userId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) connections.delete(userId);
  }

  /**
   * Envía un evento a todas las conexiones del usuario.
   * @returns {number} Conexiones que recibieron el aviso
   */
  function notify(userId, payload) {
    const sockets = connections.get(userId);
    if (!sockets) return 0;
    const data = JSON.stringify(payload);
    let delivered = 0;
    for (const socket of sockets) {
      try {
        socket.send(data);
        delivered++;
      } catch (error) {
        logger.warn('[notificaciones] No se pudo enviar el aviso:', error.message);
      }
    }
    return delivered;
  }

  return { subscribe, unsubscribe, notify };
}

// Instancia compartida por el servidor WebSocket y los servicios
const userNotifier = createUserNotifier();

module.exports = userNotifier;
module.exports.createUserNotifier = createUserNotifier;
