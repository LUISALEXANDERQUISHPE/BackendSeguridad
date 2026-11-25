const express = require('express');
const router = express.Router();
const invitationController = require('../controllers/invitationController');
const authMiddleware = require('../middlewares/auth');

router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Invitaciones
 *   description: HU-25 Invitaciones a proyectos recibidas por el usuario (aceptar o rechazar)
 */

/**
 * @swagger
 * /api/invitations:
 *   get:
 *     summary: Invitaciones pendientes dirigidas al correo del usuario autenticado
 *     tags: [Invitaciones]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de invitaciones pendientes (proyecto, rol, quién invitó, vencimiento)
 */
router.get('/', invitationController.listMine);

/**
 * @swagger
 * /api/invitations/token/preview:
 *   post:
 *     summary: Ver a qué proyecto y con qué rol invita un enlace, antes de aceptarlo
 *     description: El token viaja en el cuerpo y no en la URL para que no quede en los registros de proxies.
 *     tags: [Invitaciones]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Datos de la invitación
 *       403:
 *         description: La invitación es para otro correo
 *       404:
 *         description: Enlace inválido
 *       409:
 *         description: Invitación ya usada, revocada o expirada
 */
router.post('/token/preview', invitationController.previewByToken);

/**
 * @swagger
 * /api/invitations/token/accept:
 *   post:
 *     summary: Aceptar una invitación con el enlace (solo la cuenta con el correo invitado)
 *     tags: [Invitaciones]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitación aceptada; el usuario ya es miembro del proyecto
 *       403:
 *         description: La invitación es para otro correo
 *       409:
 *         description: Invitación ya usada, revocada o expirada
 */
router.post('/token/accept', invitationController.acceptByToken);

/**
 * @swagger
 * /api/invitations/{invitationId}/accept:
 *   post:
 *     summary: Aceptar una invitación desde la bandeja de la aplicación
 *     tags: [Invitaciones]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invitación aceptada
 *       403:
 *         description: La invitación es para otro correo
 *       409:
 *         description: Invitación ya usada, revocada o expirada
 */
router.post('/:invitationId/accept', invitationController.accept);

/**
 * @swagger
 * /api/invitations/{invitationId}/decline:
 *   post:
 *     summary: Rechazar una invitación
 *     tags: [Invitaciones]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invitación rechazada
 */
router.post('/:invitationId/decline', invitationController.decline);

module.exports = router;
