/**
 * Sesiones de cifrado temporales (resultado de Diffie-Hellman), solo en memoria.
 * Nunca se guardan en disco ni en la base de datos: al reiniciar el servidor el
 * navegador simplemente vuelve a acordar una llave.
 */

const DEFAULT_MAX_SESSIONS = 10000;
const MAX_REMEMBERED_NONCES = 5000;

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
    const session = { id, keys, expiresAt: now() + ttlMs, seenNonces: new Set() };
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

  /**
   * Registra el nonce de un mensaje recibido. Devuelve false si ya se había visto:
   * así un mensaje capturado no puede reenviarse (repetición).
   */
  function rememberNonce(session, nonceKey) {
    if (session.seenNonces.has(nonceKey)) return false;
    if (session.seenNonces.size >= MAX_REMEMBERED_NONCES) {
      session.seenNonces.delete(session.seenNonces.values().next().value);
    }
    session.seenNonces.add(nonceKey);
    return true;
  }

  function remove(id) {
    sessions.delete(id);
  }

  return { save, get, remove, rememberNonce, removeExpired, size: () => sessions.size };
}

module.exports = { createSessionStore };
