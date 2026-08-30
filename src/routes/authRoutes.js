const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/auth');

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Registra un nuevo usuario
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: juan_perez
 *               password:
 *                 type: string
 *                 example: ContrasenaSegura123
 *     responses:
 *       201:
 *         description: Usuario registrado con éxito
 *       400:
 *         description: Falta usuario o contraseña
 *       409:
 *         description: El usuario ya existe
 */
router.post('/register', authController.register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Inicia sesión de usuario y devuelve un token JWT
 *     tags: [Autenticación]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: juan_perez
 *               password:
 *                 type: string
 *                 example: ContrasenaSegura123
 *     responses:
 *       200:
 *         description: Autenticación exitosa, devuelve el token
 *       401:
 *         description: Credenciales inválidas
 */
router.post('/login', authController.login);

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     summary: Obtiene el perfil del usuario autenticado (Ruta protegida)
 *     tags: [Autenticación]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Retorna el payload del token del usuario decodificado
 *       401:
 *         description: Acceso denegado (falta el token)
 *       403:
 *         description: Token inválido o expirado
 */
router.get('/profile', authMiddleware, (req, res) => {
  res.json({
    message: 'Esta es una ruta protegida con JWT',
    user: req.user
  });
});

module.exports = router;

