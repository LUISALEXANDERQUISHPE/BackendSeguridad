const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = require('../errors/AppError');
const { can, PROJECT_ACTIONS } = require('../constants/permissions');
const { VERSION_LIMITS, CURRENT_VERSION, PG_UNIQUE_VIOLATION } = require('../constants/versionConstants');
const { toVersionDto } = require('../mappers/versionMapper');
const { isTextFile } = require('../utils/fileTypes');
const textDiff = require('../utils/textDiff');
const { validateFileId, validateSummary, parsePagination } = require('../validators/versionValidator');
const { createProjectAccessService } = require('./projectAccessService');

/**
 * Servicio de la HU-23 "Control de versiones e historial":
 * registrar modificaciones, consultar el historial, comparar versiones y restaurarlas.
 *
 * El historial es inmutable: restaurar no borra ni reescribe versiones, crea una nueva
 * con el contenido recuperado (como un "git revert").
 *
 * @param {object} deps
 * @param {object} deps.versions Repositorio de versiones y contenido de archivos
 * @param {object} deps.projects Repositorio de proyectos (acceso y perfiles de usuarios)
 * @param {object} deps.storage Almacenamiento de archivos (Supabase Storage)
 * @param {object} deps.logger Registro de advertencias
 * @param {object} [deps.diff] Comparador de textos (inyectable en pruebas)
 */
