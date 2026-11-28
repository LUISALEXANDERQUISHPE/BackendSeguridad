const zlib = require('zlib');
const { ValidationError } = require('../errors/AppError');
const { isValidNodeName } = require('./fileTypes');

/**
 * Lector de archivos .zip subidos por los usuarios (importar un proyecto, como en Overleaf).
 *
 * Usa solo zlib de Node (sin dependencias) y trata el ZIP como no confiable:
 *  - "Zip slip": rechaza rutas absolutas, con unidad de Windows o con ".." (no pueden salir del proyecto).
 *  - "Zip bomb": límites de archivos, de tamaño por archivo y total; la descompresión nunca
 *    produce más bytes que el máximo permitido, diga lo que diga la cabecera del ZIP.
 *  - Rechaza ZIP cifrados, ZIP64, enlaces simbólicos y métodos de compresión desconocidos.
 *  - Comprueba el CRC-32 de cada archivo (detecta ZIP dañados o manipulados).
 *  - Ignora basura de sistemas operativos (__MACOSX, .DS_Store, Thumbs.db, .git).
 */
const ZIP_LIMITS = Object.freeze({
  MAX_ZIP_BYTES: 7 * 1024 * 1024,
  MAX_ENTRIES: 500,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  MAX_TOTAL_BYTES: 50 * 1024 * 1024,
  MAX_PATH_LENGTH: 512,
  MAX_DEPTH: 10
});

const SIGNATURES = Object.freeze({
  END_OF_CENTRAL_DIRECTORY: 0x06054b50,
  CENTRAL_DIRECTORY: 0x02014b50,
  LOCAL_FILE: 0x04034b50
});

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const UNIX_SYMLINK = 0o120000;
const UNIX_FILE_TYPE_MASK = 0o170000;

