const path = require('node:path');

/**
 * Constantes de las plantillas LaTeX del sistema.
 *
 * Las plantillas base viven en la carpeta "templates" del backend (versionadas en Git y de
 * solo lectura para la aplicación): ninguna ruta de la API puede modificarlas ni borrarlas.
 * Al usarlas se crea una COPIA independiente como proyecto nuevo del usuario.
 */
const TEMPLATES_ROOT = path.resolve(__dirname, '../../templates');

/** Archivo con los metadatos de cada plantilla (no se copia al proyecto). */
const MANIFEST_FILE = 'template.json';

/** Vista previa ya compilada de la plantilla (no se copia al proyecto). */
const PREVIEW_FILE = 'preview.pdf';

const TEMPLATE_CATEGORIES = Object.freeze({
  tesis: 'Tesis',
  articulo: 'Artículos',
  normas: 'Normas de citación',
  informe: 'Informes',
  presentacion: 'Presentaciones',
  carta: 'Cartas',
  cv: 'Currículum'
});

const TEMPLATE_LIMITS = Object.freeze({
  /** Archivos máximos por plantilla (protege al servidor de plantillas mal empaquetadas). */
  MAX_FILES: 200,
  /** Tamaño total máximo de una plantilla. */
  MAX_TOTAL_BYTES: 10 * 1024 * 1024,
  /** Profundidad máxima de carpetas dentro de una plantilla. */
  MAX_DEPTH: 8
});

module.exports = {
  TEMPLATES_ROOT,
  MANIFEST_FILE,
  PREVIEW_FILE,
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIMITS
};
