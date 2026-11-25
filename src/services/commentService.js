const { ValidationError, ForbiddenError, NotFoundError, ConflictError } = require('../errors/AppError');
const { can, PROJECT_ACTIONS } = require('../constants/permissions');
const { isTextFile } = require('../utils/fileTypes');
const { isValidUuid } = require('../utils/validators');
const { createProjectAccessService } = require('./projectAccessService');

const COMMENT_LIMITS = Object.freeze({
  MAX_CONTENT_LENGTH: 2000,
  MAX_QUOTE_LENGTH: 500,
  // Posición máxima razonable dentro de un archivo (límite de tamaño de 2 MB)
  MAX_POSITION: 2 * 1024 * 1024
});

// Caracteres de control (salvo salto de línea y tabulación): no tienen sentido en un comentario
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function validateId(id, label) {
  if (!isValidUuid(id)) throw new ValidationError(`Identificador de ${label} inválido`);
  return id;
}

/** Texto del comentario: sin caracteres de control, sin espacios al borde y de longitud acotada. */
function validateContent(content) {
  const value = typeof content === 'string' ? content.replace(CONTROL_CHARS, '').trim() : '';
  if (!value) throw new ValidationError('El comentario no puede estar vacío');
  if (value.length > COMMENT_LIMITS.MAX_CONTENT_LENGTH) {
    throw new ValidationError(`El comentario no puede superar los ${COMMENT_LIMITS.MAX_CONTENT_LENGTH} caracteres`);
  }
  return value;
}

/** Selección comentada: enteros, no negativos, inicio <= fin y dentro del tamaño máximo de un archivo. */
function validateSelection(start, end) {
  const isPosition = (value) => Number.isInteger(value) && value >= 0 && value <= COMMENT_LIMITS.MAX_POSITION;
  if (!isPosition(start) || !isPosition(end) || start > end) {
    throw new ValidationError('La selección del comentario no es válida');
  }
  if (start === end) throw new ValidationError('Selecciona el texto que quieres comentar');
  return { start, end };
}

function normalizeQuote(quote) {
  if (typeof quote !== 'string') return null;
  return quote.replace(CONTROL_CHARS, '').slice(0, COMMENT_LIMITS.MAX_QUOTE_LENGTH) || null;
}

const authorOf = (row) => ({ id: row.usuario_id, name: row.autor?.nombre_completo || row.autor?.correo || 'Usuario' });

/**
 * HU-25: Comentarios en hilos sobre fragmentos del documento, con los permisos de Overleaf:
 *  - todos los miembros ven los comentarios;
 *  - propietario y editor comentan, responden y resuelven (el lector solo lee);
 *  - solo el autor edita su comentario; borra el autor o quien puede resolver.
 * El contenido se guarda como texto plano y el frontend lo muestra como texto (nunca HTML).
 *
 * @param {object} deps
 * @param {object} deps.comments Repositorio de comentarios
 * @param {object} deps.projects Repositorio de proyectos (para el rol del usuario)
 * @param {(fileId: string) => void} [deps.onCommentsChanged] Aviso en tiempo real a quienes tienen el archivo abierto
 * @param {() => Date} [deps.now]
 */
