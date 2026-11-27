const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTemplateService } = require('../../src/services/templateService');

const TEMPLATE = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'tesis-grado',
  name: 'Tesis de grado',
  category: 'tesis',
  description: 'Descripción',
  mainFile: 'main.tex',
  tags: ['tesis'],
  order: 1
};
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function createFakes({ files, preview = Buffer.from('%PDF-') } = {}) {
  const upserts = [];
  const templateFiles = files ?? [
    { path: 'main.tex', content: Buffer.from('\\documentclass{report}') },
    { path: 'capitulos/intro.tex', content: Buffer.from('intro') }
  ];
  return {
    upserts,
    deps: {
      files: {
        listTemplates: async () => [TEMPLATE],
        findTemplate: async id => (id === TEMPLATE.id ? TEMPLATE : null),
        readFiles: async () => templateFiles,
        readPreview: async () => preview
      },
      catalog: { upsertSystemTemplates: async rows => upserts.push(...rows) },
      logger: { info: () => {}, warn: () => {} }
    }
  };
}

describe('templateService', () => {
  let fakes;
  let service;

  beforeEach(() => {
    fakes = createFakes();
    service = createTemplateService(fakes.deps);
  });

  it('lista el catálogo con la etiqueta de cada categoría', async () => {
    const [template] = await service.listTemplates();
    assert.equal(template.name, 'Tesis de grado');
    assert.equal(template.categoryLabel, 'Tesis');
    assert.equal(template.files, undefined);
  });

  it('devuelve el detalle con archivos, código principal y vista previa', async () => {
    const template = await service.getTemplate(TEMPLATE.id);
    assert.deepEqual(template.files, [
      { path: 'main.tex', sizeBytes: 22 },
      { path: 'capitulos/intro.tex', sizeBytes: 5 }
    ]);
    assert.equal(template.mainFileContent, '\\documentclass{report}');
    assert.equal(template.hasPreview, true);
  });

  it('responde 404 si la plantilla no existe y 400 si el id es inválido', async () => {
    await assert.rejects(service.getTemplate(OTHER_ID), { statusCode: 404 });
    await assert.rejects(service.getTemplate('no-es-uuid'), { statusCode: 400 });
  });

  it('entrega la vista previa o 404 si la plantilla no la tiene', async () => {
    const { fileName, content } = await service.getPreview(TEMPLATE.id);
    assert.equal(fileName, 'tesis-grado.pdf');
    assert.equal(content.toString(), '%PDF-');

    const withoutPreview = createTemplateService(createFakes({ preview: null }).deps);
    await assert.rejects(withoutPreview.getPreview(TEMPLATE.id), { statusCode: 404 });
  });

  it('carga la plantilla y sus archivos para copiarla', async () => {
    const { template, files } = await service.loadForCopy(TEMPLATE.id);
    assert.equal(template.id, TEMPLATE.id);
    assert.equal(files.length, 2);
  });

  it('falla si la plantilla no contiene su archivo principal', async () => {
    const broken = createTemplateService(createFakes({ files: [{ path: 'otro.tex', content: Buffer.from('') }] }).deps);
    await assert.rejects(broken.loadForCopy(TEMPLATE.id), /archivo principal/);
  });

  it('registra las plantillas del sistema en la base de datos', async () => {
    assert.equal(await service.syncCatalog(), 1);
    assert.equal(fakes.upserts.length, 1);
    assert.deepEqual(
      { ...fakes.upserts[0], actualizado_en: undefined },
      {
        id: TEMPLATE.id,
        nombre: 'Tesis de grado',
        categoria: 'tesis',
        descripcion: 'Descripción',
        storage_path: 'templates/tesis-grado',
        es_sistema: true,
        actualizado_en: undefined
      }
    );
  });
});
