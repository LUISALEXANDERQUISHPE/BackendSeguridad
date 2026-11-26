const { DIRECTIONS, openFrame, sealFrame } = require('../security/transport/transportCipher');
const { concatBytes, utf8Decode, utf8Encode } = require('../security/primitives/bytes');

/**
 * Cifrado ChaCha20 de una conexión WebSocket (edición en tiempo real y avisos).
 *
 * El navegador se conecta con ?sid=<sesión>&cid=<conexión>: el id de sesión elige las llaves
 * acordadas con Diffie-Hellman y el de conexión (nuevo cada vez) amarra las tramas a esta
 * conexión. Cada trama lleva un número de secuencia: una trama repetida, reordenada o de otra
 * conexión se rechaza.
 *
 * Expone la misma interfaz que usan la sala y los avisos (send, close, readyState, OPEN),
 * así ellos siguen enviando texto en claro sin saber que se cifra.
 */

const SEQUENCE_SIZE = 8;
const CHANNEL_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Close codes propios del canal cifrado. */
const SECURE_CLOSE_CODES = Object.freeze({
  // La sesión ya no existe (servidor reiniciado o vencida): el navegador acuerda otra y reconecta
  SESSION_EXPIRED: 4440,
  INVALID_FRAME: 4400
});

function encodeSequence(value) {
  const bytes = new Uint8Array(SEQUENCE_SIZE);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value));
  return bytes;
}

function decodeSequence(bytes) {
  return Number(new DataView(bytes.buffer, bytes.byteOffset, SEQUENCE_SIZE).getBigUint64(0));
}

/** Lee sid y cid de la URL de conexión. */
function parseChannelParams(requestUrl) {
  const url = new URL(requestUrl || '/', 'http://localhost');
  return { sessionId: url.searchParams.get('sid'), channelId: url.searchParams.get('cid') };
}

/**
 * @param {import('ws').WebSocket} socket
 * @param {{ id: string, keys: object }} session
 * @param {string} channelId
 */
function createSecureChannel(socket, session, channelId) {
  const channel = `${session.id}#${channelId}`;
  let outgoing = 0;
  let incoming = 0;

  return {
    socket,
    get readyState() {
      return socket.readyState;
    },
    get OPEN() {
      return socket.OPEN;
    },

    /** Cifra y envía un mensaje de texto (JSON). */
    send(text) {
      const plaintext = concatBytes(encodeSequence(outgoing++), utf8Encode(text));
      socket.send(sealFrame(session.keys, channel, DIRECTIONS.SERVER_TO_CLIENT, plaintext), { binary: true });
    },

    /**
     * Verifica y descifra una trama recibida. Lanza un error si está alterada, repetida o fuera de orden.
     * @returns {string}
     */
    decrypt(raw, isBinary) {
      if (!isBinary) throw new Error('Se esperaba una trama cifrada');
      const frame = raw instanceof Uint8Array ? raw : new Uint8Array(Buffer.concat([].concat(raw)));
      const plaintext = openFrame(session.keys, channel, DIRECTIONS.CLIENT_TO_SERVER, frame);
      if (plaintext.length < SEQUENCE_SIZE) throw new Error('Trama cifrada incompleta');
      if (decodeSequence(plaintext) !== incoming) throw new Error('Trama cifrada repetida o fuera de orden');
      incoming++;
      return utf8Decode(plaintext.subarray(SEQUENCE_SIZE));
    },

    close(code, reason) {
      socket.close(code, reason);
    }
  };
}

/**
 * Prepara el canal cifrado de una conexión nueva o la cierra si la sesión no es válida.
 * @returns {ReturnType<typeof createSecureChannel> | null}
 */
function openSecureChannel(socket, requestUrl, sessionStore) {
  const { sessionId, channelId } = parseChannelParams(requestUrl);
  const session = sessionStore.get(sessionId);
  if (!session) {
    socket.close(SECURE_CLOSE_CODES.SESSION_EXPIRED, 'SECURE_SESSION_EXPIRED');
    return null;
  }
  if (!CHANNEL_ID_PATTERN.test(channelId || '') || !sessionStore.claimChannel(session, channelId)) {
    socket.close(SECURE_CLOSE_CODES.INVALID_FRAME, 'Canal cifrado inválido');
    return null;
  }
  return createSecureChannel(socket, session, channelId);
}

module.exports = { createSecureChannel, openSecureChannel, SECURE_CLOSE_CODES };
