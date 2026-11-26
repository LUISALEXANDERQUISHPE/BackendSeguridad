const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('../../src/security/primitives/random');
const { fromBase64 } = require('../../src/security/primitives/bytes');
const {
  encryptForStorage,
  decryptTextFromStorage,
  wrapProjectKey,
  unwrapProjectKey
} = require('../../src/security/storage/storageCipher');
const { createProjectKeyService, createInMemoryProjectKeyRepository } = require('../../src/security/storage/projectKeyService');
const { createSecureStorageService } = require('../../src/security/storage/secureStorageService');

function createStorage() {
  const repository = createInMemoryProjectKeyRepository();
  const masterKey = randomBytes(32);
  const projectKeyService = createProjectKeyService({ masterKey, repository });
  return { repository, masterKey, storage: createSecureStorageService({ projectKeyService }) };
}

const LONG_TEXT = '\\section{Capítulo} Texto con acentos, ñ y emojis 😀.\n'.repeat(60000);

describe('Almacenamiento cifrado (Huffman + AES-256-CTR)', () => {
  it('guarda y lee un documento largo sin perder nada', async () => {
    const { storage } = createStorage();
    const stored = await storage.protect('proyecto-1', LONG_TEXT);
    assert.ok(stored.length < Buffer.byteLength(LONG_TEXT), 'Huffman debe reducir el tamaño');
    assert.equal(await storage.reveal('proyecto-1', stored), LONG_TEXT);
  });

  it('lo guardado no contiene el texto en claro', async () => {
    const { storage } = createStorage();
    const stored = await storage.protect('proyecto-1', 'contenido-secreto-123');
    assert.ok(!Buffer.from(stored).includes('contenido-secreto-123'));
  });

  it('cifrar dos veces lo mismo produce resultados distintos (IV aleatorio)', async () => {
    const { storage } = createStorage();
    const a = await storage.protect('p', 'mismo texto');
    const b = await storage.protect('p', 'mismo texto');
    assert.notDeepEqual(a, b);
  });

  it('detecta datos alterados', async () => {
    const { storage } = createStorage();
    const stored = await storage.protect('p', 'texto');
    stored[stored.length - 40] ^= 0x01;
    await assert.rejects(() => storage.reveal('p', stored), /alterados/);
  });

  it('cada proyecto tiene su propia llave: lo de un proyecto no se abre como otro', async () => {
    const { storage } = createStorage();
    const stored = await storage.protect('proyecto-a', 'texto');
    await assert.rejects(() => storage.reveal('proyecto-b', stored));
  });

  it('la llave del proyecto se guarda solo protegida con la maestra', async () => {
    const { storage, repository, masterKey } = createStorage();
    await storage.protect('p', 'texto');
    const wrapped = fromBase64(await repository.findWrappedKey('p'));
    const projectKey = unwrapProjectKey(masterKey, 'p', wrapped);
    assert.equal(projectKey.length, 32);
    assert.ok(!Buffer.from(wrapped).includes(Buffer.from(projectKey)));
    assert.throws(() => unwrapProjectKey(randomBytes(32), 'p', wrapped), /alterados|otra llave/);
  });

  it('las funciones de bajo nivel son simétricas', () => {
    const projectKey = randomBytes(32);
    const masterKey = randomBytes(32);
    assert.equal(decryptTextFromStorage(projectKey, 'x', encryptForStorage(projectKey, 'x', 'hola')), 'hola');
    assert.deepEqual(unwrapProjectKey(masterKey, 'x', wrapProjectKey(masterKey, 'x', projectKey)), projectKey);
  });
});
