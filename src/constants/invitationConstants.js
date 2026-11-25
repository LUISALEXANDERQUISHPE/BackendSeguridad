/**
 * HU-25: Constantes de las invitaciones a proyectos.
 */
const INVITATION_STATUS = Object.freeze({
  PENDING: 'pendiente',
  ACCEPTED: 'aceptada',
  DECLINED: 'rechazada',
  REVOKED: 'revocada',
  EXPIRED: 'expirada'
});

const INVITATION_LIMITS = Object.freeze({
  // Días que una invitación sigue siendo válida (reenviarla renueva el plazo)
  EXPIRATION_DAYS: 7,
  // Correos por envío: evita usar el formulario para invitar en masa
  MAX_EMAILS_PER_REQUEST: 10,
  // Invitaciones pendientes simultáneas por proyecto
  MAX_PENDING_PER_PROJECT: 50,
  // 32 bytes aleatorios = 256 bits: imposible de adivinar
  TOKEN_BYTES: 32,
  MAX_TOKEN_LENGTH: 128
});

/** Acciones registradas en registros_auditoria. */
const AUDIT_ACTIONS = Object.freeze({
  INVITE: 'invitar',
  RESEND_INVITATION: 'reenviar_invitacion',
  REVOKE_INVITATION: 'revocar_invitacion',
  ACCEPT_INVITATION: 'aceptar_invitacion',
  DECLINE_INVITATION: 'rechazar_invitacion',
  CHANGE_ROLE: 'cambio_rol',
  REMOVE_MEMBER: 'quitar_acceso',
  LEAVE_PROJECT: 'salir_proyecto'
});

module.exports = { INVITATION_STATUS, INVITATION_LIMITS, AUDIT_ACTIONS };
