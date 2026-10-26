/**
 * Middleware global para capturar errores de la aplicación
 */
module.exports = (err, req, res, next) => {
  console.error(err.stack);

  // Supabase devuelve statusCode como texto (ej. "404"); Express exige un entero válido
  const parsedStatus = Number.parseInt(err.statusCode ?? err.status, 10);
  const statusCode = parsedStatus >= 400 && parsedStatus <= 599 ? parsedStatus : 500;
  const message = err.message || 'Error interno del servidor';

  res.status(statusCode).json({
    error: {
      message,
      status: statusCode,
      // Solo mostramos la pila de llamadas del error en ambiente de desarrollo
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
};

