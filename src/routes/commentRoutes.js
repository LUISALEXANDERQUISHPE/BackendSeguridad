const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');
const authMiddleware = require('../middlewares/auth');

router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Comentarios
 *   description: HU-25 Comentarios en hilos sobre fragmentos del documento (responder, editar, resolver, eliminar)
 */

/**
 * @swagger
 * /api/comments/{commentId}/replies:
 *   post:
 *     summary: Responder en un hilo abierto (propietario o editor)
 *     tags: [Comentarios]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 maxLength: 2000
 *     responses:
 *       201:
 *         description: Respuesta creada
 *       403:
 *         description: El lector no puede responder
 *       409:
 *         description: El hilo está resuelto
 */
router.post('/:commentId/replies', commentController.reply);

/**
 * @swagger
 * /api/comments/{commentId}:
 *   patch:
 *     summary: Editar un comentario propio
 *     tags: [Comentarios]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Comentario editado
 *       403:
 *         description: Solo el autor puede editarlo
 *   delete:
 *     summary: Eliminar un comentario (su autor, o propietario/editor). Si es el principal, se borra el hilo.
 *     tags: [Comentarios]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Comentario eliminado
 *       403:
 *         description: Sin permisos para eliminarlo
 */
router.patch('/:commentId', commentController.edit);
router.delete('/:commentId', commentController.remove);

/**
 * @swagger
 * /api/comments/{commentId}/resolve:
 *   post:
 *     summary: Marcar un hilo como resuelto (propietario o editor)
 *     tags: [Comentarios]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Hilo resuelto
 * /api/comments/{commentId}/reopen:
 *   post:
 *     summary: Reabrir un hilo resuelto (propietario o editor)
 *     tags: [Comentarios]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Hilo reabierto
 */
router.post('/:commentId/resolve', commentController.resolve);
router.post('/:commentId/reopen', commentController.reopen);

module.exports = router;
