const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middlewares/auth');

// Todas las rutas de documentos requieren autenticación JWT
router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Documentos LaTeX
 *   description: Gestión de documentos, autoguardado, compilación a PDF y descarga de fuentes
 */

/**
 * @swagger
 * /api/documents:
 *   post:
 *     summary: Crear un nuevo documento LaTeX
 *     tags: [Documentos LaTeX]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Mi Articulo.tex
 *               content:
 *                 type: string
 *                 example: "\\documentclass{article}\n\\begin{document}\nHola Mundo\n\\end{document}"
 *               description:
 *                 type: string
 *                 example: Proyecto de investigación final
 *     responses:
 *       201:
 *         description: Documento creado exitosamente
 *       401:
 *         description: No autenticado
 */
router.post('/', documentController.createDocument);

/**
 * @swagger
 * /api/documents:
 *   get:
 *     summary: Listar todos los documentos accesibles por el usuario
 *     tags: [Documentos LaTeX]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de documentos del usuario
 *       401:
 *         description: No autenticado
 */
router.get('/', documentController.listDocuments);

/**
 * @swagger
 * /api/documents/{id}:
 *   get:
 *     summary: Obtener el contenido y detalles de un documento
 *     tags: [Documentos LaTeX]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID del documento (nodo o proyecto)
 *     responses:
 *       200:
 *         description: Detalle del documento y su código LaTeX
 *       403:
 *         description: Acceso no autorizado
 *       404:
 *         description: Documento no encontrado
 */
router.get('/:id', documentController.getDocumentById);

/**
 * @swagger
 * /api/documents/{id}:
 *   put:
 *     summary: Actualizar el código LaTeX (guardado manual o autoguardado Ctrl+S)
 *     tags: [Documentos LaTeX]
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
 *               content:
 *                 type: string
 *               isAutoSave:
 *                 type: boolean
 *                 description: true para autoguardado periódico o Ctrl+S; false para confirmación de versión
 *               summary:
 *                 type: string
 *                 description: Resumen descriptivo de la versión
 *     responses:
 *       200:
 *         description: Documento actualizado exitosamente
 *       403:
 *         description: Permiso denegado
 */
router.put('/:id', documentController.updateDocument);

/**
 * @swagger
 * /api/documents/{id}:
 *   delete:
 *     summary: Eliminar o archivar un documento
 *     tags: [Documentos LaTeX]
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
 *         description: Documento eliminado exitosamente
 *       403:
 *         description: Solo el propietario puede eliminarlo
 */
router.delete('/:id', documentController.deleteDocument);

/**
 * @swagger
 * /api/documents/{id}/compile:
 *   post:
 *     summary: Compilar el código LaTeX del documento a PDF
 *     tags: [Documentos LaTeX]
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
 *               content:
 *                 type: string
 *                 description: Código LaTeX opcional para compilar directamente cambios no guardados
 *     responses:
 *       200:
 *         description: Compilación completada con éxito
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 documentId:
 *                   type: string
 *                 compilationId:
 *                   type: string
 *                 pdfUrl:
 *                   type: string
 *                   example: /api/documents/uuid/pdf
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: object
 *                 compilationTime:
 *                   type: number
 *                   example: 450
 *       422:
 *         description: Error de compilación con errores estructurados y mensajes amigables
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 documentId:
 *                   type: string
 *                 compilationId:
 *                   type: string
 *                 pdfUrl:
 *                   type: string
 *                   nullable: true
 *                 previousPdfUrl:
 *                   type: string
 *                   nullable: true
 *                   description: URL del PDF previo exitoso si existe, preservado intacto
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       file:
 *                         type: string
 *                         example: document.tex
 *                       line:
 *                         type: integer
 *                         example: 113
 *                       message:
 *                         type: string
 *                         example: Misplaced \noalign.
 *                       type:
 *                         type: string
 *                         example: error
 *                       context:
 *                         type: string
 *                         example: \hline ->\noalign\nl.113 \end{tabularx}
 *                       friendlyMessage:
 *                         type: string
 *                         example: Probablemente existe un problema con \hline o la estructura de la tabla.
 *                 warnings:
 *                   type: array
 *                 compilationTime:
 *                   type: number
 *                 log:
 *                   type: string
 */
router.post('/:id/compile', documentController.compileDocument);

/**
 * @swagger
 * /api/documents/{id}/pdf:
 *   get:
 *     summary: Obtener el PDF compilado (visualización inline o descarga)
 *     tags: [Documentos LaTeX]
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
 *         name: download
 *         schema:
 *           type: boolean
 *         description: Si es true fuerza la descarga (attachment), de lo contrario es inline para visor PDF
 *     responses:
 *       200:
 *         description: Archivo PDF generado
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: PDF no encontrado o documento no compilado
 */
router.get('/:id/pdf', documentController.getPdf);

/**
 * @swagger
 * /api/documents/{id}/source:
 *   get:
 *     summary: Obtener o descargar el código fuente .tex
 *     tags: [Documentos LaTeX]
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
 *         name: download
 *         schema:
 *           type: boolean
 *         description: Si es true descarga el archivo con cabecera application/x-tex
 *     responses:
 *       200:
 *         description: Código fuente LaTeX del documento
 */
router.get('/:id/source', documentController.getSource);

module.exports = router;

