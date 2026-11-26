const { DIRECTIONS, isEnvelope, openJson, sealJson } = require('../security/transport/transportCipher');

const SESSION_HEADER = 'x-secure-session';
const SESSION_EXPIRED_CODE = 'SECURE_SESSION_EXPIRED';

/**
 * Canal cifrado con ChaCha20 para una ruta:
 *   - descifra el cuerpo que llega del navegador y lo deja en req.body en claro,
 *   - cifra todo lo que la ruta responde con res.json (también los errores).
 * El controlador trabaja siempre con texto en claro.
 *
 * @param {{ getSessionStore: () => object }} deps
 */
function createSecureTransport({ getSessionStore }) {
  return (req, res, next) => {
    const sessionStore = getSessionStore();
    const session = sessionStore.get(req.get(SESSION_HEADER));
    if (!session) {
      return res.status(401).json({
        error: { message: 'Sesión de cifrado inválida o expirada', code: SESSION_EXPIRED_CODE, status: 401 }
      });
    }

    if (req.body !== undefined && req.body !== null && Object.keys(req.body).length > 0) {
      if (!isEnvelope(req.body) || !sessionStore.rememberNonce(session, req.body.nonce)) {
        return res.status(400).json({ error: { message: 'Mensaje cifrado inválido o repetido', status: 400 } });
      }
      try {
        req.body = openJson(session.keys, session.id, DIRECTIONS.CLIENT_TO_SERVER, req.body);
      } catch {
        return res.status(400).json({ error: { message: 'Mensaje cifrado inválido o alterado', status: 400 } });
      }
    }

    req.secureSession = session;
    const sendJson = res.json.bind(res);
    res.json = (payload) => {
      res.set('X-Secure-Session', session.id);
      return sendJson(sealJson(session.keys, session.id, DIRECTIONS.SERVER_TO_CLIENT, payload));
    };
    next();
  };
}

module.exports = { createSecureTransport, SESSION_HEADER, SESSION_EXPIRED_CODE };
