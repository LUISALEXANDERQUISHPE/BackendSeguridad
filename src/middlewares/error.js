const config = require('../config');
const logger = require('../utils/logger');

const INTERNAL_ERROR_MESSAGE = 'Error interno del servidor';
const HTTP_INTERNAL_ERROR = 500;

/**
 * Middleware global para capturar errores de la aplicación.
 * Los errores de dominio (AppError) devuelven su propio mensaje y código;
 * los inesperados no exponen detalles internos fuera del ambiente de desarrollo.
 * Express identifica a los manejadores de errores por sus 4 parámetros.
 */
module.exports = (err, req, res, _next) => {
  const isDevelopment = config.nodeEnv === 'development';
  const statusCode = err.statusCode || HTTP_INTERNAL_ERROR;
  const isInternal = statusCode >= HTTP_INTERNAL_ERROR && !err.isOperational;

  if (isInternal) {
    logger.error(err.stack || err);
  }

  const message = isInternal && !isDevelopment
    ? INTERNAL_ERROR_MESSAGE
    : err.message || INTERNAL_ERROR_MESSAGE;

  res.status(statusCode).json({
    error: {
      message,
      status: statusCode,
      // Solo mostramos la pila de llamadas del error en ambiente de desarrollo
      ...(isDevelopment && { stack: err.stack })
    }
  });
};
