const express = require('express');
const templateController = require('../controllers/templateController');
const authMiddleware = require('../middlewares/auth');

const router = express.Router();

// El catálogo de plantillas solo se muestra a usuarios con sesión iniciada
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Plantillas
 *   description: >
 *     Plantillas LaTeX del sistema (tesis, artículos, presentaciones...). Son de solo lectura:
 *     para usar una, crea un proyecto con POST /api/projects enviando { templateId }; el proyecto
 *     es una copia independiente y la plantilla base nunca se modifica.
 */

/**
 * @swagger
 * /api/templates:
 *   get:
 *     summary: Listar las plantillas disponibles
 *     tags: [Plantillas]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Catálogo de plantillas (nombre, categoría, descripción y etiquetas)
 *       401:
 *         description: No autenticado
 */
router.get('/', templateController.listTemplates);

/**
 * @swagger
 * /api/templates/{id}:
 *   get:
 *     summary: Detalle de una plantilla con sus archivos y el código del archivo principal
 *     tags: [Plantillas]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Plantilla con la lista de archivos que se copiarán
 *       400:
 *         description: Identificador inválido
 *       404:
 *         description: Plantilla no encontrada
 */
router.get('/:id', templateController.getTemplate);

/**
 * @swagger
 * /api/templates/{id}/preview:
 *   get:
 *     summary: Vista previa en PDF de la plantilla
 *     tags: [Plantillas]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: PDF de ejemplo de la plantilla
 *         content:
 *           application/pdf: {}
 *       404:
 *         description: Plantilla o vista previa no encontrada
 */
router.get('/:id/preview', templateController.getPreview);

module.exports = router;
