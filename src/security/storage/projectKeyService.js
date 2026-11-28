const { AES_KEY_SIZE } = require('../primitives/aes256ctr');
const { randomBytes } = require('../primitives/random');
const { fromBase64, toBase64 } = require('../primitives/bytes');
const { wrapProjectKey, unwrapProjectKey } = require('./storageCipher');

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_CACHE_SIZE = 1000;

/**
 * Llave propia de cada proyecto.
 * Se genera al azar y se guarda SOLO protegida con la llave maestra (proyectos.llave_cifrada);
 * en claro existe únicamente en memoria, en una caché corta para no repetir el trabajo.
 *
 * @param {object} deps
 * @param {Uint8Array} deps.masterKey Llave maestra (32 bytes) leída del .env
 * @param {{
 *   findWrappedKey(projectId: string): Promise<string|null>,
 *   saveWrappedKeyIfMissing(projectId: string, wrapped: string): Promise<void>
 * }} deps.repository Dónde se guarda la llave protegida (base64)
 */
function createProjectKeyService({
  masterKey,
  repository,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  cacheSize = DEFAULT_CACHE_SIZE,
  now = () => Date.now()
}) {
  if (!(masterKey instanceof Uint8Array) || masterKey.length !== AES_KEY_SIZE) {
    throw new Error('La llave maestra debe tener 32 bytes');
  }

  /** @type {Map<string, { key: Uint8Array, expiresAt: number }>} */
  const cache = new Map();
  /** @type {Map<string, Promise<Uint8Array>>} evita crear dos llaves a la vez para el mismo proyecto */
  const loading = new Map();

  function remember(projectId, key) {
    if (cache.size >= cacheSize) cache.delete(cache.keys().next().value);
    cache.set(projectId, { key, expiresAt: now() + cacheTtlMs });
    return key;
  }

  function cached(projectId) {
    const entry = cache.get(projectId);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(projectId);
      return null;
    }
    return entry.key;
  }

  /**
   * Llave nueva para un proyecto que se está creando: se guarda junto con el proyecto
   * (en el mismo insert), así nunca existe un proyecto sin llave.
   * @returns {{ key: Uint8Array, wrapped: string }}
   */
  function createKeyRecord(projectId) {
    const key = randomBytes(AES_KEY_SIZE);
    const wrapped = toBase64(wrapProjectKey(masterKey, projectId, key));
    remember(projectId, key);
    return { key, wrapped };
  }

  async function load(projectId) {
    let stored = await repository.findWrappedKey(projectId);
    if (!stored) {
      // Proyecto anterior al cifrado: se le crea su llave. Si dos peticiones lo intentan a la vez,
      // el repositorio solo guarda la primera y ambas usan la que quedó guardada.
      const candidate = toBase64(wrapProjectKey(masterKey, projectId, randomBytes(AES_KEY_SIZE)));
      await repository.saveWrappedKeyIfMissing(projectId, candidate);
      stored = await repository.findWrappedKey(projectId);
      if (!stored) throw new Error(`No se pudo crear la llave del proyecto ${projectId}`);
    }
    return remember(projectId, unwrapProjectKey(masterKey, projectId, fromBase64(stored)));
  }

  async function getProjectKey(projectId) {
    const id = String(projectId);
    const hit = cached(id);
    if (hit) return hit;
    if (!loading.has(id)) {
      const pending = load(id).finally(() => loading.delete(id));
      loading.set(id, pending);
    }
    return loading.get(id);
  }

  return { getProjectKey, createKeyRecord };
}

/** Repositorio en memoria (pruebas y diagnóstico). */
function createInMemoryProjectKeyRepository() {
  const wrappedKeys = new Map();
  return {
    async findWrappedKey(projectId) {
      return wrappedKeys.get(projectId) ?? null;
    },
    async saveWrappedKeyIfMissing(projectId, wrapped) {
      if (!wrappedKeys.has(projectId)) wrappedKeys.set(projectId, wrapped);
    }
  };
}

/**
 * Repositorio sobre la columna proyectos.llave_cifrada.
 * Usa el cliente de Supabase SIN la capa de cifrado (la llave ya va protegida).
 */
function createSupabaseProjectKeyRepository(rawClient) {
  return {
    async findWrappedKey(projectId) {
      const { data, error } = await rawClient.from('proyectos').select('llave_cifrada').eq('id', projectId).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`El proyecto ${projectId} no existe`);
      return data.llave_cifrada || null;
    },
    async saveWrappedKeyIfMissing(projectId, wrapped) {
      // Condición "is null": si otra petición ya guardó una llave, esta no la reemplaza
      const { error } = await rawClient.from('proyectos').update({ llave_cifrada: wrapped })
        .eq('id', projectId).is('llave_cifrada', null);
      if (error) throw error;
    }
  };
}

module.exports = {
  createProjectKeyService,
  createInMemoryProjectKeyRepository,
  createSupabaseProjectKeyRepository
};
