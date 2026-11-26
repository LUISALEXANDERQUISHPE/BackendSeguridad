const { chacha20, CHACHA20_NONCE_SIZE } = require('../primitives/chacha20');
const { hmacSha256 } = require('../primitives/hmac');
const { hkdf } = require('../primitives/hkdf');
const { sha256 } = require('../primitives/sha256');
const { randomBytes } = require('../primitives/random');
const {
  concatBytes,
  constantTimeEqual,
  fromBase64,
  toBase64,
  uint32BE,
  utf8Decode,
  utf8Encode
} = require('../primitives/bytes');

/**
 * Cifrado del canal navegador <-> servidor: ChaCha20 + HMAC-SHA256 (cifrar y luego firmar).
 *
 * El navegador tiene una copia idéntica de este archivo (SeguridadFrontend/src/security/
 * transportCipher.ts): cualquier cambio de formato debe hacerse en ambos.
 */

const PROTOCOL_VERSION = 1;
const TAG_SIZE = 32;
const KEY_DERIVATION_INFO = 'SecureLeaf transport v1';

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

/** Datos asociados firmados (no cifrados): versión, sesión y dirección del mensaje. */
function associatedData(sessionId, direction) {
  const label = utf8Encode(`SecureLeaf-v${PROTOCOL_VERSION}|${sessionId}|${direction}`);
  return concatBytes(uint32BE(label.length), label);
}

function computeTag(macKey, sessionId, direction, nonce, ciphertext) {
  return hmacSha256(macKey, concatBytes(associatedData(sessionId, direction), nonce, ciphertext));
}

function directionKeys(keys, direction) {
  const selected = keys[direction];
  if (!selected) throw new Error('Dirección de cifrado desconocida');
  return selected;
}

/**
 * Cifra bytes para la dirección indicada.
 * @returns {{ nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array }}
 */
function sealBytes(keys, sessionId, direction, plaintext) {
  const { encryption, mac } = directionKeys(keys, direction);
  const nonce = randomBytes(CHACHA20_NONCE_SIZE);
  const ciphertext = chacha20(encryption, nonce, plaintext);
  const tag = computeTag(mac, sessionId, direction, nonce, ciphertext);
  return { nonce, ciphertext, tag };
}

/**
 * Verifica la firma y descifra. Si el mensaje fue alterado, truncado o pertenece a otra
 * sesión/dirección, falla antes de descifrar.
 */
function openBytes(keys, sessionId, direction, { nonce, ciphertext, tag }) {
  const { encryption, mac } = directionKeys(keys, direction);
  if (nonce.length !== CHACHA20_NONCE_SIZE || tag.length !== TAG_SIZE) {
    throw new Error('Mensaje cifrado con formato inválido');
  }
  const expected = computeTag(mac, sessionId, direction, nonce, ciphertext);
  if (!constantTimeEqual(expected, tag)) throw new Error('Mensaje cifrado alterado o incompleto');
  return chacha20(encryption, nonce, ciphertext);
}

/** Sobre JSON para peticiones HTTP: { v, sid, nonce, data, tag } en base64. */
function sealJson(keys, sessionId, direction, payload) {
  const json = JSON.stringify(payload === undefined ? null : payload);
  const { nonce, ciphertext, tag } = sealBytes(keys, sessionId, direction, utf8Encode(json));
  return {
    v: PROTOCOL_VERSION,
    sid: sessionId,
    nonce: toBase64(nonce),
    data: toBase64(ciphertext),
    tag: toBase64(tag)
  };
}

function isEnvelope(value) {
  return Boolean(value) && typeof value === 'object' &&
    typeof value.nonce === 'string' && typeof value.data === 'string' && typeof value.tag === 'string';
}

function openJson(keys, sessionId, direction, envelope) {
  if (!isEnvelope(envelope) || envelope.v !== PROTOCOL_VERSION || envelope.sid !== sessionId) {
    throw new Error('Mensaje cifrado con formato inválido');
  }
  const plaintext = openBytes(keys, sessionId, direction, {
    nonce: fromBase64(envelope.nonce),
    ciphertext: fromBase64(envelope.data),
    tag: fromBase64(envelope.tag)
  });
  return JSON.parse(utf8Decode(plaintext));
}

/** Trama binaria para WebSocket (edición en tiempo real): nonce | cifrado | firma. */
function sealFrame(keys, sessionId, direction, plaintext) {
  const { nonce, ciphertext, tag } = sealBytes(keys, sessionId, direction, plaintext);
  return concatBytes(nonce, ciphertext, tag);
}

function openFrame(keys, sessionId, direction, frame) {
  if (frame.length < CHACHA20_NONCE_SIZE + TAG_SIZE) throw new Error('Trama cifrada incompleta');
  return openBytes(keys, sessionId, direction, {
    nonce: frame.subarray(0, CHACHA20_NONCE_SIZE),
    ciphertext: frame.subarray(CHACHA20_NONCE_SIZE, frame.length - TAG_SIZE),
    tag: frame.subarray(frame.length - TAG_SIZE)
  });
}

module.exports = {
  DIRECTIONS,
  PROTOCOL_VERSION,
  deriveSessionKeys,
  sealBytes,
  openBytes,
  sealJson,
  openJson,
  isEnvelope,
  sealFrame,
  openFrame
};
