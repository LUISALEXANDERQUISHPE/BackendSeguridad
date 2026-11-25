const { invitationService } = require('../container');

/**
 * Controlador HTTP de la HU-25 (invitaciones). Solo traduce HTTP <-> servicio;
 * Express 5 propaga al middleware de errores cualquier promesa rechazada.
 */
const context = (req) => ({ ip: req.ip || null });

module.exports = {
  // ---------- Propietario: /api/projects/:id/invitations ----------

  /** POST /api/projects/:id/invitations  { emails: string|string[], role: 'editor'|'lector' } */
  async invite(req, res) {
    const result = await invitationService.invite(req.user.id, req.params.id, req.body, context(req));
    res.status(201).json(result);
  },

  /** GET /api/projects/:id/invitations */
  async listProjectInvitations(req, res) {
    const invitations = await invitationService.listProjectInvitations(req.user.id, req.params.id);
    res.json({ invitations });
  },

  /** POST /api/projects/:id/invitations/:invitationId/resend */
  async resend(req, res) {
    const invitation = await invitationService.resend(req.user.id, req.params.id, req.params.invitationId, context(req));
    res.json({ message: 'Invitación reenviada', invitation });
  },

  /** DELETE /api/projects/:id/invitations/:invitationId */
  async revoke(req, res) {
    await invitationService.revoke(req.user.id, req.params.id, req.params.invitationId, context(req));
    res.json({ message: 'Invitación revocada' });
  },

  // ---------- Invitado: /api/invitations ----------

  /** GET /api/invitations */
  async listMine(req, res) {
    const invitations = await invitationService.listMyInvitations(req.user.id);
    res.json({ invitations });
  },

  /** POST /api/invitations/:invitationId/accept */
  async accept(req, res) {
    const result = await invitationService.acceptById(req.user.id, req.params.invitationId, context(req));
    res.json({ message: 'Invitación aceptada', ...result });
  },

  /** POST /api/invitations/:invitationId/decline */
  async decline(req, res) {
    await invitationService.decline(req.user.id, req.params.invitationId, context(req));
    res.json({ message: 'Invitación rechazada' });
  },

  /** POST /api/invitations/token/preview  { token } */
  async previewByToken(req, res) {
    const invitation = await invitationService.previewByToken(req.user.id, req.body?.token);
    res.json({ invitation });
  },

  /** POST /api/invitations/token/accept  { token } */
  async acceptByToken(req, res) {
    const result = await invitationService.acceptByToken(req.user.id, req.body?.token, context(req));
    res.json({ message: 'Invitación aceptada', ...result });
  }
};
