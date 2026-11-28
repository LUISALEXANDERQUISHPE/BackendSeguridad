const { aes256Ctr, AES_BLOCK_SIZE, AES_KEY_SIZE } = require('../primitives/aes256ctr');
const { huffmanCompress, huffmanDecompress } = require('../primitives/huffman');
const { hmacSha256 } = require('../primitives/hmac');
const { hkdf } = require('../primitives/hkdf');
const { randomBytes } = require('../primitives/random');
const {
  concatBytes,
  constantTimeEqual,
  uint32BE,
  utf8Encode
} = require('../primitives/bytes');

/**
 * Formato de lo que se guarda (contenido y llaves):
 *   magia (4) | IV (16) | datos cifrados con AES-256-CTR | firma HMAC-SHA256 (32)
 *
 * La firma cubre magia, IV, cifrado y un "contexto" (ej. "<proyecto>|contenido_actual"):
 * un dato alterado, o copiado a otro proyecto o a otra columna, se rechaza en lugar de
 * devolver basura o el contenido de otro lugar.
 */
const CONTENT_MAGIC = utf8Encode('SLC1');
const KEY_MAGIC = utf8Encode('SLK1');
const MAGIC_SIZE = 4;
const TAG_SIZE = 32;
const MIN_SEALED_SIZE = MAGIC_SIZE + AES_BLOCK_SIZE + TAG_SIZE;

function deriveKeys(rootKey, purpose) {
  if (rootKey.length !== AES_KEY_SIZE) throw new Error('La llave debe tener 32 bytes');
  const material = hkdf(rootKey, new Uint8Array(0), `SecureLeaf ${purpose} v1`, 64);
  return { encryption: material.slice(0, 32), mac: material.slice(32, 64) };
}

function signedPart(magic, context, iv, ciphertext) {
  const contextBytes = utf8Encode(context);
  return concatBytes(magic, uint32BE(contextBytes.length), contextBytes, iv, ciphertext);
}

function seal(rootKey, purpose, magic, context, plaintext) {
  const { encryption, mac } = deriveKeys(rootKey, purpose);
  const iv = randomBytes(AES_BLOCK_SIZE);
  const ciphertext = aes256Ctr(encryption, iv, plaintext);
  const tag = hmacSha256(mac, signedPart(magic, context, iv, ciphertext));
  return concatBytes(magic, iv, ciphertext, tag);
}

function hasMagic(data, magic) {
  return data instanceof Uint8Array && data.length >= MIN_SEALED_SIZE &&
    constantTimeEqual(data.subarray(0, MAGIC_SIZE), magic);
}

function open(rootKey, purpose, magic, context, sealed) {
  if (!hasMagic(sealed, magic)) throw new Error('Los datos no tienen el formato cifrado esperado');
  const { encryption, mac } = deriveKeys(rootKey, purpose);
  const iv = sealed.subarray(MAGIC_SIZE, MAGIC_SIZE + AES_BLOCK_SIZE);
  const ciphertext = sealed.subarray(MAGIC_SIZE + AES_BLOCK_SIZE, sealed.length - TAG_SIZE);
  const tag = sealed.subarray(sealed.length - TAG_SIZE);

  const expected = hmacSha256(mac, signedPart(magic, context, iv, ciphertext));
  if (!constantTimeEqual(expected, tag)) throw new Error('Datos cifrados alterados o con otra llave');
  return aes256Ctr(encryption, iv, ciphertext);
}

/** Indica si unos bytes ya están cifrados con este formato (los datos anteriores al cifrado no lo están). */
function isEncryptedContent(data) {
  return hasMagic(data, CONTENT_MAGIC);
}

/**
 * Al guardar: bytes -> Huffman -> AES-256-CTR con la llave del proyecto.
 * @param {Uint8Array} projectKey 32 bytes
 * @param {string} context Dónde vive el dato (ej. "<proyecto>|contenido_actual"); se firma
 * @param {Uint8Array|string} content
 */
function encryptForStorage(projectKey, context, content) {
  const bytes = typeof content === 'string' ? utf8Encode(content) : content;
  return seal(projectKey, 'storage', CONTENT_MAGIC, context, huffmanCompress(bytes));
}

/** Al leer: AES-256-CTR -> Huffman -> bytes originales. */
function decryptFromStorage(projectKey, context, sealed) {
  return huffmanDecompress(open(projectKey, 'storage', CONTENT_MAGIC, context, sealed));
}

/** Protege la llave de un proyecto con la llave maestra (solo existe en el servidor). */
function wrapProjectKey(masterKey, projectId, projectKey) {
  if (projectKey.length !== AES_KEY_SIZE) throw new Error('La llave del proyecto debe tener 32 bytes');
  return seal(masterKey, 'key-wrap', KEY_MAGIC, String(projectId), projectKey);
}

function unwrapProjectKey(masterKey, projectId, wrappedKey) {
  return open(masterKey, 'key-wrap', KEY_MAGIC, String(projectId), wrappedKey);
}

module.exports = {
  encryptForStorage,
  decryptFromStorage,
  isEncryptedContent,
  wrapProjectKey,
  unwrapProjectKey
};
