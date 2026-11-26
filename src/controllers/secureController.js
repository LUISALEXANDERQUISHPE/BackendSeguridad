const { randomUUID } = require('crypto');
const { getSecurity } = require('../security');
const { sha256 } = require('../security/primitives/sha256');
const { huffmanCompress } = require('../security/primitives/huffman');
const { toHex, utf8Encode } = require('../security/primitives/bytes');
const { ValidationError } = require('../errors/AppError');

/**
 * POST /api/secure/handshake
 * Diffie-Hellman: recibe el valor público del navegador y devuelve el del servidor.
 */
exports.handshake = (req, res, next) => {
  try {
    const result = getSecurity().handshakeService.handshake(req.body?.clientPublicKey);
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/secure/diagnostics/roundtrip (solo llega por el túnel cifrado)
 * Prueba de punta a punta del flujo completo con un texto enviado por el navegador:
 *   1. llega cifrado con ChaCha20 (el túnel ya lo descifró y verificó su firma),
 *   2. se guarda: Huffman + AES-256-CTR con una llave de proyecto protegida por la maestra,
 *   3. se lee: AES-256-CTR + Huffman al revés,
 *   4. se compara con lo recibido y se devuelve cifrado otra vez con ChaCha20.
 * Usa llaves en memoria: no toca proyectos reales.
 */
exports.diagnosticRoundtrip = async (req, res, next) => {
  try {
    const { content } = req.body || {};
    if (typeof content !== 'string') throw new ValidationError('El campo content debe ser texto');

    const protection = getSecurity().diagnosticsProtection;
    const projectId = randomUUID();
    const plainBytes = utf8Encode(content);
    const stored = await protection.protectField(projectId, 'contenido_actual', content);
    const restored = await protection.revealField(stored, 'contenido_actual');

    return res.json({
      content: restored,
      report: {
        receivedBytes: plainBytes.length,
        receivedSha256: toHex(sha256(plainBytes)),
        huffmanBytes: huffmanCompress(plainBytes).length,
        storedBytes: Buffer.byteLength(stored),
        storageRoundtripOk: restored === content
      }
    });
  } catch (error) {
    next(error);
  }
};
