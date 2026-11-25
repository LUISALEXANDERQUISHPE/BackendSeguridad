const supabase = require('../config/supabase');

const COMMENT_COLUMNS = 'id, archivo_id, usuario_id, comentario_padre_id, seleccion_inicio, seleccion_fin, texto_citado, contenido, esta_resuelto, resuelto_por, resuelto_en, creado_en, actualizado_en';
const AUTHOR = 'autor:usuarios!comentarios_usuario_id_fkey(nombre_completo, correo)';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * HU-25: Repositorio de comentarios (tabla comentarios). Un hilo es un comentario raíz
 * (comentario_padre_id = NULL) más sus respuestas.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 */
function createCommentRepository(db) {
  return {
    /** Archivo (nodo) con su proyecto, para validar el acceso. */
    async findFile(fileId) {
      return unwrap(await db.from('nodos').select('id, proyecto_id, nombre, tipo_nodo').eq('id', fileId).maybeSingle());
    },

    /** Todos los comentarios (raíces y respuestas) de un archivo, en orden de creación. */
    async findByFile(fileId) {
      return unwrap(
        await db.from('comentarios').select(`${COMMENT_COLUMNS}, ${AUTHOR}`).eq('archivo_id', fileId).order('creado_en', { ascending: true })
      ) || [];
    },

    async findById(commentId) {
      return unwrap(await db.from('comentarios').select(COMMENT_COLUMNS).eq('id', commentId).maybeSingle());
    },

    async insert(comment) {
      return unwrap(await db.from('comentarios').insert(comment).select(`${COMMENT_COLUMNS}, ${AUTHOR}`).single());
    },

    async update(commentId, changes) {
      return unwrap(
        await db.from('comentarios').update(changes).eq('id', commentId).select(`${COMMENT_COLUMNS}, ${AUTHOR}`).single()
      );
    },

    /** Borra un comentario; si es raíz, también sus respuestas (la FK no tiene ON DELETE CASCADE). */
    async deleteThread(commentId) {
      unwrap(await db.from('comentarios').delete().eq('comentario_padre_id', commentId));
      unwrap(await db.from('comentarios').delete().eq('id', commentId));
    }
  };
}

module.exports = createCommentRepository(supabase);
module.exports.createCommentRepository = createCommentRepository;