const IGNORED_SEGMENTS = new Set(['__MACOSX', '.git', '.svn', '.idea', '.vscode', 'node_modules']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const invalid = (message) => new ValidationError(`ZIP no válido: ${message}`);

/** Busca el registro "fin del directorio central" (está al final, tras un comentario opcional). */
function findEndOfCentralDirectory(buffer) {
  const minimum = 22;
  const lowest = Math.max(0, buffer.length - minimum - 0xffff);
  for (let offset = buffer.length - minimum; offset >= lowest; offset--) {
    if (buffer.readUInt32LE(offset) === SIGNATURES.END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

/**
 * Normaliza la ruta de una entrada y la valida. Devuelve null si debe ignorarse (basura del sistema).
 * @throws {ValidationError} si la ruta intenta salir del proyecto o tiene nombres inválidos
 */
function sanitizeEntryPath(rawName) {
  const name = rawName.replace(/\\/g, '/');
  if (name.length > ZIP_LIMITS.MAX_PATH_LENGTH) throw invalid(`la ruta "${name.slice(0, 60)}…" es demasiado larga`);
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw invalid(`la ruta "${name}" es absoluta`);

  const segments = name.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw invalid(`la ruta "${name}" intenta salir de la carpeta del proyecto`);
  }
  if (segments.length === 0) return null;
  if (segments.some((segment) => IGNORED_SEGMENTS.has(segment))) return null;
  const fileName = segments.at(-1);
  if (IGNORED_FILES.has(fileName) || fileName.startsWith('._')) return null;
  if (segments.length > ZIP_LIMITS.MAX_DEPTH) throw invalid(`"${name}" tiene demasiadas carpetas anidadas`);
  const bad = segments.find((segment) => !isValidNodeName(segment));
  if (bad) throw invalid(`el nombre "${bad}" contiene caracteres no permitidos`);
  return segments.join('/');
}

/** Descomprime una entrada sin superar el máximo permitido (protección contra zip bombs). */
function extractData(buffer, entry) {
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== SIGNATURES.LOCAL_FILE) throw invalid('estructura dañada');
  const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const start = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw invalid('estructura dañada');
  const compressed = buffer.subarray(start, end);

  let data;
  if (entry.method === METHOD_STORED) {
    data = Buffer.from(compressed);
  } else {
    try {
      data = zlib.inflateRawSync(compressed, { maxOutputLength: ZIP_LIMITS.MAX_FILE_BYTES });
    } catch (error) {
      if (error.code === 'ERR_BUFFER_TOO_LARGE' || error.code === 'ERR_OUT_OF_RANGE') {
        throw invalid(`"${entry.path}" supera el tamaño máximo por archivo`);
      }
      throw invalid(`no se pudo descomprimir "${entry.path}"`);
    }
  }
  if (data.length !== entry.size) throw invalid(`el tamaño de "${entry.path}" no coincide (archivo dañado)`);
  if (typeof zlib.crc32 === 'function' && (zlib.crc32(data) >>> 0) !== entry.crc32) {
    throw invalid(`"${entry.path}" está dañado (CRC incorrecto)`);
  }
  return data;
}

/**
 * Si todos los archivos están dentro de una única carpeta (lo habitual al comprimir una carpeta),
 * se quita esa carpeta para que el contenido quede en la raíz del proyecto, como hace Overleaf.
 */
function stripCommonRoot(files) {
  if (files.length === 0 || files.some((file) => !file.path.includes('/'))) return files;
  const root = files[0].path.split('/')[0];
  if (!files.every((file) => file.path.startsWith(`${root}/`))) return files;
  return stripCommonRoot(files.map((file) => ({ ...file, path: file.path.slice(root.length + 1) })));
}

/**
 * Lee un .zip y devuelve sus archivos (las carpetas se deducen de las rutas).
 * @param {Buffer} buffer Contenido del .zip
 * @returns {Array<{ path: string, content: Buffer }>}
 * @throws {ValidationError} si el ZIP no es válido o supera algún límite
 */
function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw invalid('el archivo está vacío o no es un .zip');
  if (buffer.length > ZIP_LIMITS.MAX_ZIP_BYTES) {
    throw new ValidationError(`El .zip no puede superar ${ZIP_LIMITS.MAX_ZIP_BYTES / 1024 / 1024} MB`);
  }

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw invalid('el archivo no es un .zip');
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || directoryOffset === 0xffffffff) throw invalid('el formato ZIP64 no está soportado');
  if (totalEntries > ZIP_LIMITS.MAX_ENTRIES) throw invalid(`tiene más de ${ZIP_LIMITS.MAX_ENTRIES} elementos`);
  if (directoryOffset + directorySize > eocd) throw invalid('estructura dañada');

  const entries = [];
  let offset = directoryOffset;
  for (let index = 0; index < totalEntries; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== SIGNATURES.CENTRAL_DIRECTORY) {
      throw invalid('estructura dañada');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc32 = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.toString(flags & FLAG_UTF8 ? 'utf8' : 'latin1', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (rawName.endsWith('/') || rawName.endsWith('\\')) continue; // carpeta: se deduce de las rutas
    if (flags & FLAG_ENCRYPTED) throw invalid('los ZIP protegidos con contraseña no están soportados');
    if (((externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK) {
      throw invalid(`"${rawName}" es un enlace simbólico`);
    }
    const path = sanitizeEntryPath(rawName);
    if (!path) continue;
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) throw invalid(`"${path}" usa una compresión no soportada`);
    if (size > ZIP_LIMITS.MAX_FILE_BYTES) throw invalid(`"${path}" supera el tamaño máximo por archivo`);
    entries.push({ path, method, crc32, compressedSize, size, localHeaderOffset });
  }

  const declaredTotal = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (declaredTotal > ZIP_LIMITS.MAX_TOTAL_BYTES) throw invalid('el contenido descomprimido es demasiado grande');

  let total = 0;
  const seen = new Set();
  const files = [];
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw invalid(`"${entry.path}" está repetido`);
    seen.add(key);
    const content = extractData(buffer, entry);
    total += content.length;
    if (total > ZIP_LIMITS.MAX_TOTAL_BYTES) throw invalid('el contenido descomprimido es demasiado grande');
    files.push({ path: entry.path, content });
  }

  if (files.length === 0) throw invalid('no contiene archivos');
  return stripCommonRoot(files);
}

module.exports = { readZip, ZIP_LIMITS };
