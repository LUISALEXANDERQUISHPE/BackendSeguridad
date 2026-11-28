/**
 * Sesiones de cifrado temporales (resultado de Diffie-Hellman), solo en memoria.
 * Nunca se guardan en disco ni en la base de datos: al reiniciar el servidor el
 * navegador simplemente vuelve a acordar una llave.
 */

const DEFAULT_MAX_SESSIONS = 10000;
const MAX_REMEMBERED_NONCES = 5000;
const MAX_CHANNELS_PER_SESSION = 500;

function createSessionStore({ ttlMs, maxSessions = DEFAULT_MAX_SESSIONS, now = () => Date.now() }) {
  const sessions = new Map();

  function removeExpired() {
    const current = now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= current) sessions.delete(id);
    }
  }

  function save(id, keys) {
    if (sessions.size >= maxSessions) {
      removeExpired();
      // Si sigue llena, se descarta la más antigua (Map conserva el orden de inserción)
      if (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
    }
    const session = { id, keys, expiresAt: now() + ttlMs, seenNonces: new Set(), channels: new Set() };
    sessions.set(id, session);
    return session;
  }

  function get(id) {
    const session = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(id);
      return null;
    }
    return session;
  }

  /** Agrega a un conjunto con tamaño máximo; devuelve false si el valor ya estaba. */
  function addOnce(set, value, limit) {
    if (set.has(value)) return false;
    if (set.size >= limit) set.delete(set.values().next().value);
    set.add(value);
    return true;
  }

  /**
   * Registra el nonce de una petición recibida. Devuelve false si ya se había visto:
   * así una petición capturada no puede reenviarse (repetición).
   */
  function rememberNonce(session, nonceKey) {
    return addOnce(session.seenNonces, nonceKey, MAX_REMEMBERED_NONCES);
  }

  /**
   * Reserva el identificador de una conexión WebSocket. Cada conexión usa uno nuevo:
   * las tramas de una conexión no se pueden repetir en otra.
   */
  function claimChannel(session, channelId) {
    return addOnce(session.channels, channelId, MAX_CHANNELS_PER_SESSION);
  }

  function remove(id) {
    sessions.delete(id);
  }

  return { save, get, remove, rememberNonce, claimChannel, removeExpired, size: () => sessions.size };
}

module.exports = { createSessionStore };
