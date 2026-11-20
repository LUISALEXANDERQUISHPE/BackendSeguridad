const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { buildContentDisposition, sendFile } = require('../../src/utils/httpFile');

/** Respuesta HTTP mínima: guarda cabeceras y cuerpo para poder verificarlos. */
function createResponse() {
  const res = new PassThrough();
  const chunks = [];
  res.headers = {};
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.on('data', chunk => chunks.push(chunk));
  res.body = () => Buffer.concat(chunks).toString('utf8');
  return res;
}

describe('buildContentDisposition', () => {
  it('conserva tildes y espacios con filename* (RFC 5987)', () => {
    const header = buildContentDisposition('attachment', 'Introducción final.pdf');
    assert.equal(
      header,
      "attachment; filename=\"Introduccion final.pdf\"; filename*=UTF-8''Introducci%C3%B3n%20final.pdf"
    );
  });

  it('escapa los caracteres que encodeURIComponent no codifica', () => {
    const header = buildContentDisposition('inline', "a'(b)*.pdf");
    assert.match(header, /filename\*=UTF-8''a%27%28b%29%2A\.pdf$/);
  });

  it('impide inyectar comillas o rutas en el nombre de respaldo', () => {
    const header = buildContentDisposition('attachment', 'mal"nombre/../x.pdf');
    assert.match(header, /filename="mal_nombre_\.\._x\.pdf"/);
  });
});

describe('sendFile', () => {
  let tempFile;

  before(() => {
    tempFile = path.join(os.tmpdir(), `httpfile-${process.pid}.pdf`);
    fs.writeFileSync(tempFile, '%PDF-1.4 prueba');
  });

  after(() => fs.rmSync(tempFile, { force: true }));

  it('envía un buffer con tamaño, tipo, nombre y sin caché', async () => {
    const res = createResponse();
    await sendFile(res, {
      fileName: 'Tesis.pdf',
      contentType: 'application/pdf',
      disposition: 'attachment',
      buffer: Buffer.from('hola')
    });

    assert.equal(res.body(), 'hola');
    assert.equal(res.headers['content-length'], '4');
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-security-policy'], undefined);
  });

  it('transmite un archivo desde disco', async () => {
    const res = createResponse();
    await sendFile(res, {
      fileName: 'Tesis.pdf',
      contentType: 'application/pdf',
      disposition: 'inline',
      filePath: tempFile
    });

    assert.equal(res.body(), '%PDF-1.4 prueba');
    assert.equal(res.headers['content-length'], String(fs.statSync(tempFile).size));
  });

  it('aísla en sandbox los archivos que se muestran en el navegador', async () => {
    const res = createResponse();
    await sendFile(res, {
      fileName: 'logo.svg',
      contentType: 'image/svg+xml',
      disposition: 'inline',
      buffer: Buffer.from('<svg/>')
    });

    assert.match(res.headers['content-security-policy'], /^sandbox;/);
  });

  it('rechaza (sin enviar cabeceras) si el archivo no existe', async () => {
    const res = createResponse();
    await assert.rejects(
      sendFile(res, {
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        disposition: 'inline',
        filePath: path.join(os.tmpdir(), 'no-existe-123.pdf')
      }),
      { code: 'ENOENT' }
    );
    assert.deepEqual(res.headers, {});
  });
});
