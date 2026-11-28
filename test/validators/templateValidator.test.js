const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseManifest, validateTemplateId } = require('../../src/validators/templateValidator');

const VALID = {
  id: '11111111-1111-4111-8111-111111111111',
  name: ' Tesis ',
  category: 'tesis',
  description: 'Descripción',
  mainFile: 'main.tex',
  tags: ['a', 3, 'b'],
  order: 2
};

describe('templateValidator', () => {
  it('normaliza un manifiesto válido', () => {
    assert.deepEqual(parseManifest(VALID, 'tesis-grado'), {
      id: VALID.id,
      slug: 'tesis-grado',
      name: 'Tesis',
      category: 'tesis',
      description: 'Descripción',
      mainFile: 'main.tex',
      tags: ['a', 'b'],
      order: 2
    });
  });

  it('usa valores por defecto para etiquetas y orden ausentes', () => {
    const parsed = parseManifest({ ...VALID, tags: undefined, order: undefined }, 'x');
    assert.deepEqual(parsed.tags, []);
    assert.equal(parsed.order, Number.MAX_SAFE_INTEGER);
  });

  it('rechaza manifiestos inválidos con un mensaje que indica la plantilla', () => {
    const cases = [
      [VALID, 'Nombre Con Espacios', /carpeta/],
      [null, 'x', /objeto JSON/],
      [{ ...VALID, id: 'abc' }, 'x', /UUID/],
      [{ ...VALID, category: 'receta' }, 'x', /categoría/],
      [{ ...VALID, name: '  ' }, 'x', /"name"/],
      [{ ...VALID, mainFile: 'carpeta/main.tex' }, 'x', /raíz/],
      [{ ...VALID, mainFile: 'main.pdf' }, 'x', /\.tex/]
    ];
    for (const [raw, slug, expected] of cases) {
      assert.throws(() => parseManifest(raw, slug), expected);
    }
  });

  it('valida el id de plantilla recibido en la API', () => {
    assert.equal(validateTemplateId(VALID.id), VALID.id);
    assert.throws(() => validateTemplateId('../../etc'), { statusCode: 400 });
  });
});
