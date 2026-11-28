const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { readZip, ZIP_LIMITS } = require('../../src/utils/zipReader');
const { prepareZipImport, pickMainFile, projectNameFromFile } = require('../../src/services/zipImport');

/**
 * Arma un .zip en memoria (formato estándar). Cada entrada puede forzar valores maliciosos:
 * nombre, método, banderas, atributos (enlace simbólico), tamaño declarado o CRC.
 */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data ?? '', typeof entry.data === 'string' ? 'utf8' : undefined);
    const method = entry.method ?? 8;
    const compressed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = entry.crc ?? (zlib.crc32(data) >>> 0);
    const size = entry.declaredSize ?? data.length;
    const flags = 0x0800 | (entry.flags ?? 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((entry.unixMode ?? 0o100644) << 16 >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const MAIN = '\\documentclass{article}\\begin{document}Hola\\end{document}';
const paths = (files) => files.map((file) => file.path).sort();

test('lee archivos de texto y binarios, con sus carpetas', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  const files = readZip(buildZip([
    { name: 'main.tex', data: MAIN },
    { name: 'capitulos/', data: '' },
    { name: 'capitulos/intro.tex', data: 'Introducción con tildes: áéíóú ñ' },
    { name: 'imagenes/logo.png', data: png, method: 0 }
  ]));
  assert.deepEqual(paths(files), ['capitulos/intro.tex', 'imagenes/logo.png', 'main.tex']);
  assert.equal(files.find((f) => f.path === 'capitulos/intro.tex').content.toString('utf8'), 'Introducción con tildes: áéíóú ñ');
  assert.deepEqual(files.find((f) => f.path === 'imagenes/logo.png').content, png);
});

test('quita la carpeta raíz común (al comprimir una carpeta), como Overleaf', () => {
  const files = readZip(buildZip([
    { name: 'Mi tesis/main.tex', data: MAIN },
    { name: 'Mi tesis/refs/citas.bib', data: '@article{a, title={x}}' }
  ]));
  assert.deepEqual(paths(files), ['main.tex', 'refs/citas.bib']);
});

test('ignora basura de sistemas operativos y de control de versiones', () => {
  const files = readZip(buildZip([
    { name: 'main.tex', data: MAIN },
    { name: '__MACOSX/._main.tex', data: 'x' },
    { name: '.DS_Store', data: 'x' },
    { name: '.git/config', data: 'x' },
    { name: 'Thumbs.db', data: 'x' }
  ]));
  assert.deepEqual(paths(files), ['main.tex']);
});

test('SEGURIDAD (zip slip): rechaza rutas que intentan salir del proyecto', () => {
  for (const name of ['../evil.tex', 'a/../../evil.tex', '/etc/passwd', 'C:/Windows/evil.tex', '..\\evil.tex']) {
    assert.throws(() => readZip(buildZip([{ name: 'main.tex', data: MAIN }, { name, data: 'x' }])), /ZIP no válido/, name);
  }
});

test('SEGURIDAD: rechaza enlaces simbólicos y ZIP protegidos con contraseña', () => {
  assert.throws(() => readZip(buildZip([{ name: 'link.tex', data: '/etc/passwd', unixMode: 0o120777 }])), /enlace simbólico/);
  assert.throws(() => readZip(buildZip([{ name: 'main.tex', data: MAIN, flags: 0x0001 }])), /contraseña/);
});

test('SEGURIDAD (zip bomb): un archivo que se infla más allá del máximo se rechaza sin descomprimirlo entero', () => {
  // 11 MB de ceros comprimen a unos pocos KB, pero superan el máximo por archivo
  const bomb = Buffer.alloc(ZIP_LIMITS.MAX_FILE_BYTES + 1024 * 1024);
  assert.throws(() => readZip(buildZip([{ name: 'bomba.tex', data: bomb }])), /tamaño máximo/);
  // Aunque la cabecera mienta y declare un tamaño pequeño
  assert.throws(() => readZip(buildZip([{ name: 'bomba.tex', data: bomb, declaredSize: 10 }])), /ZIP no válido/);
});

test('SEGURIDAD: límite de cantidad de archivos', () => {
  const many = Array.from({ length: ZIP_LIMITS.MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}.tex`, data: 'x' }));
  assert.throws(() => readZip(buildZip(many)), /más de 500/);
});

test('detecta archivos dañados (CRC) y archivos que no son ZIP', () => {
  assert.throws(() => readZip(buildZip([{ name: 'main.tex', data: MAIN, crc: 12345 }])), /CRC/);
  assert.throws(() => readZip(Buffer.from('esto no es un zip, solo texto plano de prueba')), /no es un .zip/);
  assert.throws(() => readZip(Buffer.alloc(0)), /vacío/);
});

test('rechaza nombres con caracteres no permitidos y rutas repetidas', () => {
  assert.throws(() => readZip(buildZip([{ name: 'ma:in.tex', data: MAIN }])), /caracteres no permitidos/);
  assert.throws(() => readZip(buildZip([{ name: 'main.tex', data: MAIN }, { name: 'MAIN.tex', data: MAIN }])), /repetido/);
});

test('elige como principal el .tex de la raíz con \\documentclass, prefiriendo main.tex', () => {
  const file = (path, content) => ({ path, content: Buffer.from(content) });
  assert.equal(pickMainFile([file('capitulo.tex', 'Texto'), file('tesis.tex', MAIN)]), 'tesis.tex');
  assert.equal(pickMainFile([file('otro.tex', MAIN), file('main.tex', MAIN)]), 'main.tex');
  assert.throws(() => pickMainFile([file('src/main.tex', MAIN)]), /en la raíz/);
  assert.throws(() => pickMainFile([file('datos.csv', 'a,b')]), /ningún archivo .tex/);
});

test('prepareZipImport valida el base64 y devuelve archivos y archivo principal', () => {
  const zip = buildZip([{ name: 'Proyecto/main.tex', data: MAIN }, { name: 'Proyecto/fig.png', data: Buffer.from([1, 2, 3]), method: 0 }]);
  const result = prepareZipImport(zip.toString('base64'));
  assert.equal(result.mainFile, 'main.tex');
  assert.deepEqual(paths(result.files), ['fig.png', 'main.tex']);
  assert.throws(() => prepareZipImport(''), /Selecciona/);
  assert.throws(() => prepareZipImport('no es base64!!'), /no es válido/);
});

test('el nombre del proyecto sale del archivo .zip', () => {
  assert.equal(projectNameFromFile('Mi tesis.zip'), 'Mi tesis');
  assert.equal(projectNameFromFile('C:\\fakepath\\Articulo.ZIP'), 'Articulo');
  assert.equal(projectNameFromFile(''), 'Proyecto importado');
});
