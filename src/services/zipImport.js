const { ValidationError } = require('../errors/AppError');
const { PROJECT_LIMITS } = require('../constants/projectConstants');
const { isTextFile } = require('../utils/fileTypes');
const { readZip } = require('../utils/zipReader');

/**
 * Importar un proyecto desde un .zip (como "Subir proyecto en Zip" de Overleaf).
 * Funciones puras: preparan los archivos; el servicio de proyectos los guarda.
 */

const MAX_BASE64_LENGTH = Math.ceil((7 * 1024 * 1024 * 4) / 3) + 4;

/**
 * Archivo .tex principal: debe estar en la raíz del proyecto (así lo abre el editor).
 * Prefiere el que declara \documentclass y, entre ellos, main.tex; si ninguno lo declara,
 * el primer .tex de la raíz.
 * @param {Array<{ path: string, content: Buffer }>} files
 * @returns {string} Ruta del archivo principal
 */
function pickMainFile(files) {
  const rootTex = files.filter((file) => !file.path.includes('/') && file.path.toLowerCase().endsWith('.tex'));
  if (rootTex.length === 0) {
    const nested = files.some((file) => file.path.toLowerCase().endsWith('.tex'));
    throw new ValidationError(
      nested
        ? 'El .zip debe tener el archivo .tex principal en la raíz (no dentro de una subcarpeta)'
        : 'El .zip no contiene ningún archivo .tex'
    );
  }
  const declaresDocument = (file) => /\\documentclass/.test(file.content.toString('utf8'));
  const candidates = rootTex.filter(declaresDocument);
  const pool = candidates.length > 0 ? candidates : rootTex;
  return (pool.find((file) => file.path.toLowerCase() === 'main.tex') ?? pool[0]).path;
}

/** Nombre del proyecto a partir del nombre del archivo ("Mi tesis.zip" -> "Mi tesis"). */
function projectNameFromFile(fileName) {
  const base = String(fileName || '').replace(/\\/g, '/').split('/').pop().replace(/\.zip$/i, '').trim();
  return base || 'Proyecto importado';
}

/**
 * Lee y valida el .zip recibido en base64.
 * @returns {{ files: Array<{ path: string, content: Buffer }>, mainFile: string }}
 */
function prepareZipImport(dataBase64) {
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new ValidationError('Selecciona un archivo .zip');
  }
  if (dataBase64.length > MAX_BASE64_LENGTH) throw new ValidationError('El .zip no puede superar 7 MB');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) throw new ValidationError('El archivo recibido no es válido');

  const files = readZip(Buffer.from(dataBase64, 'base64'));

  // Los archivos de texto se guardan en la base de datos: mismo límite que al editarlos
  const tooBig = files.find((file) => isTextFile(file.path) && file.content.length > PROJECT_LIMITS.MAX_CONTENT_BYTES);
  if (tooBig) {
    throw new ValidationError(`"${tooBig.path}" supera el tamaño máximo de un archivo de texto (2 MB)`);
  }
  return { files, mainFile: pickMainFile(files) };
}

module.exports = { prepareZipImport, pickMainFile, projectNameFromFile };
