const { PROJECT_ROLES } = require('../constants/projectConstants');

/**
 * Devuelve la fecha más reciente de la lista (ignorando valores vacíos).
 * @param {Array<string|null|undefined>} dates
 * @returns {string|null}
 */
function latestDate(dates) {
  return dates
    .filter(Boolean)
    .reduce((latest, date) => (!latest || new Date(date) > new Date(latest) ? date : latest), null);
}

/**
 * @param {object|null|undefined} owner
 * @returns {string}
 */
function toOwnerName(owner) {
  if (!owner) return '';
  return owner.nombre_completo || owner.correo || '';
}

/**
 * @param {object|null|undefined} compilation
 * @returns {object|null}
 */
function toCompilationDto(compilation) {
  if (!compilation) return null;
  return {
    id: compilation.id,
    status: compilation.estado,
    startedAt: compilation.iniciado_en,
    finishedAt: compilation.finalizado_en
  };
}

/**
 * Convierte un registro de la tabla "proyectos" (y sus datos relacionados)
 * al formato público que consume el frontend.
 *
 * @param {object} project Fila de la tabla proyectos
 * @param {{ role?: string, owner?: object, mainNode?: object, lastCompilation?: object }} [related]
 * @returns {object}
 */
function toProjectDto(project, { role, owner, mainNode, lastCompilation } = {}) {
  return {
    id: project.id,
    name: project.nombre,
    description: project.descripcion || '',
    isArchived: Boolean(project.esta_archivado),
    role: role || PROJECT_ROLES.GUEST,
    ownerId: project.propietario_id,
    ownerName: toOwnerName(owner),
    documentId: mainNode?.id ?? null,
    documentName: mainNode?.nombre ?? null,
    sizeBytes: mainNode?.tamano_bytes ?? 0,
    createdAt: project.creado_en,
    updatedAt: latestDate([project.actualizado_en, mainNode?.actualizado_en, project.creado_en]),
    lastCompilation: toCompilationDto(lastCompilation)
  };
}

module.exports = { toProjectDto };
