const supabase = require('../config/supabase');

/**
 * Middleware para validar el token JWT en rutas protegidas
 */
module.exports = async (req, res, next) => {
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
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(403).json({ error: 'Token inválido o expirado.' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

