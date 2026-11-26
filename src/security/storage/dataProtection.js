const { encryptForStorage, decryptFromStorage, isEncryptedContent } = require('./storageCipher');
const { fromBase64, toBase64, utf8Decode } = require('../primitives/bytes');

/**
 * Cifrado de los datos guardados (base de datos, Storage y disco) con la llave de cada proyecto:
 *   guardar: dato -> Huffman -> AES-256-CTR     leer: lo mismo al revés
 *
 * Columnas de texto: "slenc1:<proyecto>:<base64>". El proyecto va visible (no es secreto) para
 * saber qué llave usar al leer; la firma amarra el dato a ese proyecto y a su columna.
 */
const FIELD_PREFIX = 'slenc1:';
const FIELD_PATTERN = /^slenc1:([0-9a-fA-F-]{36}):([A-Za-z0-9+/]*={0,2})$/;
const FILE_CONTEXT = 'file';

function fieldContext(projectId, column) {
  return `${projectId}|${column}`;
}

function isEncryptedField(value) {
  return typeof value === 'string' && value.startsWith(FIELD_PREFIX);
}

/**
 * @param {{ getProjectKey(projectId: string): Promise<Uint8Array> }} projectKeyService
 */
function createDataProtection({ projectKeyService }) {
  /** Cifra el valor de una columna de texto. null/undefined se guardan tal cual. */
  async function protectField(projectId, column, value) {
    if (value === null || value === undefined) return value;
    const id = String(projectId);
    const key = await projectKeyService.getProjectKey(id);
    const sealed = encryptForStorage(key, fieldContext(id, column), String(value));
    return `${FIELD_PREFIX}${id}:${toBase64(sealed)}`;
  }

  /** Descifra el valor de una columna. Lo que no está cifrado (datos anteriores) se devuelve igual. */
  async function revealField(value, column) {
    if (!isEncryptedField(value)) return value;
    const match = FIELD_PATTERN.exec(value);
    if (!match) throw new Error(`Valor cifrado inválido en la columna ${column}`);
    const [, projectId, payload] = match;
    const key = await projectKeyService.getProjectKey(projectId);
    return utf8Decode(decryptFromStorage(key, fieldContext(projectId, column), fromBase64(payload)));
  }

  /** Cifra un archivo (Storage o disco) del proyecto. */
  async function protectBytes(projectId, bytes) {
    const id = String(projectId);
    const key = await projectKeyService.getProjectKey(id);
    return Buffer.from(encryptForStorage(key, fieldContext(id, FILE_CONTEXT), new Uint8Array(bytes)));
  }

  /** Descifra un archivo; si es anterior al cifrado (sin el formato) se devuelve igual. */
  async function revealBytes(projectId, data) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!isEncryptedContent(bytes)) return Buffer.from(bytes);
    const id = String(projectId);
    const key = await projectKeyService.getProjectKey(id);
    return Buffer.from(decryptFromStorage(key, fieldContext(id, FILE_CONTEXT), bytes));
  }

  return { protectField, revealField, protectBytes, revealBytes };
}

module.exports = {
  createDataProtection,
  isEncryptedField,
  isEncryptedBytes: (data) => isEncryptedContent(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
  FIELD_PREFIX
};
