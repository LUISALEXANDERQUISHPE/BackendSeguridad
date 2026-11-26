const { generateKeyPair, computeSharedSecret } = require('../primitives/diffieHellman');
const { randomBytes } = require('../primitives/random');
const { fromBase64, toBase64, toHex } = require('../primitives/bytes');
const { deriveSessionKeys } = require('./transportCipher');
const { ValidationError } = require('../../errors/AppError');

/**
 * Acuerdo de llave con el navegador (Diffie-Hellman).
 * Por la red solo viajan los valores públicos; la llave de la sesión se calcula en cada lado.
 */
function createHandshakeService({ group, sessionStore }) {
  function handshake(clientPublicKeyBase64) {
    let clientPublicKey;
    try {
      clientPublicKey = fromBase64(clientPublicKeyBase64);
    } catch {
      throw new ValidationError('Valor público de Diffie-Hellman inválido');
    }
    if (clientPublicKey.length !== group.byteLength) {
      throw new ValidationError('Valor público de Diffie-Hellman con longitud inválida');
    }

    const serverKeyPair = generateKeyPair(group);
    let sharedSecret;
    try {
      sharedSecret = computeSharedSecret(group, serverKeyPair.privateKey, clientPublicKey);
    } catch {
      throw new ValidationError('Valor público de Diffie-Hellman inválido');
    }

    const keys = deriveSessionKeys(sharedSecret, clientPublicKey, serverKeyPair.publicKey);
    const session = sessionStore.save(toHex(randomBytes(16)), keys);

    return {
      sessionId: session.id,
      serverPublicKey: toBase64(serverKeyPair.publicKey),
      expiresAt: new Date(session.expiresAt).toISOString(),
      // El navegador corrige con esto la hora de sus peticiones (el túnel rechaza las viejas)
      serverTime: Date.now()
    };
  }

  return { handshake };
}

module.exports = { createHandshakeService };
