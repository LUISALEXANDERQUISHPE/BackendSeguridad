const { memberService } = require('../container');

/**
 * Controlador HTTP de la HU-25 (administrar acceso). Solo traduce HTTP <-> servicio.
 */
const context = (req) => ({ ip: req.ip || null });

module.exports = {
  /** PATCH /api/projects/:id/members/:userId  { role: 'editor'|'lector' } */
  async changeRole(req, res) {
    const member = await memberService.changeRole(req.user.id, req.params.id, req.params.userId, req.body, context(req));
    res.json({ message: 'Permiso actualizado', member });
  },

  /** DELETE /api/projects/:id/members/:userId */
  async removeMember(req, res) {
    await memberService.removeMember(req.user.id, req.params.id, req.params.userId, context(req));
    res.json({ message: 'Acceso retirado' });
  },

  /** DELETE /api/projects/:id/members/me */
  async leaveProject(req, res) {
    await memberService.leaveProject(req.user.id, req.params.id, context(req));
    res.json({ message: 'Saliste del proyecto' });
  }
};
