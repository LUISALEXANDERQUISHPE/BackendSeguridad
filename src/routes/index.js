const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const documentRoutes = require('./documentRoutes');
const projectRoutes = require('./projectRoutes');

// Rutas de autenticación
router.use('/auth', authRoutes);

// Rutas de documentos LaTeX
router.use('/documents', documentRoutes);

// Rutas de gestión de proyectos
router.use('/projects', projectRoutes);

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

