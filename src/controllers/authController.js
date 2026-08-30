const jwt = require('jsonwebtoken');
const config = require('../config');
const cryptoUtils = require('../utils/crypto');

// Simulación de base de datos en memoria para el ejemplo
const users = [];

/**
 * Registro de un nuevo usuario
 */
exports.register = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }

    // Verificar si ya existe
    const exists = users.find(u => u.username === username);
    if (exists) {
      return res.status(409).json({ error: 'El usuario ya existe' });
    }

    // Encriptar la contraseña usando nuestra utilidad
    const encryptedPassword = cryptoUtils.encrypt(password);

    const newUser = {
      id: users.length + 1,
      username,
      password: encryptedPassword
    };

    users.push(newUser);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: { id: newUser.id, username: newUser.username }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Inicio de sesión
 */
exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Desencriptar la contraseña para verificarla
    const decryptedPassword = cryptoUtils.decrypt(user.password);
    if (decryptedPassword !== password) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar Token JWT
    const token = jwt.sign(
      { id: user.id, username: user.username },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    res.json({
      message: 'Autenticación exitosa',
      token
    });
  } catch (error) {
    next(error);
  }
};

