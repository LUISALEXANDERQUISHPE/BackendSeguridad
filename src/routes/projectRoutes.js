const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const invitationController = require('../controllers/invitationController');
const memberController = require('../controllers/memberController');
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
 *             properties:
 *               name:
 *                 type: string
 *                 description: Requerido salvo al usar una plantilla (por defecto toma su nombre)
 *                 example: Tesis de grado
 *               description:
 *                 type: string
 *                 example: Proyecto de investigación final
 *               content:
 *                 type: string
 *                 description: Código LaTeX inicial opcional; si se omite se usa la plantilla por defecto
 *               templateId:
 *                 type: string
 *                 format: uuid
 *                 description: >
 *                   Plantilla del sistema a copiar (GET /api/templates). El proyecto se crea como copia
 *                   independiente con todos sus archivos; el nombre y la descripción son opcionales.
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

/**
 * @swagger
 * /api/projects/{id}/members:
 *   get:
 *     summary: Listar los colaboradores del proyecto
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
 *         description: Colaboradores del proyecto (sin el propietario)
 *       403:
 *         description: No tienes acceso al proyecto
 */
router.get('/:id/members', projectController.listMembers);

/**
 * @swagger
 * /api/projects/{id}/members/me:
 *   delete:
 *     summary: Salir del proyecto (cualquier colaborador; el propietario no puede)
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
 *         description: El usuario ya no tiene acceso al proyecto
 *       403:
 *         description: El propietario no puede salir de su proyecto
 */
// Debe ir antes de /:id/members/:userId para que "me" no se interprete como un id
router.delete('/:id/members/me', memberController.leaveProject);

/**
 * @swagger
 * /api/projects/{id}/members/{userId}:
 *   patch:
 *     summary: Cambiar el rol de un colaborador (solo el propietario). Se aplica al instante en los editores abiertos.
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
 *       - in: path
 *         name: userId
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
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [editor, lector]
 *     responses:
 *       200:
 *         description: Rol actualizado
 *       403:
 *         description: Solo el propietario; no se puede cambiar el rol del propietario
 *       404:
 *         description: La persona no colabora en el proyecto
 *   delete:
 *     summary: Quitar el acceso a un colaborador (solo el propietario). Se le desconecta de los editores abiertos.
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
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Acceso retirado
 *       403:
 *         description: Solo el propietario
 *       404:
 *         description: La persona no colabora en el proyecto
 */
router.patch('/:id/members/:userId', memberController.changeRole);
router.delete('/:id/members/:userId', memberController.removeMember);

/**
 * @swagger
 * /api/projects/{id}/invitations:
 *   post:
 *     summary: Invitar uno o varios correos con un rol (HU-25). La persona entra al aceptar.
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
 *             required: [emails, role]
 *             properties:
 *               emails:
 *                 oneOf:
 *                   - type: string
 *                     example: ana@correo.com, luis@correo.com
 *                   - type: array
 *                     items:
 *                       type: string
 *               role:
 *                 type: string
 *                 enum: [editor, lector]
 *     responses:
 *       201:
 *         description: Invitaciones creadas (cada una con su token de enlace, que solo se muestra esta vez) y correos omitidos
 *       400:
 *         description: Rol o correos inválidos
 *       403:
 *         description: Solo el propietario puede invitar
 *   get:
 *     summary: Invitaciones pendientes del proyecto (solo el propietario)
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
 *         description: Invitaciones pendientes
 */
router.post('/:id/invitations', invitationController.invite);
router.get('/:id/invitations', invitationController.listProjectInvitations);

/**
 * @swagger
 * /api/projects/{id}/invitations/{invitationId}/resend:
 *   post:
 *     summary: Reenviar una invitación (nuevo enlace y nuevo plazo; el enlace anterior deja de funcionar)
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
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invitación reenviada
 */
router.post('/:id/invitations/:invitationId/resend', invitationController.resend);

/**
 * @swagger
 * /api/projects/{id}/invitations/{invitationId}:
 *   delete:
 *     summary: Revocar una invitación pendiente
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
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Invitación revocada
 */
router.delete('/:id/invitations/:invitationId', invitationController.revoke);

/**
 * @swagger
 * /api/projects/{id}/share-suggestions:
 *   get:
 *     summary: Sugerir usuarios registrados cuyo correo empieza con el texto escrito (solo el propietario)
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
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 3
 *         description: Inicio del correo (mínimo 3 caracteres)
 *     responses:
 *       200:
 *         description: Hasta 5 usuarios que aún no tienen acceso al proyecto
 *       403:
 *         description: Solo el propietario puede compartir el proyecto
 */
router.get('/:id/share-suggestions', projectController.suggestUsers);

module.exports = router;