function createVersionService({ versions, projects, storage, logger, diff = textDiff }) {
  const access = createProjectAccessService({ repository: projects });

  // ---------- Acceso ----------

  /** Archivo de texto y rol del usuario en su proyecto. */
  async function resolveFile(fileId, userId) {
    validateFileId(fileId);
    const file = await versions.findFile(fileId);
    if (file?.tipo_nodo !== 'archivo') {
      throw new NotFoundError('Archivo no encontrado');
    }
    if (!isTextFile(file.nombre)) {
      throw new ValidationError('Los archivos binarios (imágenes, PDF...) no tienen historial de versiones');
    }
    const { role } = await access.resolve(file.proyecto_id, userId);
    return { file, role };
  }

  function assertCanEdit(role) {
    if (!can(role, PROJECT_ACTIONS.MANAGE_VERSIONS)) {
      throw new ForbiddenError('Solo el propietario o un editor pueden modificar el historial de este archivo');
    }
  }

  // ---------- Registro de versiones ----------

  async function insertNextVersion(fileId, userId, content, summary, latest) {
    const number = (latest?.numero_version ?? 0) + 1;
    return versions.insertVersion({
      archivo_id: fileId,
      numero_version: number,
      contenido_snapshot: content,
      modificado_por: userId,
      resumen_cambio: summary || `Versión ${number}`
    });
  }

  /**
   * Registra el contenido como nueva versión del archivo.
   * No duplica versiones: si el contenido es igual al de la última, no crea nada.
   * Si otro guardado simultáneo tomó el mismo número, reintenta con el siguiente.
   *
   * @returns {Promise<object|null>} Fila creada, o null si no había cambios
   */
  async function recordVersion({ fileId, userId, content, summary = null }) {
    for (let attempt = 1; attempt <= VERSION_LIMITS.MAX_NUMBER_RETRIES; attempt += 1) {
      const latest = await versions.findLatestVersion(fileId);
      if (latest && latest.contenido_snapshot === content) return null;

      try {
        return await insertNextVersion(fileId, userId, content, summary, latest);
      } catch (error) {
        const isLastAttempt = attempt === VERSION_LIMITS.MAX_NUMBER_RETRIES;
        if (error?.code !== PG_UNIQUE_VIOLATION || isLastAttempt) throw error;
      }
    }
    return null;
  }

  // ---------- Consulta ----------

  async function findVersionOrFail(fileId, number) {
    const version = await versions.findVersion(fileId, number);
    if (!version) {
      throw new NotFoundError(`La versión ${number} no existe`);
    }
    return version;
  }

  async function loadAuthors(rows) {
    const authorIds = [...new Set(rows.map((row) => row.modificado_por).filter(Boolean))];
    return projects.findUsersByIds(authorIds);
  }

  /**
   * LISTAR el historial (más reciente primero) con las líneas cambiadas en cada versión.
   */
  async function listVersions(userId, fileId, query) {
    const { file } = await resolveFile(fileId, userId);
    const { limit, offset } = parsePagination(query);
    const { rows, total } = await versions.listVersions(fileId, { limit, offset });

    const page = rows.slice(0, limit);
    const users = await loadAuthors(page);
    const items = page.map((row, index) => {
      const previous = rows[index + 1]?.contenido_snapshot ?? '';
      return toVersionDto(row, {
        users,
        changes: diff.countLineChanges(previous, row.contenido_snapshot ?? '')
      });
    });

    const latest = offset === 0 ? rows[0] : await versions.findLatestVersion(fileId);
    return {
      versions: items,
      total,
      limit,
      offset,
      // true si el archivo tiene cambios posteriores a la última versión registrada
      hasUnversionedChanges: (latest?.contenido_snapshot ?? '') !== (file.contenido_actual ?? '')
    };
  }

  /** OBTENER una versión con su contenido completo. */
  async function getVersion(userId, fileId, number) {
    await resolveFile(fileId, userId);
    const version = await findVersionOrFail(fileId, number);
    const users = await loadAuthors([version]);
    return toVersionDto(version, { users, includeContent: true });
  }

  // ---------- Comparación ----------

  async function resolveContent(file, ref) {
    if (ref === CURRENT_VERSION) return file.contenido_actual ?? '';
    const version = await findVersionOrFail(file.id, ref);
    return version.contenido_snapshot ?? '';
  }

  function assertComparable(...texts) {
    const tooLarge = texts.some((text) => diff.splitLines(text).length > VERSION_LIMITS.MAX_DIFF_LINES);
    if (tooLarge) {
      throw new ValidationError(
        `El archivo supera las ${VERSION_LIMITS.MAX_DIFF_LINES} líneas y no se puede comparar en línea`
      );
    }
  }

  /**
   * COMPARAR dos versiones (o una versión con el contenido actual).
   * @param {number|'current'} from Versión de referencia (anterior)
   * @param {number|'current'} to Versión a comparar (nueva)
   */
  async function compareVersions(userId, fileId, { from, to }) {
    const { file } = await resolveFile(fileId, userId);
    const [oldText, newText] = await Promise.all([resolveContent(file, from), resolveContent(file, to)]);
    assertComparable(oldText, newText);

    const { lines, stats } = diff.computeLineDiff(oldText, newText);
    return { from, to, fileName: file.nombre, lines, stats };
  }

  // ---------- Modificación ----------

  /**
   * GUARDAR UNA VERSIÓN con nombre (punto de control) a partir del contenido actual.
   */
  async function createVersion(userId, fileId, { summary } = {}) {
    const { file, role } = await resolveFile(fileId, userId);
    assertCanEdit(role);

    const created = await recordVersion({
      fileId,
      userId,
      content: file.contenido_actual ?? '',
      summary: validateSummary(summary)
    });
    if (!created) {
      throw new ConflictError('No hay cambios desde la última versión guardada');
    }

    const users = await loadAuthors([created]);
    return toVersionDto(created, { users });
  }

  async function syncStorage(file, content) {
    try {
      await storage.syncNodeSource(file, content);
    } catch (error) {
      logger.warn('Advertencia al sincronizar la versión restaurada con Storage:', error.message);
    }
  }

  /**
   * RESTAURAR una versión anterior. Antes de reemplazar el contenido, guarda como respaldo
   * los cambios que aún no eran versión, para que restaurar nunca haga perder trabajo.
   *
   * @returns {Promise<{ version: object, content: string }>}
   */
  async function restoreVersion(userId, fileId, number) {
    const { file, role } = await resolveFile(fileId, userId);
    assertCanEdit(role);

    const target = await findVersionOrFail(fileId, number);
    const restoredContent = target.contenido_snapshot ?? '';
    const currentContent = file.contenido_actual ?? '';
    if (restoredContent === currentContent) {
      throw new ConflictError(`La versión ${number} ya es el contenido actual del archivo`);
    }

    await recordVersion({
      fileId,
      userId,
      content: currentContent,
      summary: `Respaldo automático antes de restaurar la versión ${number}`
    });

    const updatedFile = await versions.updateFileContent(fileId, restoredContent);
    await versions.replaceAutosaves(fileId, restoredContent);
    await syncStorage(updatedFile, restoredContent);

    const created = await recordVersion({
      fileId,
      userId,
      content: restoredContent,
      summary: `Restaurada desde la versión ${number}`
    });

    const users = await loadAuthors([created ?? target]);
    return { version: toVersionDto(created ?? target, { users }), content: restoredContent };
  }

  return {
    recordVersion,
    listVersions,
    getVersion,
    compareVersions,
    createVersion,
    restoreVersion
  };
}

module.exports = { createVersionService };
