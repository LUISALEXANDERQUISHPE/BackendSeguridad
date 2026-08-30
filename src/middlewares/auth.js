const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware para validar el token JWT en rutas protegidas
 */
module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Acceso denegado. No se proporcionó un token.' });
  }

  // Se espera el formato: "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(400).json({ error: 'Formato de token inválido. Use "Bearer <token>"' });
  }

  const token = parts[1];

  try {
    const verified = jwt.verify(token, config.jwtSecret);
    req.user = verified; // Adjuntamos los datos del usuario decodificados al request
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

