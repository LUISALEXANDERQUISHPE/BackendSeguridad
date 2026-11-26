const { chacha20, CHACHA20_NONCE_SIZE } = require('../primitives/chacha20');
const { hmacSha256 } = require('../primitives/hmac');
const { hkdf } = require('../primitives/hkdf');
const { sha256 } = require('../primitives/sha256');
const { randomBytes } = require('../primitives/random');
const {
  concatBytes,
  constantTimeEqual,
  readUint32BE,
  uint32BE,
  utf8Decode,
  utf8Encode
} = require('../primitives/bytes');

/**
 * Cifrado del canal navegador <-> servidor: ChaCha20 + HMAC-SHA256 (cifrar y luego firmar).
 *
 * El navegador tiene una copia equivalente (SeguridadFrontend/src/security/transportCipher.ts):
 * cualquier cambio de formato debe hacerse en ambos.
 */

const PROTOCOL_VERSION = 1;
const TAG_SIZE = 32;
const KEY_DERIVATION_INFO = 'SecureLeaf transport v1';
const MAX_META_BYTES = 64 * 1024;

/** Cada dirección usa sus propias llaves: un mensaje del servidor no sirve como uno del cliente. */
const DIRECTIONS = Object.freeze({
  CLIENT_TO_SERVER: 'c2s',
  SERVER_TO_CLIENT: 's2c'
});

/**
 * Deriva las llaves de la sesión a partir del secreto de Diffie-Hellman.
 * La sal amarra las llaves a los dos valores públicos intercambiados.
 */
function deriveSessionKeys(sharedSecret, clientPublicKey, serverPublicKey) {
  const salt = sha256(concatBytes(clientPublicKey, serverPublicKey));
  const material = hkdf(sharedSecret, salt, KEY_DERIVATION_INFO, 128);
  return {
    [DIRECTIONS.CLIENT_TO_SERVER]: { encryption: material.slice(0, 32), mac: material.slice(32, 64) },
    [DIRECTIONS.SERVER_TO_CLIENT]: { encryption: material.slice(64, 96), mac: material.slice(96, 128) }
  };
}

/**
 * Datos asociados firmados (no cifrados): versión, canal y dirección del mensaje.
 * "channel" es la sesión (HTTP) o "sesión#conexión" (WebSocket): un mensaje de un canal
 * no se acepta en otro.
 */
function associatedData(channel, direction) {
  const label = utf8Encode(`SecureLeaf-v${PROTOCOL_VERSION}|${channel}|${direction}`);
  return concatBytes(uint32BE(label.length), label);
}

function directionKeys(keys, direction) {
  const selected = keys[direction];
  if (!selected) throw new Error('Dirección de cifrado desconocida');
  return selected;
}

/** Trama cifrada: nonce (12) | datos cifrados con ChaCha20 | firma (32). */
function sealFrame(keys, channel, direction, plaintext) {
  const { encryption, mac } = directionKeys(keys, direction);
  const nonce = randomBytes(CHACHA20_NONCE_SIZE);
  const ciphertext = chacha20(encryption, nonce, plaintext);
  const tag = hmacSha256(mac, concatBytes(associatedData(channel, direction), nonce, ciphertext));
  return concatBytes(nonce, ciphertext, tag);
}

/**
 * Verifica la firma y descifra. Si la trama fue alterada, truncada o pertenece a otro
 * canal/dirección, falla antes de descifrar.
 */
function openFrame(keys, channel, direction, frame) {
  if (!(frame instanceof Uint8Array) || frame.length < CHACHA20_NONCE_SIZE + TAG_SIZE) {
    throw new Error('Trama cifrada incompleta');
  }
  const { encryption, mac } = directionKeys(keys, direction);
  const nonce = frame.subarray(0, CHACHA20_NONCE_SIZE);
  const ciphertext = frame.subarray(CHACHA20_NONCE_SIZE, frame.length - TAG_SIZE);
  const tag = frame.subarray(frame.length - TAG_SIZE);
  const expected = hmacSha256(mac, concatBytes(associatedData(channel, direction), nonce, ciphertext));
  if (!constantTimeEqual(expected, tag)) throw new Error('Mensaje cifrado alterado o incompleto');
  return chacha20(encryption, nonce, ciphertext);
}

/** Nonce de una trama (sirve para detectar tramas repetidas). */
function frameNonce(frame) {
  return frame.subarray(0, CHACHA20_NONCE_SIZE);
}

/**
 * Mensaje del túnel HTTP antes de cifrar: largo de metadatos (4) | metadatos JSON | cuerpo.
 * Los metadatos llevan método, ruta y cabeceras (petición) o estado y cabeceras (respuesta).
 */
function packMessage(meta, body) {
  const metaBytes = utf8Encode(JSON.stringify(meta));
  return concatBytes(uint32BE(metaBytes.length), metaBytes, body ?? new Uint8Array(0));
}

function unpackMessage(bytes) {
  if (bytes.length < 4) throw new Error('Mensaje del túnel incompleto');
  const metaLength = readUint32BE(bytes, 0);
  if (metaLength > MAX_META_BYTES || 4 + metaLength > bytes.length) throw new Error('Mensaje del túnel inválido');
  const meta = JSON.parse(utf8Decode(bytes.subarray(4, 4 + metaLength)));
  if (!meta || typeof meta !== 'object') throw new Error('Mensaje del túnel inválido');
  return { meta, body: bytes.subarray(4 + metaLength) };
}

module.exports = {
  DIRECTIONS,
  PROTOCOL_VERSION,
  deriveSessionKeys,
  sealFrame,
  openFrame,
  frameNonce,
  packMessage,
  unpackMessage
};
