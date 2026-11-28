const { SENSITIVE_TABLES } = require('./sensitiveColumns');

const CACHE_SIZE = 20000;

/** Map con tamaño máximo: al llenarse descarta lo más antiguo. */
function createBoundedCache(limit = CACHE_SIZE) {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set(key, value) {
      if (map.size >= limit) map.delete(map.keys().next().value);
      map.set(key, value);
      return value;
    }
  };
}

/**
 * Averigua a qué proyecto pertenece una fila que se va a escribir, para cifrarla con su llave.
 * Usa primero los datos de la propia escritura (proyecto_id, archivo_id o los filtros .eq())
 * y, si no alcanzan, consulta la base de datos. Los resultados se guardan en caché porque
 * un archivo o comentario nunca cambia de proyecto.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} rawClient Cliente SIN la capa de cifrado
 */
function createProjectResolver(rawClient) {
  const cache = createBoundedCache();

  async function lookup(table, id, column) {
    const cacheKey = `${table}:${id}:${column}`;
    const hit = cache.get(cacheKey);
    if (hit) return hit;
    const { data, error } = await rawClient.from(table).select(column).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data?.[column]) return null;
    return cache.set(cacheKey, data[column]);
  }

  /**
   * @param {string} table
   * @param {object} row Valores que se escriben
   * @param {Record<string, unknown>} filters Filtros .eq() de la consulta (en un update)
   * @returns {Promise<string>} id del proyecto
   */
  async function resolveProjectId(table, row, filters) {
    const rule = SENSITIVE_TABLES[table]?.project;
    if (!rule) throw new Error(`La tabla ${table} no tiene columnas cifradas`);

    if (rule.self) {
      const id = row.id ?? filters.id;
      if (id) return String(id);
    } else if (rule.column) {
      const direct = row[rule.column] ?? filters[rule.column];
      if (direct) return String(direct);
      if (filters.id) {
        const found = await lookup(table, filters.id, rule.column);
        if (found) return String(found);
      }
    } else if (rule.file) {
      const fileId = row[rule.file] ?? filters[rule.file] ?? (filters.id ? await lookup(table, filters.id, rule.file) : null);
      if (fileId) {
        const projectId = await lookup('nodos', fileId, 'proyecto_id');
        if (projectId) return String(projectId);
      }
    }

    // Nunca se escribe en claro: si no se sabe el proyecto, la escritura se rechaza
    throw new Error(`No se pudo determinar el proyecto para cifrar los datos de ${table}`);
  }

  return { resolveProjectId };
}

module.exports = { createProjectResolver };
