const supabase = require('../config/supabase');
const { INVITATION_STATUS } = require('../constants/invitationConstants');

const INVITATION_COLUMNS = 'id, proyecto_id, correo, rol, estado, creado_por, expira_en, creado_en, respondido_en';
const CREATOR = 'creador:usuarios!invitaciones_creado_por_fkey(nombre_completo, correo)';
const PROJECT = 'proyecto:proyectos!invitaciones_proyecto_id_fkey(id, nombre, propietario_id)';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * HU-25: Repositorio de invitaciones a proyectos. El token se guarda y se busca siempre
 * como hash: esta capa nunca recibe ni devuelve el token en claro.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createInvitationRepository(db) {
  return {
    async insert(invitation) {
      return unwrap(await db.from('invitaciones').insert(invitation).select(INVITATION_COLUMNS).single());
    },

    async update(invitationId, changes) {
      return unwrap(
        await db.from('invitaciones').update(changes).eq('id', invitationId).select(INVITATION_COLUMNS).single()
      );
    },

    /** Invitación con su proyecto y quién la creó. */
    async findById(invitationId) {
      return unwrap(
        await db.from('invitaciones').select(`${INVITATION_COLUMNS}, ${CREATOR}, ${PROJECT}`).eq('id', invitationId).maybeSingle()
      );
    },

    async findByTokenHash(tokenHash) {
      return unwrap(
        await db.from('invitaciones').select(`${INVITATION_COLUMNS}, ${CREATOR}, ${PROJECT}`).eq('token', tokenHash).maybeSingle()
      );
    },

    /** Invitaciones pendientes de un proyecto (panel "Administrar acceso" del propietario). */
    async findPendingByProject(projectId) {
      return unwrap(
        await db
          .from('invitaciones')
          .select(`${INVITATION_COLUMNS}, ${CREATOR}`)
          .eq('proyecto_id', projectId)
          .eq('estado', INVITATION_STATUS.PENDING)
          .order('creado_en', { ascending: true })
      ) || [];
    },

    async findPendingByProjectAndEmail(projectId, email) {
      return unwrap(
        await db
          .from('invitaciones')
          .select(INVITATION_COLUMNS)
          .eq('proyecto_id', projectId)
          .eq('correo', email)
          .eq('estado', INVITATION_STATUS.PENDING)
          .maybeSingle()
      );
    },

    /** Bandeja del usuario: invitaciones pendientes dirigidas a su correo. */
    async findPendingByEmail(email) {
      return unwrap(
        await db
          .from('invitaciones')
          .select(`${INVITATION_COLUMNS}, ${CREATOR}, ${PROJECT}`)
          .eq('correo', email)
          .eq('estado', INVITATION_STATUS.PENDING)
          .order('creado_en', { ascending: false })
      ) || [];
    },

    async countPendingByProject(projectId) {
      const { count, error } = await db
        .from('invitaciones')
        .select('id', { count: 'exact', head: true })
        .eq('proyecto_id', projectId)
        .eq('estado', INVITATION_STATUS.PENDING);
      if (error) throw error;
      return count || 0;
    }
  };
}

module.exports = createInvitationRepository(supabase);
module.exports.createInvitationRepository = createInvitationRepository;
