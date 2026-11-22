const supabase = require('../config/supabase');

const FILE_COLUMNS = 'id, proyecto_id, padre_id, nombre, tipo_nodo, contenido_actual, storage_path, tamano_bytes, actualizado_en';
const VERSION_COLUMNS = 'id, archivo_id, numero_version, contenido_snapshot, modificado_por, resumen_cambio, creado_en';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * Repositorio del historial de versiones (tabla versiones_archivo) y del contenido vigente
 * de los archivos. Es la única capa que conoce estas tablas (responsabilidad única);
 * recibe el cliente por parámetro para poder sustituirlo en pruebas (inversión de dependencias).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createVersionRepository(db) {
  return {
    async findFile(fileId) {
      return unwrap(await db.from('nodos').select(FILE_COLUMNS).eq('id', fileId).maybeSingle());
    },

    /**
     * Página del historial, de la más reciente a la más antigua.
     * Pide una fila extra (la versión anterior a la página) para calcular los cambios de la última.
     * @returns {Promise<{ rows: object[], total: number }>}
     */
    async listVersions(fileId, { limit, offset }) {
      const { data, error, count } = await db
        .from('versiones_archivo')
        .select(VERSION_COLUMNS, { count: 'exact' })
        .eq('archivo_id', fileId)
        .order('numero_version', { ascending: false })
        .range(offset, offset + limit);
      if (error) throw error;
      return { rows: data || [], total: count || 0 };
    },

    async findVersion(fileId, number) {
      return unwrap(
        await db
          .from('versiones_archivo')
          .select(VERSION_COLUMNS)
          .eq('archivo_id', fileId)
          .eq('numero_version', number)
          .maybeSingle()
      );
    },

    async findLatestVersion(fileId) {
      return unwrap(
        await db
          .from('versiones_archivo')
          .select(VERSION_COLUMNS)
          .eq('archivo_id', fileId)
          .order('numero_version', { ascending: false })
          .limit(1)
          .maybeSingle()
      );
    },

    /** Inserta una versión; si el número ya existe, Supabase lanza el error 23505. */
    async insertVersion(version) {
      return unwrap(await db.from('versiones_archivo').insert(version).select(VERSION_COLUMNS).single());
    },

    async updateFileContent(fileId, content) {
      return unwrap(
        await db
          .from('nodos')
          .update({
            contenido_actual: content,
            tamano_bytes: Buffer.byteLength(content, 'utf8'),
            actualizado_en: new Date().toISOString()
          })
          .eq('id', fileId)
          .select(FILE_COLUMNS)
          .single()
      );
    },

    /**
     * Reemplaza los autoguardados pendientes del archivo: si no, el editor de cada usuario
     * volvería a cargar su borrador anterior encima del contenido restaurado.
     */
    async replaceAutosaves(fileId, content) {
      unwrap(
        await db
          .from('estados_autoguardado')
          .update({ buffer_contenido: content, guardado_en: new Date().toISOString(), esta_sincronizado: true })
          .eq('archivo_id', fileId)
      );
    }
  };
}

module.exports = createVersionRepository(supabase);
module.exports.createVersionRepository = createVersionRepository;
