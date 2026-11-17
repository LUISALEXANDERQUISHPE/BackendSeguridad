const config = require('../config');
const logger = require('../utils/logger');

const INTERNAL_ERROR_MESSAGE = 'Error interno del servidor';
const HTTP_INTERNAL_ERROR = 500;
const MIN_ERROR_STATUS = 400;
const MAX_ERROR_STATUS = 599;

/**
 * Código HTTP válido para la respuesta. Supabase devuelve statusCode como texto (ej. "404")
 * y Express exige un entero entre 400 y 599.
 */
function resolveStatusCode(err) {
  const parsed = Number.parseInt(err.statusCode ?? err.status, 10);
  return parsed >= MIN_ERROR_STATUS && parsed <= MAX_ERROR_STATUS ? parsed : HTTP_INTERNAL_ERROR;
}

/**
 * Middleware global para capturar errores de la aplicación.
 * Los errores de dominio (AppError) devuelven su propio mensaje y código;
 * los inesperados no exponen detalles internos fuera del ambiente de desarrollo.
 * Express identifica a los manejadores de errores por sus 4 parámetros.
 */
module.exports = (err, req, res, _next) => {
  const isDevelopment = config.nodeEnv === 'development';
  const statusCode = resolveStatusCode(err);
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
