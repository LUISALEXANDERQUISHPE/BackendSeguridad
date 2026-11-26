const config = require('../config');
const { fromHex } = require('./primitives/bytes');
const { createGroup } = require('./primitives/diffieHellman');
const { createSessionStore } = require('./transport/sessionStore');
const { createHandshakeService } = require('./transport/handshakeService');
const { createProjectKeyService, createInMemoryProjectKeyRepository } = require('./storage/projectKeyService');
const { createSecureStorageService } = require('./storage/secureStorageService');

/**
 * Arma los servicios de seguridad con los valores del .env.
 * Se crean la primera vez que se piden para que un .env incompleto falle con un
 * mensaje claro al usarlos, sin impedir que arranque el resto del servidor.
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

  const sessionStore = createSessionStore({ ttlMs: security.sessionTtlMs });
  const handshakeService = createHandshakeService({
    group: createGroup(security.dhPrimeHex, security.dhGenerator),
    sessionStore
  });

  const projectKeyService = createProjectKeyService({
    masterKey: readMasterKey(security.masterKeyHex),
    repository: createInMemoryProjectKeyRepository()
  });

  return {
    sessionStore,
    handshakeService,
    secureStorage: createSecureStorageService({ projectKeyService })
  };
}

function getSecurity() {
  if (!instance) instance = build();
  return instance;
}

module.exports = { getSecurity };
