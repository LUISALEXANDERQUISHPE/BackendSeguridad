const { hmacSha256 } = require('./hmac');
const { SHA256_DIGEST_SIZE } = require('./sha256');
const { concatBytes, utf8Encode } = require('./bytes');

/**
 * HKDF-SHA256 (RFC 5869): convierte un secreto (el de Diffie-Hellman o la llave maestra)
 * en varias llaves independientes, una para cada uso (cifrar, firmar, cada dirección).
 *
 * @param {Uint8Array} inputKey  Secreto de entrada
 * @param {Uint8Array} salt      Sal (puede ser vacía)
 * @param {string|Uint8Array} info Etiqueta del uso; llaves con distinta etiqueta son independientes
 * @param {number} length        Bytes a generar
 */
function hkdf(inputKey, salt, info, length) {
  const infoBytes = typeof info === 'string' ? utf8Encode(info) : info;
  const prk = hmacSha256(salt && salt.length ? salt : new Uint8Array(SHA256_DIGEST_SIZE), inputKey);

  const blocks = Math.ceil(length / SHA256_DIGEST_SIZE);
  if (blocks > 255) throw new Error('HKDF: longitud solicitada demasiado grande');

  const output = new Uint8Array(blocks * SHA256_DIGEST_SIZE);
  let previous = new Uint8Array(0);
  for (let i = 1; i <= blocks; i++) {
    previous = hmacSha256(prk, concatBytes(previous, infoBytes, Uint8Array.of(i)));
    output.set(previous, (i - 1) * SHA256_DIGEST_SIZE);
  }
  return output.slice(0, length);
}

module.exports = { hkdf };
