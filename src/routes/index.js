const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const documentRoutes = require('./documentRoutes');
const projectRoutes = require('./projectRoutes');
const invitationRoutes = require('./invitationRoutes');
const commentRoutes = require('./commentRoutes');
const secureRoutes = require('./secureRoutes');

// Rutas de autenticación
router.use('/auth', authRoutes);

// Rutas de documentos LaTeX
router.use('/documents', documentRoutes);

// Rutas de gestión de proyectos
router.use('/projects', projectRoutes);

// HU-25: invitaciones recibidas por el usuario
router.use('/invitations', invitationRoutes);

// HU-25: respuestas, edición, resolución y borrado de comentarios
router.use('/comments', commentRoutes);

// Canal cifrado: acuerdo de llave (Diffie-Hellman) y prueba del flujo de cifrado
router.use('/secure', secureRoutes);

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Retorna el estado actual del servidor backend
 *     tags: [Monitoreo]
 *     responses:
 *       200:
 *         description: El servidor está en línea
 */
router.get('/health', (req, res) => {
  res.json({ status: 'UP', timestamp: new Date() });
});

module.exports = router;

