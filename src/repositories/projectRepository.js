const supabase = require('../config/supabase');
const { NODE_TYPES, FILE_TYPES } = require('../constants/projectConstants');

const MAIN_NODE_COLUMNS = 'id, proyecto_id, nombre, tamano_bytes, creado_en, actualizado_en';
const COMPILATION_COLUMNS = 'id, proyecto_id, estado, iniciado_en, finalizado_en';
const OWNER_COLUMNS = 'id, nombre_completo, correo';

/**
 * Extrae los datos de una respuesta de Supabase o lanza el error recibido.
 * @template T
 * @param {{ data: T, error: unknown }} response
 * @returns {T}
 */
function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * Agrupa filas por proyecto conservando la primera que aparece (según el orden de la consulta).
 * @param {Array<{ proyecto_id: string }>} rows
 * @returns {Map<string, object>}
 */
function firstByProject(rows) {
  const result = new Map();
  for (const row of rows || []) {
    if (!result.has(row.proyecto_id)) {
      result.set(row.proyecto_id, row);
    }
  }
  return result;
}

/**
 * Repositorio de proyectos: única capa que conoce las tablas de Supabase
 * involucradas en la gestión de proyectos (principio de responsabilidad única).
 * Recibe el cliente por parámetro para poder sustituirlo en pruebas (inversión de dependencias).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createProjectRepository(db) {
  return {
    async findById(projectId) {
      return unwrap(await db.from('proyectos').select('*').eq('id', projectId).maybeSingle());
    },

    async findMemberRole(projectId, userId) {
      const membership = unwrap(
        await db
          .from('miembros_proyecto')
          .select('rol')
          .eq('proyecto_id', projectId)
          .eq('usuario_id', userId)
          .maybeSingle()
      );
      return membership ? membership.rol : null;
    },

    async findOwnedByUser(userId, archived) {
      return unwrap(
        await db
          .from('proyectos')
          .select('*')
          .eq('propietario_id', userId)
          .eq('esta_archivado', archived)
      ) || [];
    },

    async findMembershipsWithProject(userId) {
      return unwrap(
        await db
          .from('miembros_proyecto')
          .select('proyecto_id, rol, proyectos(*)')
          .eq('usuario_id', userId)
      ) || [];
    },

    async insertProject(project) {
      return unwrap(await db.from('proyectos').insert(project).select('*').single());
    },

    async updateProject(projectId, changes) {
      return unwrap(
        await db.from('proyectos').update(changes).eq('id', projectId).select('*').single()
      );
    },

    async addMember(projectId, userId, role) {
      unwrap(
        await db.from('miembros_proyecto').insert({
          proyecto_id: projectId,
          usuario_id: userId,
          rol: role
        })
      );
    },

    /**
     * Archivo .tex principal (en la raíz) de cada proyecto indicado.
     * @param {string[]} projectIds
     * @returns {Promise<Map<string, object>>}
     */
    async findMainNodes(projectIds) {
      if (projectIds.length === 0) return new Map();

      const nodes = unwrap(
        await db
          .from('nodos')
          .select(MAIN_NODE_COLUMNS)
          .in('proyecto_id', projectIds)
          .eq('tipo_nodo', NODE_TYPES.FILE)
          .eq('tipo_archivo', FILE_TYPES.TEX)
          .is('padre_id', null)
          .order('creado_en', { ascending: true })
      );
      return firstByProject(nodes);
    },

    async findNodesByProject(projectId) {
      return unwrap(
        await db
          .from('nodos')
          .select('*')
          .eq('proyecto_id', projectId)
          .order('creado_en', { ascending: true })
      ) || [];
    },

    async insertNode(node) {
      return unwrap(await db.from('nodos').insert(node).select('*').single());
    },

    async insertNodes(nodes) {
      if (nodes.length === 0) return [];
      return unwrap(await db.from('nodos').insert(nodes).select(MAIN_NODE_COLUMNS)) || [];
    },

    async updateNode(nodeId, changes) {
      return unwrap(await db.from('nodos').update(changes).eq('id', nodeId).select('*').single());
    },

    async insertVersions(versions) {
      if (versions.length === 0) return;
      unwrap(await db.from('versiones_archivo').insert(versions));
    },

    /**
     * Última compilación de cada proyecto indicado.
     * @param {string[]} projectIds
     * @returns {Promise<Map<string, object>>}
     */
    async findLatestCompilations(projectIds) {
      if (projectIds.length === 0) return new Map();

      const compilations = unwrap(
        await db
          .from('compilaciones')
          .select(COMPILATION_COLUMNS)
          .in('proyecto_id', projectIds)
          .order('iniciado_en', { ascending: false })
      );
      return firstByProject(compilations);
    },

    async findCompilationIds(projectId) {
      const rows = unwrap(
        await db.from('compilaciones').select('id').eq('proyecto_id', projectId)
      ) || [];
      return rows.map(row => row.id);
    },

    /**
     * Perfil público de los usuarios indicados.
     * @param {string[]} userIds
     * @returns {Promise<Map<string, object>>}
     */
    async findUsersByIds(userIds) {
      if (userIds.length === 0) return new Map();

      const users = unwrap(await db.from('usuarios').select(OWNER_COLUMNS).in('id', userIds)) || [];
      return new Map(users.map(user => [user.id, user]));
    },

    /**
     * Elimina un proyecto y todos sus registros dependientes.
     * El esquema no define ON DELETE CASCADE, por lo que se borra en orden de dependencia.
     * Los registros de auditoría se conservan, solo se desvinculan del proyecto.
     * @param {string} projectId
     */
    async deleteProjectCascade(projectId) {
      const nodes = unwrap(await db.from('nodos').select('id').eq('proyecto_id', projectId)) || [];
      const nodeIds = nodes.map(node => node.id);

      unwrap(await db.from('compilaciones').delete().eq('proyecto_id', projectId));

      if (nodeIds.length > 0) {
        unwrap(await db.from('versiones_archivo').delete().in('archivo_id', nodeIds));
        unwrap(await db.from('estados_autoguardado').delete().in('archivo_id', nodeIds));
        unwrap(await db.from('permisos_archivo').delete().in('nodo_id', nodeIds));
        unwrap(await db.from('sesiones_edicion').delete().in('archivo_id', nodeIds));
        unwrap(await db.from('comentarios').delete().in('archivo_id', nodeIds));
        // Una sola sentencia: la FK padre_id (NO ACTION) se verifica al final de la sentencia
        unwrap(await db.from('nodos').delete().eq('proyecto_id', projectId));
      }

      unwrap(await db.from('invitaciones').delete().eq('proyecto_id', projectId));
      unwrap(await db.from('miembros_proyecto').delete().eq('proyecto_id', projectId));
      unwrap(
        await db.from('registros_auditoria').update({ proyecto_id: null }).eq('proyecto_id', projectId)
      );
      unwrap(await db.from('proyectos').delete().eq('id', projectId));
    }
  };
}

module.exports = createProjectRepository(supabase);
module.exports.createProjectRepository = createProjectRepository;
