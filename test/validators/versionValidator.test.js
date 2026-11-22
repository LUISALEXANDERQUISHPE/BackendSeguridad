const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateFileId,
  validateVersionNumber,
  parseVersionRef,
  validateSummary,
  parsePagination
} = require('../../src/validators/versionValidator');

const VALIDATION = { statusCode: 400 };

describe('versionValidator', () => {
  it('acepta UUID válidos y rechaza el resto', () => {
    assert.equal(validateFileId('3f1c2a7e-1b2c-4d5e-8f90-123456789abc'), '3f1c2a7e-1b2c-4d5e-8f90-123456789abc');
    assert.throws(() => validateFileId('abc'), VALIDATION);
  });

  it('solo acepta números de versión enteros positivos', () => {
    assert.equal(validateVersionNumber('12'), 12);
    for (const invalid of ['0', '-1', '1.5', 'abc', '', undefined, '01']) {
      assert.throws(() => validateVersionNumber(invalid), VALIDATION, `debería rechazar ${invalid}`);
    }
  });

  it('acepta "current" o un número al comparar, y exige el parámetro', () => {
    assert.equal(parseVersionRef('current', 'to'), 'current');
    assert.equal(parseVersionRef('3', 'from'), 3);
    assert.throws(() => parseVersionRef(undefined, 'from'), /"from" es requerido/);
  });

  it('normaliza la descripción y limita su longitud', () => {
    assert.equal(validateSummary('  Capítulo 2  '), 'Capítulo 2');
    assert.equal(validateSummary('   '), null);
    assert.equal(validateSummary(undefined), null);
    assert.throws(() => validateSummary(42), VALIDATION);
    assert.throws(() => validateSummary('x'.repeat(201)), VALIDATION);
  });

  it('aplica valores por defecto y máximos seguros a la paginación', () => {
    assert.deepEqual(parsePagination({}), { limit: 20, offset: 0 });
    assert.deepEqual(parsePagination({ limit: '5', offset: '10' }), { limit: 5, offset: 10 });
    assert.deepEqual(parsePagination({ limit: '5000', offset: '-3' }), { limit: 100, offset: 0 });
  });
});
