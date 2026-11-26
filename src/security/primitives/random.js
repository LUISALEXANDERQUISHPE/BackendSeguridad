const { randomBytes: systemRandomBytes } = require('crypto');

/**
 * Bytes aleatorios del generador seguro del sistema operativo.
 *
 * Es la única pieza que no se implementa a mano: un generador propio sería predecible.
 * Los algoritmos (ChaCha20, AES, Huffman, Diffie-Hellman, SHA-256) sí son propios.
 */
function randomBytes(length) {
  return new Uint8Array(systemRandomBytes(length));
}

module.exports = { randomBytes };
