const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTemplateFileRepository } = require('../../src/repositories/templateFileRepository');

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function manifest(id, overrides = {}) {
  return JSON.stringify({
    id,
    name: 'Plantilla',
    category: 'articulo',
    description: 'Descripción',
    mainFile: 'main.tex',
    ...overrides
  });
}

describe('templateFileRepository', () => {
  let root;

  const write = (relativePath, content) => {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'plantillas-'));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('ordena el catálogo por "order" y luego por nombre', async () => {
    write('b/template.json', manifest(ID_B, { name: 'Beta', order: 1 }));
    write('a/template.json', manifest(ID_A, { name: 'Alfa', order: 2 }));
    const templates = await createTemplateFileRepository({ rootDir: root }).listTemplates();
    assert.deepEqual(templates.map(template => template.slug), ['b', 'a']);
  });

  it('lee los archivos con rutas relativas y sin los archivos internos', async () => {
    write('a/template.json', manifest(ID_A));
    write('a/preview.pdf', '%PDF-');
    write('a/main.tex', 'principal');
    write('a/capitulos/uno.tex', 'capítulo');
    const repository = createTemplateFileRepository({ rootDir: root });
    const [template] = await repository.listTemplates();
    const files = await repository.readFiles(template);

    assert.deepEqual(files.map(file => file.path), ['capitulos/uno.tex', 'main.tex']);
    assert.equal(files[1].content.toString('utf8'), 'principal');
  });

  it('devuelve null si la plantilla no tiene vista previa', async () => {
    write('a/template.json', manifest(ID_A));
    const repository = createTemplateFileRepository({ rootDir: root });
    const [template] = await repository.listTemplates();
    assert.equal(await repository.readPreview(template), null);
    assert.equal(await repository.findTemplate(ID_B), null);
  });

  it('rechaza dos plantillas con el mismo id', async () => {
    write('a/template.json', manifest(ID_A));
    write('b/template.json', manifest(ID_A));
    await assert.rejects(createTemplateFileRepository({ rootDir: root }).listTemplates(), /mismo id/);
  });

  it('vuelve a leer el disco si la carga anterior falló', async () => {
    write('a/template.json', '{ esto no es json');
    const repository = createTemplateFileRepository({ rootDir: root });
    await assert.rejects(repository.listTemplates());

    write('a/template.json', manifest(ID_A));
    assert.equal((await repository.listTemplates()).length, 1);
  });

  it('rechaza enlaces simbólicos dentro de una plantilla', async t => {
    write('a/template.json', manifest(ID_A));
    write('a/main.tex', 'x');
    try {
      fs.symlinkSync(os.tmpdir(), path.join(root, 'a', 'enlace'), 'junction');
    } catch {
      t.skip('el sistema no permite crear enlaces simbólicos');
      return;
    }
    const repository = createTemplateFileRepository({ rootDir: root });
    const [template] = await repository.listTemplates();
    await assert.rejects(repository.readFiles(template), /enlaces simbólicos/);
  });
});
