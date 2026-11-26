const express = require('express');
const router = express.Router();
const config = require('../config');
const secureController = require('../controllers/secureController');

/**
 * @swagger
 * tags:
 *   name: Seguridad
 *   description: >
 *     Canal cifrado. Toda la API viaja por POST /api/secure/tunnel (ChaCha20 + HMAC-SHA256) con la llave
 *     acordada en /api/secure/handshake (Diffie-Hellman). Solo el acuerdo de llave y /api/health aceptan
 *     peticiones sin cifrar (con SECURE_TRANSPORT_REQUIRED=true).
 */

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
 * /api/secure/tunnel:
 *   post:
 *     summary: Túnel cifrado por el que viajan todas las peticiones de la API
 *     tags: [Seguridad]
 *     description: >
 *       Cuerpo binario nonce | ChaCha20(metadatos + cuerpo) | HMAC. Lo procesa el middleware secureTunnel
 *       antes de llegar a las rutas, por eso no tiene controlador propio.
 *     parameters:
 *       - in: header
 *         name: X-Secure-Session
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Respuesta cifrada (application/octet-stream)
 *       401:
 *         description: Sesión de cifrado inválida o expirada (code SECURE_SESSION_EXPIRED)
 */

/**
 * @swagger
 * /api/secure/diagnostics/roundtrip:
 *   post:
 *     summary: Prueba el flujo completo (ChaCha20 -> Huffman + AES -> ChaCha20). Solo si SECURE_DIAGNOSTICS_ENABLED=true
 *     tags: [Seguridad]
 *     responses:
 *       200:
 *         description: "{ content, report }"
 */
if (config.security.diagnosticsEnabled) {
  router.post('/diagnostics/roundtrip', secureController.diagnosticRoundtrip);
}

module.exports = router;
