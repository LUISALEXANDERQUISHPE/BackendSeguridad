const express = require('express');
const router = express.Router();
const config = require('../config');
const secureController = require('../controllers/secureController');
const { createSecureTransport } = require('../middlewares/secureTransport');
const { getSecurity } = require('../security');

const secureTransport = createSecureTransport({ getSessionStore: () => getSecurity().sessionStore });

/**
 * @swagger
 * /api/secure/handshake:
 *   post:
 *     summary: Acuerda con Diffie-Hellman la llave temporal del canal cifrado (ChaCha20)
 *     tags: [Seguridad]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientPublicKey]
 *             properties:
 *               clientPublicKey:
 *                 type: string
 *                 description: Valor público g^a mod p del navegador, en base64
 *     responses:
 *       201:
 *         description: Sesión creada; devuelve sessionId, serverPublicKey y expiresAt
 *       400:
 *         description: Valor público inválido
 */
router.post('/handshake', secureController.handshake);

/**
 * @swagger
 * /api/secure/diagnostics/roundtrip:
 *   post:
 *     summary: Prueba el flujo completo (ChaCha20 -> Huffman + AES -> ChaCha20). Solo si SECURE_DIAGNOSTICS_ENABLED=true
 *     tags: [Seguridad]
 *     parameters:
 *       - in: header
 *         name: X-Secure-Session
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Sobre cifrado { v, sid, nonce, data, tag } cuyo contenido es { content }
 *     responses:
 *       200:
 *         description: Sobre cifrado con { content, report }
 *       401:
 *         description: Sesión de cifrado inválida o expirada
 */
if (config.security.diagnosticsEnabled) {
  router.post('/diagnostics/roundtrip', secureTransport, secureController.diagnosticRoundtrip);
}

module.exports = router;
