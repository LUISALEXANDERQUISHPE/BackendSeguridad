const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const authMiddleware = require('../middlewares/auth');

// Todas las rutas de proyectos requieren autenticación JWT
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Proyectos
 *   description: Gestión de proyectos LaTeX desde el panel principal (crear, abrir, modificar, duplicar, archivar y eliminar)
 */

/**
 * @swagger
 * /api/projects:
 *   get:
 *     summary: Listar los proyectos propios y compartidos del usuario
 *     tags: [Proyectos]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: archived
 *         schema:
 *           type: boolean
 *         description: Si es true lista los proyectos archivados, de lo contrario los activos
 *     responses:
 *       200:
 *         description: Lista de proyectos del usuario
 *       401:
 *         description: No autenticado
 */
router.get('/', projectController.listProjects);

/**
 * @swagger
 * /api/projects:
 *   post:
 *     summary: Crear un nuevo proyecto LaTeX con su archivo principal .tex
 *     tags: [Proyectos]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: Tesis de grado
 *               description:
 *                 type: string
 *                 example: Proyecto de investigación final
 *               content:
 *                 type: string
 *                 description: Código LaTeX inicial opcional; si se omite se usa la plantilla por defecto
 *     responses:
 *       201:
 *         description: Proyecto creado exitosamente
 *       400:
 *         description: Nombre o descripción inválidos
 *       401:
 *         description: No autenticado
 */
router.post('/', projectController.createProject);

/**
 * @swagger
 * /api/projects/{id}:
 *   get:
 *     summary: Obtener los detalles de un proyecto
 *     tags: [Proyectos]
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
 *         description: Detalle del proyecto y su archivo principal
 *       403:
 *         description: Acceso no autorizado
 *       404:
 *         description: Proyecto no encontrado
 */
router.get('/:id', projectController.getProjectById);

/**
 * @swagger
 * /api/projects/{id}:
 *   put:
 *     summary: Modificar el nombre o la descripción de un proyecto
 *     tags: [Proyectos]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
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
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Proyecto actualizado exitosamente
 *       400:
 *         description: Datos inválidos
 *       403:
 *         description: Solo el propietario puede modificarlo
 *       404:
 *         description: Proyecto no encontrado
 */
router.put('/:id', projectController.updateProject);

/**
 * @swagger
 * /api/projects/{id}:
 *   delete:
 *     summary: Eliminar un proyecto de forma permanente junto con sus archivos, versiones y compilaciones
 *     tags: [Proyectos]
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
 *         description: Proyecto eliminado exitosamente
 *       403:
 *         description: Solo el propietario puede eliminarlo
 *       404:
 *         description: Proyecto no encontrado
 */
router.delete('/:id', projectController.deleteProject);

/**
 * @swagger
 * /api/projects/{id}/duplicate:
 *   post:
 *     summary: Duplicar un proyecto con todos sus archivos (quien duplica pasa a ser propietario de la copia)
 *     tags: [Proyectos]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Nombre de la copia; si se omite se usa "<nombre> (copia)"
 *     responses:
 *       201:
 *         description: Proyecto duplicado exitosamente
 *       403:
 *         description: Acceso no autorizado
 *       404:
 *         description: Proyecto no encontrado
 */
router.post('/:id/duplicate', projectController.duplicateProject);

/**
 * @swagger
 * /api/projects/{id}/archive:
 *   post:
 *     summary: Archivar un proyecto (se oculta del listado principal sin borrarse)
 *     tags: [Proyectos]
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
 *         description: Proyecto archivado exitosamente
 *       403:
 *         description: Solo el propietario puede archivarlo
 */
router.post('/:id/archive', projectController.archiveProject);

/**
 * @swagger
 * /api/projects/{id}/restore:
 *   post:
 *     summary: Restaurar un proyecto archivado
 *     tags: [Proyectos]
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
 *         description: Proyecto restaurado exitosamente
 *       403:
 *         description: Solo el propietario puede restaurarlo
 */
router.post('/:id/restore', projectController.restoreProject);

module.exports = router;
