/**
 * Errores de dominio de la aplicación.
 * Cada error conoce su código HTTP, de modo que los controladores no necesitan
 * decidir el estado de la respuesta: el middleware global lo traduce.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'No tienes permisos para realizar esta acción') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 404);
  }
}

module.exports = {
  AppError,
  ValidationError,
  ForbiddenError,
  NotFoundError
};
