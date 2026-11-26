const { sha256, SHA256_BLOCK_SIZE } = require('./sha256');
const { concatBytes } = require('./bytes');

/**
 * HMAC-SHA256 (RFC 2104). Firma cada mensaje cifrado para detectar si fue
 * alterado o llegó incompleto: ChaCha20 y AES-CTR por sí solos no lo detectan.
 */
function hmacSha256(key, message) {
  const blockKey = new Uint8Array(SHA256_BLOCK_SIZE);
  blockKey.set(key.length > SHA256_BLOCK_SIZE ? sha256(key) : key);

  const innerPad = new Uint8Array(SHA256_BLOCK_SIZE);
  const outerPad = new Uint8Array(SHA256_BLOCK_SIZE);
  for (let i = 0; i < SHA256_BLOCK_SIZE; i++) {
    innerPad[i] = blockKey[i] ^ 0x36;
    outerPad[i] = blockKey[i] ^ 0x5c;
  }

  return sha256(concatBytes(outerPad, sha256(concatBytes(innerPad, message))));
}

module.exports = { hmacSha256 };
