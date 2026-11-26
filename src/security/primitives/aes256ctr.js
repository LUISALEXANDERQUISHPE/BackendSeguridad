/**
 * AES-256 (FIPS 197) en modo CTR (NIST SP 800-38A), implementado a mano.
 * Cifra el contenido de los proyectos antes de guardarlo.
 *
 * En modo CTR solo se usa el cifrado de bloque: se cifra un contador y el resultado
 * se combina con XOR con los datos, así que cifrar y descifrar es la misma operación.
 */

const KEY_SIZE = 32;
const BLOCK_SIZE = 16;
const ROUNDS = 14;

function xtime(b) {
  return ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
}

function rotl8(x, n) {
  return ((x << n) | (x >>> (8 - n))) & 0xff;
}

/**
 * Genera la S-box recorriendo el grupo multiplicativo de GF(2^8):
 * p avanza multiplicando por 3 y q por su inverso, así q = p^-1 en cada paso;
 * después se aplica la transformación afín de AES.
 */
function buildSBox() {
  const sbox = new Uint8Array(256);
  let p = 1;
  let q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q = (q ^ (q << 1)) & 0xff;
    q = (q ^ (q << 2)) & 0xff;
    q = (q ^ (q << 4)) & 0xff;
    if (q & 0x80) q ^= 0x09;
    const affine = q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4);
    sbox[p] = affine ^ 0x63;
  } while (p !== 1);
  sbox[0] = 0x63;
  return sbox;
}

const SBOX = buildSBox();

/**
 * Tablas T: combinan SubBytes y MixColumns de una ronda en una consulta por byte.
 * T0[x] = [2·S(x), S(x), S(x), 3·S(x)]; T1..T3 son rotaciones de T0.
 */
const T0 = new Uint32Array(256);
const T1 = new Uint32Array(256);
const T2 = new Uint32Array(256);
const T3 = new Uint32Array(256);
for (let x = 0; x < 256; x++) {
  const s = SBOX[x];
  const s2 = xtime(s);
  const s3 = s2 ^ s;
  const word = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
  T0[x] = word;
  T1[x] = ((word >>> 8) | (word << 24)) >>> 0;
  T2[x] = ((word >>> 16) | (word << 16)) >>> 0;
  T3[x] = ((word >>> 24) | (word << 8)) >>> 0;
}

function subWord(w) {
  return ((SBOX[w >>> 24] << 24) | (SBOX[(w >>> 16) & 0xff] << 16) | (SBOX[(w >>> 8) & 0xff] << 8) | SBOX[w & 0xff]) >>> 0;
}

