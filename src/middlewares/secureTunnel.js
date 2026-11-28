const {
  DIRECTIONS,
  frameNonce,
  openFrame,
  packMessage,
  sealFrame,
  unpackMessage
} = require('../security/transport/transportCipher');
const { toHex } = require('../security/primitives/bytes');

/**
 * Túnel cifrado con ChaCha20 para TODA la API.
 *
 * El navegador envía cada petición como POST /api/secure/tunnel con una trama cifrada que contiene
 * el método, la ruta, las cabeceras (incluido el token) y el cuerpo reales. Este middleware:
 *   1. descifra y verifica la trama (firma, sesión, repetición, antigüedad),
 *   2. reescribe la petición para que siga su camino normal por las rutas de Express (en claro),
 *   3. captura la respuesta completa (JSON, PDF, descargas...) y la devuelve cifrada.
 * Las rutas y controladores no cambian: trabajan con texto en claro.
 */

const TUNNEL_PATH = '/api/secure/tunnel';
const SESSION_HEADER = 'x-secure-session';
const SESSION_EXPIRED_CODE = 'SECURE_SESSION_EXPIRED';
const CHANNEL_REQUIRED_CODE = 'SECURE_CHANNEL_REQUIRED';
// Rutas que pueden usarse sin túnel: el acuerdo de llave (aún no hay llave) y el estado del servidor
const PLAIN_ALLOWED = new Set(['/api/secure/handshake', '/api/health']);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const FORWARDED_HEADERS = new Set(['authorization', 'content-type', 'accept', 'accept-language', 'cache-control', 'pragma']);
// Cabeceras de la respuesta interna que no tienen sentido dentro del túnel
const SKIPPED_RESPONSE_HEADERS = new Set(['content-length', 'etag', 'x-powered-by', 'transfer-encoding', 'connection']);
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_URL_LENGTH = 4096;

class TunnelError extends Error {
  constructor(message, status = 400, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendPlainError(res, { status, message, code }) {
  return res.status(status).json({ error: { message, status, ...(code && { code }) } });
}

/** Lee el cuerpo completo de la petición (la trama cifrada) con un tamaño máximo. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new TunnelError('La petición cifrada supera el tamaño máximo permitido', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validateMeta(meta, now) {
  if (typeof meta.rid !== 'string' || meta.rid.length === 0 || meta.rid.length > 64) {
    throw new TunnelError('Petición cifrada sin identificador');
  }
  if (typeof meta.ts !== 'number' || Math.abs(now - meta.ts) > MAX_CLOCK_SKEW_MS) {
    throw new TunnelError('Petición cifrada fuera de tiempo (revisa la hora del equipo)');
  }
  const method = String(meta.method || '').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new TunnelError('Método no permitido en el canal cifrado');
  const url = String(meta.url || '');
  if (!/^\/api\/\S*$/.test(url) || url.length > MAX_URL_LENGTH) throw new TunnelError('Ruta inválida en el canal cifrado');
  const pathname = url.split('?')[0];
  if (pathname === TUNNEL_PATH || pathname === '/api/secure/handshake') {
    throw new TunnelError('Ruta no permitida dentro del canal cifrado');
  }
  return { method, url, headers: meta.headers && typeof meta.headers === 'object' ? meta.headers : {} };
}

/** Interpreta el cuerpo interno según su tipo, como lo harían express.json/urlencoded. */
function parseInnerBody(contentType, body) {
  if (body.length === 0) return undefined;
  const type = String(contentType || '').toLowerCase();
  const text = () => Buffer.from(body).toString('utf8');
  if (type.includes('application/json')) {
    try {
      return JSON.parse(text());
    } catch {
      throw new TunnelError('El cuerpo JSON de la petición no es válido');
    }
  }
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text()));
  if (type.startsWith('text/')) return text();
  return Buffer.from(body);
}

/** Reescribe la petición con los datos reales que venían cifrados. */
function applyInnerRequest(req, { method, url, headers }, body) {
  for (const name of [...FORWARDED_HEADERS, 'content-length', 'transfer-encoding', SESSION_HEADER]) {
    delete req.headers[name];
  }
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (FORWARDED_HEADERS.has(lower) && typeof value === 'string') req.headers[lower] = value;
  }
  req.headers['content-length'] = String(body.length);
  req.method = method;
  req.url = url;
  req.originalUrl = url;
  req.body = parseInnerBody(req.headers['content-type'], body);
}

