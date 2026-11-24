/**
 * Formato público (API) de las versiones de un archivo.
 */

function toAuthorDto(userId, users) {
  if (!userId) return null;
  const user = users.get(userId);
  return {
    id: userId,
    name: user ? user.nombre_completo || user.correo || '' : ''
  };
}

/**
 * @param {object} row Fila de versiones_archivo
 * @param {object} [options]
 * @param {Map<string, object>} [options.users] Perfiles de los autores por id
 * @param {{ added: number, removed: number }} [options.changes] Líneas cambiadas respecto a la versión anterior
 * @param {boolean} [options.includeContent] Incluir el contenido completo (solo al consultar una versión)
 * @returns {object}
 */
function toVersionDto(row, { users = new Map(), changes, includeContent = false } = {}) {
  const content = row.contenido_snapshot ?? '';
  return {
    id: row.id,
    number: row.numero_version,
    summary: row.resumen_cambio || '',
    createdAt: row.creado_en,
    author: toAuthorDto(row.modificado_por, users),
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    ...(changes && { changes }),
    ...(includeContent && { content })
  };
}

module.exports = { toVersionDto };
