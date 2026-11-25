const { commentService } = require('../container');

/**
 * Controlador HTTP de los comentarios (HU-25). Solo traduce HTTP <-> servicio.
 */
module.exports = {
  /** GET /api/documents/:id/comments */
  async listThreads(req, res) {
    const threads = await commentService.listThreads(req.user.id, req.params.id);
    res.json({ threads });
  },

  /** POST /api/documents/:id/comments  { content, selectionStart, selectionEnd, quotedText } */
  async createThread(req, res) {
    const thread = await commentService.createThread(req.user.id, req.params.id, req.body);
    res.status(201).json({ thread });
  },

  /** POST /api/comments/:commentId/replies  { content } */
  async reply(req, res) {
    const reply = await commentService.reply(req.user.id, req.params.commentId, req.body);
    res.status(201).json({ reply });
  },

  /** PATCH /api/comments/:commentId  { content } */
  async edit(req, res) {
    const comment = await commentService.editComment(req.user.id, req.params.commentId, req.body);
    res.json({ comment });
  },

  /** POST /api/comments/:commentId/resolve */
  async resolve(req, res) {
    await commentService.resolve(req.user.id, req.params.commentId);
    res.json({ message: 'Hilo resuelto' });
  },

  /** POST /api/comments/:commentId/reopen */
  async reopen(req, res) {
    await commentService.reopen(req.user.id, req.params.commentId);
    res.json({ message: 'Hilo reabierto' });
  },

  /** DELETE /api/comments/:commentId */
  async remove(req, res) {
    await commentService.deleteComment(req.user.id, req.params.commentId);
    res.json({ message: 'Comentario eliminado' });
  }
};
