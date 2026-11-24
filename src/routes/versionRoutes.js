const express = require('express');
const versionController = require('../controllers/versionController');

// mergeParams: recibe el :id del documento desde la ruta padre (/api/documents/:id/versions)
const router = express.Router({ mergeParams: true });

/**
 * @swagger
 * tags:
 *   name: Versiones
 *   description: Control de versiones e historial de un archivo (registrar, comparar y restaurar)
 *
 * components:
 *   parameters:
 *     DocumentId:
 *       in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: string
 *         format: uuid
 *       description: Identificador del archivo
 *     VersionNumber:
 *       in: path
 *       name: number
 *       required: true
 *       schema:
 *         type: integer
 *         minimum: 1
 */

/**
 * @swagger
 * /api/documents/{id}/versions:
 *   get:
 *     summary: Historial de versiones del archivo (más reciente primero), con líneas agregadas y eliminadas
 *     tags: [Versiones]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DocumentId'
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *     responses:
 *       200:
 *         description: Página del historial y si hay cambios posteriores a la última versión
 *       400:
 *         description: Identificador inválido o archivo binario
 *       403:
 *         description: Sin acceso al proyecto
 *       404:
 *         description: Archivo no encontrado
 *   post:
 *     summary: Guardar el contenido actual como una versión con descripción (punto de control)
 *     tags: [Versiones]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DocumentId'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               summary:
 *                 type: string
 *                 maxLength: 200
 *                 example: Capítulo 2 terminado
 *     responses:
 *       201:
 *         description: Versión creada
 *       403:
 *         description: Solo propietario o editor
 *       409:
 *         description: No hay cambios desde la última versión
 */
router.get('/', versionController.listVersions);
router.post('/', versionController.createVersion);

/**
 * @swagger
 * /api/documents/{id}/versions/compare:
 *   get:
 *     summary: Comparar dos versiones línea a línea (usar "current" para el contenido actual)
 *     tags: [Versiones]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DocumentId'
 *       - in: query
 *         name: from
 *         required: true
 *         schema: { type: string, example: '3' }
 *         description: Versión anterior (número o "current")
 *       - in: query
 *         name: to
 *         required: true
 *         schema: { type: string, example: current }
 *         description: Versión nueva (número o "current")
 *     responses:
 *       200:
 *         description: Líneas con su tipo (equal, added, removed) y totales de cambios
 *       400:
 *         description: Parámetros inválidos o archivo demasiado grande
 *       404:
 *         description: Versión no encontrada
 */
router.get('/compare', versionController.compareVersions);

/**
 * @swagger
 * /api/documents/{id}/versions/{number}:
 *   get:
 *     summary: Obtener una versión con su contenido completo
 *     tags: [Versiones]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DocumentId'
 *       - $ref: '#/components/parameters/VersionNumber'
 *     responses:
 *       200:
 *         description: Versión con su contenido
 *       404:
 *         description: Versión no encontrada
 */
router.get('/:number', versionController.getVersion);

/**
 * @swagger
 * /api/documents/{id}/versions/{number}/restore:
 *   post:
 *     summary: Restaurar una versión anterior (crea una versión nueva; respalda antes los cambios sin versionar)
 *     tags: [Versiones]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/DocumentId'
 *       - $ref: '#/components/parameters/VersionNumber'
 *     responses:
 *       200:
 *         description: Versión restaurada y contenido vigente
 *       403:
 *         description: Solo propietario o editor
 *       404:
 *         description: Versión no encontrada
 *       409:
 *         description: La versión ya es el contenido actual
 */
router.post('/:number/restore', versionController.restoreVersion);

module.exports = router;
