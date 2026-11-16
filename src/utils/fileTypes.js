const path = require('path');

/**
 * Extensiones que se guardan como texto (contenido_actual) y se pueden editar en el editor.
 * Todo lo demás (imágenes, PDFs, fuentes, etc.) se trata como binario y vive solo en Storage.
 */
const TEXT_EXTENSIONS = new Set([
  'tex', 'ltx', 'latex', 'bib', 'bst', 'bbx', 'cbx', 'lbx', 'sty', 'cls', 'clo', 'cfg', 'def', 'dtx', 'ins',
  'tikz', 'pgf', 'txt', 'md', 'csv', 'tsv', 'dat', 'json', 'xml', 'yml', 'yaml', 'ist', 'gls', 'glo',
  'lua', 'py', 'r', 'm', 'js', 'ts', 'html', 'css', 'sh', 'bat', 'ini', 'toml', 'log'
]);

const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  eps: 'application/postscript',
  ps: 'application/postscript'
};

function getExtension(name) {
  return path.extname(String(name || '')).slice(1).toLowerCase();
}

/**
 * Un archivo sin extensión (ej. "LICENSE", "Makefile") se considera texto.
 */
function isTextFile(name) {
  const extension = getExtension(name);
  return !extension || TEXT_EXTENSIONS.has(extension);
}

/**
 * Valor del enum tipo_archivo de la base de datos para un nombre de archivo
 */
function getFileType(name) {
  const extension = getExtension(name);
  if (extension === 'tex') return 'tex';
  if (extension === 'bib') return 'bib';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'eps', 'bmp', 'tif', 'tiff'].includes(extension)) return 'imagen';
  return 'otro';
}

function getMimeType(name) {
  const extension = getExtension(name);
  if (MIME_TYPES[extension]) return MIME_TYPES[extension];
  return isTextFile(name) ? 'text/plain; charset=utf-8' : 'application/octet-stream';
}

/**
 * Nombres de archivo/carpeta permitidos: sin separadores de ruta, sin "." ni ".."
 * y sin caracteres que Windows no admite (el proyecto se materializa en disco al compilar).
 */
function isValidNodeName(name) {
  const value = String(name || '').trim();
  if (!value || value === '.' || value === '..') return false;
  if (value.length > 255) return false;
  return !/[\\/:*?"<>|\x00-\x1f]/.test(value);
}

module.exports = {
  TEXT_EXTENSIONS,
  getExtension,
  isTextFile,
  getFileType,
  getMimeType,
  isValidNodeName
};
