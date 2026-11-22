const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const errorHandler = require('../../src/middlewares/error');
const { NotFoundError } = require('../../src/errors/AppError');

/** Respuesta de Express mínima para inspeccionar el estado y el JSON enviado. */
function createResponse({ headersSent = false } = {}) {
  return {
    headersSent,
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

describe('middleware de errores', () => {
  it('responde con el código y mensaje de los errores de dominio', () => {
    const res = createResponse();
    errorHandler(new NotFoundError('Proyecto no encontrado'), {}, res, () => {});

    assert.equal(res.statusCode, 404);
    assert.equal(res.payload.error.message, 'Proyecto no encontrado');
  });

  it('convierte el statusCode en texto de Supabase a un entero válido', () => {
    const res = createResponse();
    errorHandler(Object.assign(new Error('No existe'), { statusCode: '404' }), {}, res, () => {});

    assert.equal(res.statusCode, 404);
  });

  it('usa 500 cuando el código no es un error HTTP válido', () => {
    const res = createResponse();
    errorHandler(Object.assign(new Error('Fallo'), { statusCode: 'abc' }), {}, res, () => {});

    assert.equal(res.statusCode, 500);
  });

  it('delega en Express si la respuesta ya empezó a enviarse (ej. un PDF a medias)', () => {
    const res = createResponse({ headersSent: true });
    const error = new Error('Conexión cortada');
    let forwarded = null;

    errorHandler(error, {}, res, err => {
      forwarded = err;
    });

    assert.equal(forwarded, error);
    assert.equal(res.statusCode, null);
  });
});