function createCommentService({ comments, projects, onCommentsChanged = () => {}, now = () => new Date() }) {
  const access = createProjectAccessService({ repository: projects });

  /** Archivo de texto y rol del usuario en su proyecto. */
  async function resolveFile(fileId, userId) {
    validateId(fileId, 'archivo');
    const file = await comments.findFile(fileId);
    if (file?.tipo_nodo !== 'archivo') throw new NotFoundError('Archivo no encontrado');
    if (!isTextFile(file.nombre)) throw new ValidationError('Solo se pueden comentar archivos de texto');
    const { role } = await access.resolve(file.proyecto_id, userId);
    return { file, role };
  }

  /** Comentario existente, su archivo y el rol del usuario. */
  async function resolveComment(commentId, userId) {
    validateId(commentId, 'comentario');
    const comment = await comments.findById(commentId);
    if (!comment) throw new NotFoundError('Comentario no encontrado');
    const { file, role } = await resolveFile(comment.archivo_id, userId);
    return { comment, file, role };
  }

  function assertCan(role, action, message) {
    if (!can(role, action)) throw new ForbiddenError(message);
  }

  function toReplyDto(row, userId) {
    return {
      id: row.id,
      author: authorOf(row),
      isOwn: row.usuario_id === userId,
      content: row.contenido,
      createdAt: row.creado_en,
      updatedAt: row.actualizado_en || null
    };
  }

  function toThreadDto(root, replies, userId) {
    return {
      ...toReplyDto(root, userId),
      selection: { start: root.seleccion_inicio, end: root.seleccion_fin },
      quotedText: root.texto_citado || null,
      resolved: Boolean(root.esta_resuelto),
      resolvedAt: root.resuelto_en || null,
      replies: replies.map((reply) => toReplyDto(reply, userId))
    };
  }

  /** LISTAR los hilos de un archivo (cualquier miembro), ordenados por su posición en el texto. */
  async function listThreads(userId, fileId) {
    const { file, role } = await resolveFile(fileId, userId);
    assertCan(role, PROJECT_ACTIONS.VIEW_COMMENTS, 'No tienes permisos para ver los comentarios');

    const rows = await comments.findByFile(file.id);
    const repliesByRoot = new Map();
    for (const row of rows) {
      if (row.comentario_padre_id) {
        if (!repliesByRoot.has(row.comentario_padre_id)) repliesByRoot.set(row.comentario_padre_id, []);
        repliesByRoot.get(row.comentario_padre_id).push(row);
      }
    }
    return rows
      .filter((row) => !row.comentario_padre_id)
      .map((root) => toThreadDto(root, repliesByRoot.get(root.id) || [], userId))
      .sort((a, b) => (a.selection.start ?? 0) - (b.selection.start ?? 0));
  }

  /** NUEVO HILO sobre un fragmento seleccionado (propietario o editor). */
  async function createThread(userId, fileId, { content, selectionStart, selectionEnd, quotedText } = {}) {
    const { file, role } = await resolveFile(fileId, userId);
    assertCan(role, PROJECT_ACTIONS.COMMENT, 'Solo el propietario o un editor pueden comentar');
    const text = validateContent(content);
    const { start, end } = validateSelection(selectionStart, selectionEnd);

    const created = await comments.insert({
      archivo_id: file.id,
      usuario_id: userId,
      comentario_padre_id: null,
      seleccion_inicio: start,
      seleccion_fin: end,
      texto_citado: normalizeQuote(quotedText),
      contenido: text,
      esta_resuelto: false
    });
    onCommentsChanged(file.id);
    return toThreadDto(created, [], userId);
  }

  /** RESPONDER en un hilo abierto (propietario o editor). Las respuestas no se anidan. */
  async function reply(userId, threadId, { content } = {}) {
    const { comment: root, file, role } = await resolveComment(threadId, userId);
    assertCan(role, PROJECT_ACTIONS.COMMENT, 'Solo el propietario o un editor pueden responder');
    if (root.comentario_padre_id) throw new ValidationError('Solo se puede responder al comentario principal del hilo');
    if (root.esta_resuelto) throw new ConflictError('El hilo está resuelto. Reábrelo para responder.');

    const created = await comments.insert({
      archivo_id: file.id,
      usuario_id: userId,
      comentario_padre_id: root.id,
      contenido: validateContent(content),
      esta_resuelto: false
    });
    onCommentsChanged(file.id);
    return toReplyDto(created, userId);
  }

  /** EDITAR un comentario propio (solo su autor, y mientras pueda comentar). */
  async function editComment(userId, commentId, { content } = {}) {
    const { comment, file, role } = await resolveComment(commentId, userId);
    if (comment.usuario_id !== userId) throw new ForbiddenError('Solo puedes editar tus propios comentarios');
    assertCan(role, PROJECT_ACTIONS.COMMENT, 'Tu rol actual no permite editar comentarios');

    const updated = await comments.update(comment.id, {
      contenido: validateContent(content),
      actualizado_en: now().toISOString()
    });
    onCommentsChanged(file.id);
    return toReplyDto(updated, userId);
  }

  /** RESOLVER o REABRIR un hilo (propietario o editor). */
  async function setResolved(userId, threadId, resolved) {
    const { comment: root, file, role } = await resolveComment(threadId, userId);
    assertCan(role, PROJECT_ACTIONS.RESOLVE_COMMENTS, 'Solo el propietario o un editor pueden resolver comentarios');
    if (root.comentario_padre_id) throw new ValidationError('Solo se resuelve el hilo completo, no una respuesta');

    await comments.update(root.id, {
      esta_resuelto: resolved,
      resuelto_por: resolved ? userId : null,
      resuelto_en: resolved ? now().toISOString() : null
    });
    onCommentsChanged(file.id);
  }

  /** ELIMINAR un comentario (su autor, o quien puede resolver). Borrar el principal borra el hilo. */
  async function deleteComment(userId, commentId) {
    const { comment, file, role } = await resolveComment(commentId, userId);
    const isAuthor = comment.usuario_id === userId && can(role, PROJECT_ACTIONS.COMMENT);
    if (!isAuthor && !can(role, PROJECT_ACTIONS.RESOLVE_COMMENTS)) {
      throw new ForbiddenError('No puedes eliminar este comentario');
    }
    await comments.deleteThread(comment.id);
    onCommentsChanged(file.id);
  }

  return {
    listThreads,
    createThread,
    reply,
    editComment,
    resolve: (userId, threadId) => setResolved(userId, threadId, true),
    reopen: (userId, threadId) => setResolved(userId, threadId, false),
    deleteComment
  };
}

module.exports = { createCommentService, COMMENT_LIMITS };
