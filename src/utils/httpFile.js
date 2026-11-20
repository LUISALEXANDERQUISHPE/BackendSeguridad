const fsp = require('node:fs/promises');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');

const NO_CACHE = 'no-store, max-age=0';
// Un archivo subido por un usuario (ej. un SVG) nunca debe ejecutar scripts si se abre en el navegador
const INLINE_CONTENT_POLICY = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'";

/**
 * Codifica un valor según RFC 5987 (usado en filename*=UTF-8''...).
 * encodeURIComponent deja sin codificar ' ( ) * que el estándar sí exige escapar.
 * @param {string} value
 * @returns {string}
 */
function encodeRfc5987(value) {
  return encodeURIComponent(value).replaceAll(
    /['()*]/g,
    char => `%${char.codePointAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Versión ASCII del nombre para navegadores antiguos: sin tildes, comillas ni barras.
 * @param {string} fileName
 * @returns {string}
 */
function toAsciiFileName(fileName) {
  return fileName
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/g, '')
    .replaceAll(/[^\x20-\x7e]/g, '_')
    .replaceAll(/["\\/]/g, '_');
}

/**
 * Cabecera Content-Disposition que conserva tildes y espacios en el nombre del archivo.
 * Ej.: attachment; filename="Introduccion.pdf"; filename*=UTF-8''Introducci%C3%B3n.pdf
 *
 * @param {'inline'|'attachment'} disposition
 * @param {string} fileName
 * @returns {string}
 */
function buildContentDisposition(disposition, fileName) {
  return `${disposition}; filename="${toAsciiFileName(fileName)}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

/**
 * Envía un archivo (desde memoria o disco) con las cabeceras de descarga correctas:
 * tipo, nombre, tamaño (para mostrar el progreso), sin caché (siempre la última compilación)
 * y, si se muestra en el navegador, aislado en sandbox para que no pueda ejecutar código.
 * Si la lectura del disco falla antes de responder, el error llega al middleware global
 * en lugar de dejar la petición colgada.
 *
 * @param {import('express').Response} res
 * @param {object} file
 * @param {string} file.fileName Nombre con extensión que verá el usuario
 * @param {string} file.contentType Tipo MIME
 * @param {'inline'|'attachment'} file.disposition
 * @param {Buffer} [file.buffer] Contenido en memoria
 * @param {string} [file.filePath] Ruta en disco (si no hay buffer)
 */
async function sendFile(res, { fileName, contentType, disposition, buffer, filePath }) {
  const size = buffer ? buffer.length : (await fsp.stat(filePath)).size;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', buildContentDisposition(disposition, fileName));
  res.setHeader('Content-Length', String(size));
  res.setHeader('Cache-Control', NO_CACHE);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (disposition === 'inline') {
    res.setHeader('Content-Security-Policy', INLINE_CONTENT_POLICY);
  }

  if (buffer) {
    res.end(buffer);
    return;
  }

  await pipeline(fs.createReadStream(filePath), res);
}

module.exports = {
  buildContentDisposition,
  sendFile
};
