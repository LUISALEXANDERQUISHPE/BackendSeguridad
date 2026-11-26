const { randomBytes } = require('./random');
const { toHex } = require('./bytes');

/**
 * Diffie-Hellman sobre un grupo MODP (p primo, g generador), implementado a mano con BigInt.
 *
 * Cada parte elige un secreto privado a, publica A = g^a mod p y calcula
 * s = B^a mod p con el valor público B de la otra parte. Ambos obtienen el mismo s
 * sin que s ni los secretos privados viajen por la red.
 */

const PRIVATE_KEY_BYTES = 32;

function bytesToBigInt(bytes) {
  return bytes.length ? BigInt(`0x${toHex(bytes)}`) : 0n;
}

function bigIntToBytes(value, length) {
  const hex = value.toString(16).padStart(length * 2, '0');
  if (hex.length > length * 2) throw new Error('Diffie-Hellman: valor más grande que el módulo');
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/** Exponenciación modular por cuadrados sucesivos. */
function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/**
 * Lee el grupo desde la configuración (primo en hexadecimal).
 * @returns {{ prime: bigint, generator: bigint, byteLength: number }}
 */
function createGroup(primeHex, generator) {
  const cleanHex = String(primeHex || '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(cleanHex)) throw new Error('Diffie-Hellman: primo inválido en la configuración');
  const prime = BigInt(`0x${cleanHex}`);
  const g = BigInt(generator);
  if (prime < 2n ** 2047n) throw new Error('Diffie-Hellman: el primo debe tener al menos 2048 bits');
  if (g < 2n || g >= prime - 1n) throw new Error('Diffie-Hellman: generador inválido');
  return { prime, generator: g, byteLength: Math.ceil(cleanHex.length / 2) };
}

/** Par de llaves efímero: el privado se queda en memoria, el público se envía. */
function generateKeyPair(group) {
  let privateKey = 0n;
  while (privateKey < 2n) privateKey = bytesToBigInt(randomBytes(PRIVATE_KEY_BYTES));
  const publicKey = modPow(group.generator, privateKey, group.prime);
  return { privateKey, publicKey: bigIntToBytes(publicKey, group.byteLength) };
}

/**
 * Secreto compartido a partir del valor público de la otra parte.
 * Rechaza valores triviales (0, 1, p-1 o fuera de rango) que forzarían un secreto conocido.
 */
function computeSharedSecret(group, privateKey, peerPublicBytes) {
  const peerPublic = bytesToBigInt(peerPublicBytes);
  if (peerPublic <= 1n || peerPublic >= group.prime - 1n) {
    throw new Error('Diffie-Hellman: valor público de la otra parte inválido');
  }
  const shared = modPow(peerPublic, privateKey, group.prime);
  return bigIntToBytes(shared, group.byteLength);
}

module.exports = {
  createGroup,
  generateKeyPair,
  computeSharedSecret,
  modPow
};