/**
 * Captura todo lo que la ruta escriba en la respuesta (res.json, res.send, archivos, streams)
 * y al terminar lo envía como una sola trama cifrada. Las cabeceras de seguridad que ya puso
 * el servidor (helmet, CORS) se quedan afuera; las de la respuesta real viajan cifradas.
 */
function encryptResponse(res, session, rid) {
  const outerHeaders = new Set(res.getHeaderNames());
  const original = { write: res.write, end: res.end, writeHead: res.writeHead };
  const chunks = [];
  let finished = false;

  const toBuffer = (chunk, encoding) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));

  res.writeHead = function writeHead(statusCode, reason, headers) {
    res.statusCode = statusCode;
    const extra = typeof reason === 'object' ? reason : headers;
    if (extra) for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
    return res;
  };

  res.write = function write(chunk, encoding, callback) {
    const done = typeof encoding === 'function' ? encoding : callback;
    if (chunk !== undefined && chunk !== null) chunks.push(toBuffer(chunk, encoding));
    if (typeof done === 'function') process.nextTick(done);
    return true;
  };

  res.end = function end(chunk, encoding, callback) {
    if (finished) return res;
    finished = true;
    const done = [chunk, encoding, callback].find((arg) => typeof arg === 'function');
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') chunks.push(toBuffer(chunk, encoding));

    const innerHeaders = {};
    for (const name of res.getHeaderNames()) {
      if (outerHeaders.has(name) || SKIPPED_RESPONSE_HEADERS.has(name)) continue;
      const value = res.getHeader(name);
      innerHeaders[name] = Array.isArray(value) ? value.join(', ') : String(value);
      res.removeHeader(name);
    }

    const message = packMessage({ rid, status: res.statusCode, headers: innerHeaders }, Buffer.concat(chunks));
    const frame = Buffer.from(sealFrame(session.keys, session.id, DIRECTIONS.SERVER_TO_CLIENT, message));

    res.writeHead = original.writeHead;
    res.write = original.write;
    res.end = original.end;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(frame.length));
    res.setHeader('Cache-Control', 'no-store');
    return original.end.call(res, frame, done);
  };
}

/**
 * @param {{ getSessionStore: () => object, maxBytes: number, required: boolean, now?: () => number }} options
 */
function createSecureTunnel({ getSessionStore, maxBytes, required, now = () => Date.now() }) {
  return async (req, res, next) => {
    const pathname = req.path;

    if (pathname !== TUNNEL_PATH || req.method !== 'POST') {
      if (required && pathname.startsWith('/api/') && !PLAIN_ALLOWED.has(pathname)) {
        return sendPlainError(res, {
          status: 403,
          message: 'La API solo acepta peticiones por el canal cifrado',
          code: CHANNEL_REQUIRED_CODE
        });
      }
      return next();
    }

    try {
      const sessionStore = getSessionStore();
      const session = sessionStore.get(req.get(SESSION_HEADER));
      if (!session) throw new TunnelError('Sesión de cifrado inválida o expirada', 401, SESSION_EXPIRED_CODE);

      const frame = new Uint8Array(await readBody(req, maxBytes));
      let message;
      try {
        message = unpackMessage(openFrame(session.keys, session.id, DIRECTIONS.CLIENT_TO_SERVER, frame));
      } catch {
        throw new TunnelError('Mensaje cifrado inválido o alterado');
      }
      if (!sessionStore.rememberNonce(session, toHex(frameNonce(frame)))) {
        throw new TunnelError('Mensaje cifrado repetido');
      }

      const inner = validateMeta(message.meta, now());
      // Desde aquí todo lo que se responda (incluidos los errores) viaja cifrado
      encryptResponse(res, session, message.meta.rid);
      req.secureSession = session;
      try {
        applyInnerRequest(req, inner, message.body);
      } catch (error) {
        return sendPlainError(res, { status: error.status || 400, message: error.message });
      }
      return next();
    } catch (error) {
      if (res.headersSent) return next(error);
      if (error instanceof TunnelError) return sendPlainError(res, error);
      return next(error);
    }
  };
}

module.exports = { createSecureTunnel, TUNNEL_PATH, SESSION_EXPIRED_CODE, CHANNEL_REQUIRED_CODE };
