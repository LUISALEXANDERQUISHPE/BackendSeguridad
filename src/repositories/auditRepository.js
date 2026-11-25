const supabase = require('../config/supabase');

/**
 * Registro de auditoría (tabla registros_auditoria): quién hizo qué, sobre qué y desde dónde.
 * HU-25 lo usa para dejar rastro de invitaciones y cambios de permisos.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createAuditRepository(db) {
  return {
    /**
     * @param {{ userId: string|null, projectId?: string|null, action: string, entityType?: string,
     *           entityId?: string|null, ip?: string|null, metadata?: object }} entry
     */
    async record({ userId, projectId = null, action, entityType = null, entityId = null, ip = null, metadata = null }) {
      const { error } = await db.from('registros_auditoria').insert({
        usuario_id: userId,
        proyecto_id: projectId,
        accion: action,
        tipo_entidad: entityType,
        entidad_id: entityId,
        direccion_ip: ip,
        metadatos: metadata
      });
      if (error) throw error;
    }
  };
}

module.exports = createAuditRepository(supabase);
module.exports.createAuditRepository = createAuditRepository;
