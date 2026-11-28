/**
 * ChaCha20 (RFC 8439) implementado a mano.
 * Cifra el canal entre el navegador y el servidor. Es un cifrado de flujo:
 * cifrar y descifrar son la misma operación (XOR con el flujo de llave).
 */

const KEY_SIZE = 32;
const NONCE_SIZE = 12;
const BLOCK_SIZE = 64;

// "expand 32-byte k" en little-endian
const CONSTANTS = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

function rotl(x, n) {
  return (x << n) | (x >>> (32 - n));
}

function readUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function quarterRound(s, a, b, c, d) {
  s[a] = (s[a] + s[b]) | 0; s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) | 0; s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotl(s[b] ^ s[c], 7);
}

/** Estado inicial: constantes | llave (8 palabras) | contador | nonce (3 palabras). */
function initialState(key, counter, nonce) {
  const state = new Uint32Array(16);
  state.set(CONSTANTS, 0);
  for (let i = 0; i < 8; i++) state[4 + i] = readUint32LE(key, i * 4);
  state[12] = counter >>> 0;
  for (let i = 0; i < 3; i++) state[13 + i] = readUint32LE(nonce, i * 4);
  return state;
}

/** Bloque de 64 bytes de flujo de llave: 20 rondas (10 dobles) y suma del estado inicial. */
function chacha20Block(state, output) {
  const working = new Uint32Array(state);
  for (let i = 0; i < 10; i++) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) {
    const word = (working[i] + state[i]) >>> 0;
    output[i * 4] = word & 0xff;
    output[i * 4 + 1] = (word >>> 8) & 0xff;
    output[i * 4 + 2] = (word >>> 16) & 0xff;
    output[i * 4 + 3] = (word >>> 24) & 0xff;
  }
}

/**
 * Cifra o descifra (es la misma operación).
 * @param {Uint8Array} key     32 bytes
 * @param {Uint8Array} nonce   12 bytes; nunca debe repetirse con la misma llave
 * @param {Uint8Array} input   Datos de cualquier longitud
 * @param {number} [counter=1] Contador del primer bloque (RFC 8439 usa 1 para datos)
 */
function chacha20(key, nonce, input, counter = 1) {
  if (key.length !== KEY_SIZE) throw new Error('ChaCha20: la llave debe tener 32 bytes');
  if (nonce.length !== NONCE_SIZE) throw new Error('ChaCha20: el nonce debe tener 12 bytes');

  const blocks = Math.ceil(input.length / BLOCK_SIZE);
  if (counter + blocks > 0x100000000) throw new Error('ChaCha20: mensaje demasiado largo');

  const state = initialState(key, counter, nonce);
  const keystream = new Uint8Array(BLOCK_SIZE);
  const output = new Uint8Array(input.length);

  for (let offset = 0; offset < input.length; offset += BLOCK_SIZE) {
    chacha20Block(state, keystream);
    const end = Math.min(BLOCK_SIZE, input.length - offset);
    for (let i = 0; i < end; i++) output[offset + i] = input[offset + i] ^ keystream[i];
    state[12] = (state[12] + 1) >>> 0;
  }
  return output;
}

module.exports = {
  chacha20,
  CHACHA20_KEY_SIZE: KEY_SIZE,
  CHACHA20_NONCE_SIZE: NONCE_SIZE
};
