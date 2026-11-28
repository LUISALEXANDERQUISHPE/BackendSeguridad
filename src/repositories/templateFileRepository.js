const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  TEMPLATES_ROOT,
  MANIFEST_FILE,
  PREVIEW_FILE,
  TEMPLATE_LIMITS
} = require('../constants/templateConstants');
const { parseManifest } = require('../validators/templateValidator');

/** Archivos de la carpeta de la plantilla que no forman parte del proyecto copiado. */
const EXCLUDED_FILES = new Set([MANIFEST_FILE, PREVIEW_FILE]);

async function readManifest(rootDir, slug) {
  const raw = await fsp.readFile(path.join(rootDir, slug, MANIFEST_FILE), 'utf8');
  return parseManifest(JSON.parse(raw), slug);
}

/**
 * Recorre la carpeta de una plantilla y devuelve sus archivos con ruta relativa ("capitulos/intro.tex").
 * No sigue enlaces simbólicos y respeta los límites de cantidad, tamaño y profundidad.
 */
async function collectFiles(templateDir, relativeDir = '', depth = 0, state = { totalBytes: 0, files: [] }) {
  if (depth > TEMPLATE_LIMITS.MAX_DEPTH) {
    throw new Error(`La plantilla supera la profundidad máxima de carpetas (${TEMPLATE_LIMITS.MAX_DEPTH})`);
  }

  const entries = await fsp.readdir(path.join(templateDir, relativeDir), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`La plantilla no puede contener enlaces simbólicos (${relativePath})`);
    }
    if (entry.isDirectory()) {
      await collectFiles(templateDir, relativePath, depth + 1, state);
    } else if (entry.isFile() && !(depth === 0 && EXCLUDED_FILES.has(entry.name))) {
      const content = await fsp.readFile(path.join(templateDir, relativePath));
      state.totalBytes += content.length;
      state.files.push({ path: relativePath, content });
    }

    if (state.files.length > TEMPLATE_LIMITS.MAX_FILES || state.totalBytes > TEMPLATE_LIMITS.MAX_TOTAL_BYTES) {
      throw new Error('La plantilla supera la cantidad o el tamaño máximo permitido');
    }
  }
  return state.files;
}

/**
 * Repositorio de SOLO LECTURA de las plantillas base guardadas en disco.
 * No expone ninguna operación de escritura: las plantillas del sistema no se pueden modificar
 * ni eliminar desde la aplicación (al usarlas se copian a un proyecto nuevo).
 *
 * El catálogo se lee una sola vez y queda en memoria (las plantillas solo cambian al desplegar).
 *
 * @param {{ rootDir?: string }} [options]
 */
function createTemplateFileRepository({ rootDir = TEMPLATES_ROOT } = {}) {
  let catalogPromise = null;

  async function loadCatalog() {
    const entries = await fsp.readdir(rootDir, { withFileTypes: true });
    const slugs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    const templates = await Promise.all(slugs.map(slug => readManifest(rootDir, slug)));

    const ids = new Set();
    for (const template of templates) {
      if (ids.has(template.id)) throw new Error(`Hay dos plantillas con el mismo id (${template.id})`);
      ids.add(template.id);
    }
    return templates.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  /** Catálogo completo (metadatos de todas las plantillas), ordenado para mostrar. */
  function listTemplates() {
    catalogPromise ??= loadCatalog().catch(error => {
      // Si falla (ej. manifiesto inválido), el siguiente intento vuelve a leer el disco
      catalogPromise = null;
      throw error;
    });
    return catalogPromise;
  }

  async function findTemplate(templateId) {
    const templates = await listTemplates();
    return templates.find(template => template.id === templateId) ?? null;
  }

  /** Archivos de la plantilla (sin template.json ni preview.pdf), listos para copiar. */
  function readFiles(template) {
    return collectFiles(path.join(rootDir, template.slug));
  }

  /** Vista previa compilada de la plantilla, o null si no existe. */
  async function readPreview(template) {
    try {
      return await fsp.readFile(path.join(rootDir, template.slug, PREVIEW_FILE));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  return { listTemplates, findTemplate, readFiles, readPreview };
}

module.exports = createTemplateFileRepository();
module.exports.createTemplateFileRepository = createTemplateFileRepository;
