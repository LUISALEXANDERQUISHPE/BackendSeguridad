const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildTemplateCopy } = require('../../src/services/templateProjectBuilder');

function sequentialIds() {
  let next = 0;
  return () => `id-${++next}`;
}

const FILES = [
  { path: 'capitulos/anexos/a.tex', content: Buffer.from('anexo') },
  { path: 'capitulos/intro.tex', content: Buffer.from('intro') },
  { path: 'imagenes/logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { path: 'main.tex', content: Buffer.from('principal ñ') },
  { path: 'referencias.bib', content: Buffer.from('@book{}') }
];

describe('buildTemplateCopy', () => {
  const copy = buildTemplateCopy({
    files: FILES,
    mainFile: 'main.tex',
    projectId: 'proyecto-nuevo',
    userId: 'usuario',
    createId: sequentialIds()
  });
  const byName = name => [...copy.folders, ...copy.files].find(node => node.nombre === name);

  it('crea cada carpeta una sola vez y antes que sus hijos', () => {
    assert.deepEqual(copy.folders.map(folder => folder.nombre), ['capitulos', 'anexos', 'imagenes']);
    assert.equal(byName('anexos').padre_id, byName('capitulos').id);
    assert.equal(byName('capitulos').padre_id, null);
  });

  it('pone el archivo principal primero y lo identifica', () => {
    assert.equal(copy.files[0].nombre, 'main.tex');
    assert.equal(copy.mainNodeId, copy.files[0].id);
  });

  it('conserva la jerarquía de carpetas de cada archivo', () => {
    assert.equal(byName('a.tex').padre_id, byName('anexos').id);
    assert.equal(byName('intro.tex').padre_id, byName('capitulos').id);
    assert.equal(byName('main.tex').padre_id, null);
  });

  it('guarda el texto en la base y deja los binarios solo para Storage', () => {
    assert.equal(byName('main.tex').contenido_actual, 'principal ñ');
    assert.equal(byName('main.tex').tipo_archivo, 'tex');
    assert.equal(byName('referencias.bib').tipo_archivo, 'bib');
    assert.equal(byName('logo.png').contenido_actual, null);
    assert.equal(byName('logo.png').tipo_archivo, 'imagen');
    assert.equal(byName('main.tex').tamano_bytes, Buffer.byteLength('principal ñ'));
  });

  it('asigna todos los nodos al proyecto y al usuario nuevos, con ids nuevos', () => {
    const nodes = [...copy.folders, ...copy.files];
    assert.ok(nodes.every(node => node.proyecto_id === 'proyecto-nuevo' && node.creado_por === 'usuario'));
    assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
  });

  it('numera el orden de los nodos dentro de cada carpeta', () => {
    const rootOrders = [...copy.folders, ...copy.files]
      .filter(node => node.padre_id === null)
      .map(node => node.orden)
      .sort((a, b) => a - b);
    assert.deepEqual(rootOrders, [0, 1, 2, 3]);
  });

  it('prepara la subida a Storage de cada archivo con su ruta', () => {
    assert.equal(copy.uploads.length, FILES.length);
    const logo = copy.uploads.find(upload => upload.path === 'imagenes/logo.png');
    assert.equal(logo.isText, false);
    assert.equal(logo.nodeId, byName('logo.png').id);
  });

  it('devuelve mainNodeId null si la plantilla no incluye el archivo principal', () => {
    const result = buildTemplateCopy({ files: FILES.slice(0, 1), mainFile: 'main.tex', projectId: 'p', userId: 'u' });
    assert.equal(result.mainNodeId, null);
  });
});
