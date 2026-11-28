const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createTemplateFileRepository } = require('../../src/repositories/templateFileRepository');
const { TEMPLATE_CATEGORIES } = require('../../src/constants/templateConstants');

/**
 * Integridad de las plantillas reales del sistema (carpeta "templates").
 * Si alguien agrega o modifica una plantilla de forma incorrecta, estas pruebas fallan
 * antes de que el problema llegue a los usuarios.
 */
describe('catálogo de plantillas del sistema', () => {
  const repository = createTemplateFileRepository();
  let templates;

  before(async () => {
    templates = await repository.listTemplates();
  });

  it('carga todas las plantillas con manifiestos válidos e ids únicos', () => {
    assert.ok(templates.length >= 7, 'deben existir al menos las 7 plantillas base');
    assert.equal(new Set(templates.map(template => template.id)).size, templates.length);
  });

  it('cubre todas las categorías ofrecidas en la interfaz', () => {
    const used = new Set(templates.map(template => template.category));
    for (const category of Object.keys(TEMPLATE_CATEGORIES)) {
      assert.ok(used.has(category), `falta una plantilla de la categoría "${category}"`);
    }
  });

  it('cada plantilla tiene un único .tex en la raíz y es su archivo principal', async () => {
    for (const template of templates) {
      const files = await repository.readFiles(template);
      const rootTex = files.filter(file => !file.path.includes('/') && file.path.endsWith('.tex'));
      assert.deepEqual(
        rootTex.map(file => file.path),
        [template.mainFile],
        `"${template.slug}" debe tener solo su archivo principal en la raíz`
      );
    }
  });

  it('no copia al proyecto los archivos internos de la plantilla', async () => {
    for (const template of templates) {
      const paths = (await repository.readFiles(template)).map(file => file.path);
      assert.ok(!paths.includes('template.json'), template.slug);
      assert.ok(!paths.includes('preview.pdf'), template.slug);
    }
  });

  it('cada plantilla tiene su vista previa en PDF (npm run templates:previews)', async () => {
    for (const template of templates) {
      const preview = await repository.readPreview(template);
      assert.ok(preview, `"${template.slug}" no tiene preview.pdf`);
      assert.equal(preview.subarray(0, 5).toString('latin1'), '%PDF-', `${template.slug}: preview.pdf no es un PDF`);
    }
  });
});
