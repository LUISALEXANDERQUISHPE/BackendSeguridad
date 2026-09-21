const express = require('express');
const router = express.Router();
const authRoutes = require('./authRoutes');
const documentRoutes = require('./documentRoutes');

// Rutas de autenticación
router.use('/auth', authRoutes);

// Rutas de documentos LaTeX
router.use('/documents', documentRoutes);

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

