const config = require('../config');
const { fromHex } = require('./primitives/bytes');
const { createGroup } = require('./primitives/diffieHellman');
const { createSessionStore } = require('./transport/sessionStore');
const { createHandshakeService } = require('./transport/handshakeService');
const {
  createProjectKeyService,
  createInMemoryProjectKeyRepository,
  createSupabaseProjectKeyRepository
} = require('./storage/projectKeyService');
const { createDataProtection } = require('./storage/dataProtection');
const { createProjectResolver } = require('./database/projectResolver');

/**
 * Arma los servicios de seguridad con los valores del .env.
 * Se crean la primera vez que se piden para que un .env incompleto falle con un
 * mensaje claro al usarlos.
 */

let instance = null;

function readMasterKey(hex) {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex.trim())) {
    throw new Error('CRYPTO_MASTER_KEY debe tener 64 caracteres hexadecimales (32 bytes) en el .env');
  }
  return fromHex(hex.trim());
}

function build() {
  const { security } = config;
  if (!security.dhPrimeHex) throw new Error('Falta DH_PRIME_HEX en el .env');

  const masterKey = readMasterKey(security.masterKeyHex);
  const rawDatabase = require('../config/supabase').raw;

  // Canal navegador <-> servidor (Diffie-Hellman + ChaCha20)
  const sessionStore = createSessionStore({ ttlMs: security.sessionTtlMs });
  const handshakeService = createHandshakeService({
    group: createGroup(security.dhPrimeHex, security.dhGenerator),
    sessionStore
  });

  // Datos guardados (Huffman + AES con la llave de cada proyecto, protegida por la maestra)
  const projectKeyService = createProjectKeyService({
    masterKey,
    repository: createSupabaseProjectKeyRepository(rawDatabase)
  });
  const dataProtection = createDataProtection({ projectKeyService });

  // Diagnóstico: mismo flujo con llaves solo en memoria (no toca proyectos reales)
  const diagnosticsProtection = createDataProtection({
    projectKeyService: createProjectKeyService({ masterKey, repository: createInMemoryProjectKeyRepository() })
  });

  return {
    sessionStore,
    handshakeService,
    projectKeyService,
    dataProtection,
    diagnosticsProtection,
    projectResolver: createProjectResolver(rawDatabase)
  };
}

function getSecurity() {
  if (!instance) instance = build();
  return instance;
}

module.exports = { getSecurity };