/** Expansión de llave de AES-256: 60 palabras (15 llaves de ronda). */
function expandKey(key) {
  if (key.length !== KEY_SIZE) throw new Error('AES-256: la llave debe tener 32 bytes');
  const words = new Uint32Array(4 * (ROUNDS + 1));
  for (let i = 0; i < 8; i++) {
    words[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  }
  let rcon = 0x01;
  for (let i = 8; i < words.length; i++) {
    let temp = words[i - 1];
    if (i % 8 === 0) {
      temp = subWord(((temp << 8) | (temp >>> 24)) >>> 0) ^ (rcon << 24);
      rcon = xtime(rcon);
    } else if (i % 8 === 4) {
      temp = subWord(temp);
    }
    words[i] = (words[i - 8] ^ temp) >>> 0;
  }
  return words;
}

function writeWord(out, offset, w) {
  out[offset] = w >>> 24;
  out[offset + 1] = (w >>> 16) & 0xff;
  out[offset + 2] = (w >>> 8) & 0xff;
  out[offset + 3] = w & 0xff;
}

/** Cifra un bloque de 16 bytes con las llaves de ronda ya expandidas. */
function encryptBlock(roundKeys, input, output) {
  let s0 = (((input[0] << 24) | (input[1] << 16) | (input[2] << 8) | input[3]) ^ roundKeys[0]) >>> 0;
  let s1 = (((input[4] << 24) | (input[5] << 16) | (input[6] << 8) | input[7]) ^ roundKeys[1]) >>> 0;
  let s2 = (((input[8] << 24) | (input[9] << 16) | (input[10] << 8) | input[11]) ^ roundKeys[2]) >>> 0;
  let s3 = (((input[12] << 24) | (input[13] << 16) | (input[14] << 8) | input[15]) ^ roundKeys[3]) >>> 0;

  let k = 4;
  for (let round = 1; round < ROUNDS; round++) {
    const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 0xff] ^ T2[(s2 >>> 8) & 0xff] ^ T3[s3 & 0xff] ^ roundKeys[k];
    const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 0xff] ^ T2[(s3 >>> 8) & 0xff] ^ T3[s0 & 0xff] ^ roundKeys[k + 1];
    const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 0xff] ^ T2[(s0 >>> 8) & 0xff] ^ T3[s1 & 0xff] ^ roundKeys[k + 2];
    const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 0xff] ^ T2[(s1 >>> 8) & 0xff] ^ T3[s2 & 0xff] ^ roundKeys[k + 3];
    s0 = t0 >>> 0;
    s1 = t1 >>> 0;
    s2 = t2 >>> 0;
    s3 = t3 >>> 0;
    k += 4;
  }

  // Última ronda: SubBytes + ShiftRows + AddRoundKey (sin MixColumns)
  const lastRound = (a, b, c, d, rk) =>
    (((SBOX[a >>> 24] << 24) | (SBOX[(b >>> 16) & 0xff] << 16) | (SBOX[(c >>> 8) & 0xff] << 8) | SBOX[d & 0xff]) ^ rk) >>> 0;

  writeWord(output, 0, lastRound(s0, s1, s2, s3, roundKeys[k]));
  writeWord(output, 4, lastRound(s1, s2, s3, s0, roundKeys[k + 1]));
  writeWord(output, 8, lastRound(s2, s3, s0, s1, roundKeys[k + 2]));
  writeWord(output, 12, lastRound(s3, s0, s1, s2, roundKeys[k + 3]));
}

/** Suma 1 al contador de 128 bits (big-endian). */
function incrementCounter(counter) {
  for (let i = BLOCK_SIZE - 1; i >= 0; i--) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) break;
  }
}

/**
 * Cifra o descifra con AES-256-CTR (es la misma operación).
 * @param {Uint8Array} key 32 bytes
 * @param {Uint8Array} iv  16 bytes: valor inicial del contador; nunca debe repetirse con la misma llave
 * @param {Uint8Array} input Datos de cualquier longitud
 */
function aes256Ctr(key, iv, input) {
  if (iv.length !== BLOCK_SIZE) throw new Error('AES-CTR: el IV debe tener 16 bytes');
  const roundKeys = expandKey(key);
  const counter = new Uint8Array(iv);
  const keystream = new Uint8Array(BLOCK_SIZE);
  const output = new Uint8Array(input.length);

  for (let offset = 0; offset < input.length; offset += BLOCK_SIZE) {
    encryptBlock(roundKeys, counter, keystream);
    const end = Math.min(BLOCK_SIZE, input.length - offset);
    for (let i = 0; i < end; i++) output[offset + i] = input[offset + i] ^ keystream[i];
    incrementCounter(counter);
  }
  return output;
}

/** Cifra un único bloque (para comprobar contra los vectores oficiales de FIPS 197). */
function aes256EncryptBlock(key, block) {
  const output = new Uint8Array(BLOCK_SIZE);
  encryptBlock(expandKey(key), block, output);
  return output;
}

module.exports = {
  aes256Ctr,
  aes256EncryptBlock,
  AES_KEY_SIZE: KEY_SIZE,
  AES_BLOCK_SIZE: BLOCK_SIZE
};
