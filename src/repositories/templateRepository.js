const supabase = require('../config/supabase');

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * Repositorio del catálogo de plantillas en la base de datos (tabla "plantillas").
 * Solo registra y actualiza las plantillas del sistema; no ofrece operación de borrado
 * (además, la base de datos lo impide con un trigger, ver supabase/008_plantillas.sql).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createTemplateRepository(db) {
  return {
    /**
     * Inserta o actualiza las plantillas del sistema (por id), sin tocar las demás.
     * @param {object[]} rows Filas de la tabla plantillas
     */
    async upsertSystemTemplates(rows) {
      if (rows.length === 0) return;
      unwrap(await db.from('plantillas').upsert(rows, { onConflict: 'id' }));
    }
  };
}

module.exports = createTemplateRepository(supabase);
module.exports.createTemplateRepository = createTemplateRepository;
