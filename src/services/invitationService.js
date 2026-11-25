const crypto = require('crypto');
const { ValidationError, ForbiddenError, NotFoundError, ConflictError } = require('../errors/AppError');
const { INVITATION_STATUS, INVITATION_LIMITS, AUDIT_ACTIONS } = require('../constants/invitationConstants');
const { PG_UNIQUE_VIOLATION } = require('../constants/versionConstants');
const { isAssignableRole } = require('../constants/permissions');
const { validateEmail } = require('../validators/projectValidator');
const { isValidUuid } = require('../utils/validators');
const { createProjectAccessService } = require('./projectAccessService');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Token aleatorio para el enlace (se entrega una sola vez) y su hash (lo único que se guarda). */
function generateToken() {
  const token = crypto.randomBytes(INVITATION_LIMITS.TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Acepta "a@x.com, b@y.com" o ["a@x.com", "b@y.com"] y devuelve la lista sin vacíos. */
function parseEmailList(emails) {
  const raw = Array.isArray(emails) ? emails : String(emails ?? '').split(/[,;\s]+/);
  return raw.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);
}

function validateRole(role) {
  if (!isAssignableRole(role)) {
    throw new ValidationError('El rol debe ser "editor" o "lector"');
  }
  return role;
}

function validateInvitationId(invitationId) {
  if (!isValidUuid(invitationId)) throw new ValidationError('Identificador de invitación inválido');
  return invitationId;
}

function validateToken(token) {
  if (typeof token !== 'string' || !token || token.length > INVITATION_LIMITS.MAX_TOKEN_LENGTH) {
    throw new ValidationError('Enlace de invitación inválido');
  }
  return token;
}

const displayName = (user) => user?.nombre_completo || user?.correo || null;

/**
 * HU-25: Invitaciones a proyectos, con el flujo de Overleaf:
 *  1. El propietario invita uno o varios correos con un rol (editor o lector).
 *  2. La invitación queda pendiente; el propietario puede reenviarla o revocarla.
 *  3. La persona la acepta o rechaza desde su panel (aviso en tiempo real) o con el enlace.
 *     Solo la cuenta con el correo invitado puede aceptarla, aunque el enlace se reenvíe.
 *
 * @param {object} deps
 * @param {object} deps.invitations Repositorio de invitaciones
 * @param {object} deps.projects Repositorio de proyectos (acceso, usuarios y miembros)
 * @param {object} deps.audit Registro de auditoría
 * @param {{ notify: Function }} [deps.notifier] Avisos en tiempo real
 * @param {{ warn: Function }} deps.logger
 * @param {() => Date} [deps.now] Reloj (inyectable en pruebas)
 */
function createInvitationService({ invitations, projects, audit, notifier = null, logger, now = () => new Date() }) {
  const access = createProjectAccessService({ repository: projects });

  const expirationDate = () => new Date(now().getTime() + INVITATION_LIMITS.EXPIRATION_DAYS * DAY_MS).toISOString();
  const isExpired = (invitation) => !invitation.expira_en || new Date(invitation.expira_en).getTime() <= now().getTime();

  /** Las operaciones secundarias (avisos, auditoría) nunca deben interrumpir la principal. */
  async function runSafely(description, operation) {
    try {
      await operation();
    } catch (error) {
      logger.warn(`[invitaciones] No se pudo ${description}:`, error.message);
    }
  }

  function record(entry) {
    return runSafely('registrar la auditoría', () => audit.record(entry));
  }

  function notify(userId, payload) {
    if (notifier && userId) notifier.notify(userId, payload);
  }

  /** Vista de la invitación para el propietario (el token solo viaja al crearla o reenviarla). */
  function toOwnerDto(invitation, token = null) {
    return {
      id: invitation.id,
      email: invitation.correo,
      role: invitation.rol,
      status: invitation.estado,
      invitedBy: displayName(invitation.creador),
      createdAt: invitation.creado_en,
      expiresAt: invitation.expira_en,
      ...(token ? { token } : {})
    };
  }

  /** Vista de la invitación para quien la recibe. */
  function toInviteeDto(invitation) {
    return {
      id: invitation.id,
      projectId: invitation.proyecto?.id || invitation.proyecto_id,
      projectName: invitation.proyecto?.nombre || null,
      role: invitation.rol,
      invitedBy: displayName(invitation.creador),
      createdAt: invitation.creado_en,
      expiresAt: invitation.expira_en
    };
  }

  /** Marca como expirada una invitación vencida (perezoso: al consultarla). */
  async function expireIfNeeded(invitation) {
    if (invitation.estado !== INVITATION_STATUS.PENDING || !isExpired(invitation)) return false;
    await runSafely('marcar una invitación como expirada', () =>
      invitations.update(invitation.id, { estado: INVITATION_STATUS.EXPIRED })
    );
    return true;
  }

  async function loadOwnedInvitation(ownerId, projectId, invitationId) {
    const { project } = await access.resolveAsOwner(projectId, ownerId, 'gestionar las invitaciones de');
    validateInvitationId(invitationId);
    const invitation = await invitations.findById(invitationId);
    if (!invitation || invitation.proyecto_id !== project.id) {
      throw new NotFoundError('Invitación no encontrada');
    }
    return { project, invitation };
  }

  // ---------- Propietario ----------

  /**
   * INVITAR uno o varios correos con un rol. Los correos registrados reciben el aviso al instante;
   * los no registrados verán la invitación al crear su cuenta con ese correo.
   * @returns {Promise<{ invitations: object[], skipped: Array<{ email: string, reason: string }> }>}
   */
  async function invite(ownerId, projectId, { emails, role } = {}, context = {}) {
    const { project } = await access.resolveAsOwner(projectId, ownerId, 'compartir');
    validateRole(role);

    const requested = [...new Set(parseEmailList(emails).map((email) => email.toLowerCase()))];
    if (requested.length === 0) throw new ValidationError('Escribe al menos un correo electrónico');
    if (requested.length > INVITATION_LIMITS.MAX_EMAILS_PER_REQUEST) {
      throw new ValidationError(`Puedes invitar hasta ${INVITATION_LIMITS.MAX_EMAILS_PER_REQUEST} correos a la vez`);
    }

    const skipped = [];
    const valid = [];
    for (const email of requested) {
      try {
        valid.push(validateEmail(email));
      } catch {
        skipped.push({ email, reason: 'Correo inválido' });
      }
    }

    const pendingCount = await invitations.countPendingByProject(project.id);
    if (pendingCount + valid.length > INVITATION_LIMITS.MAX_PENDING_PER_PROJECT) {
      throw new ConflictError(`El proyecto ya tiene demasiadas invitaciones pendientes (máximo ${INVITATION_LIMITS.MAX_PENDING_PER_PROJECT}). Revoca alguna antes de invitar.`);
    }

    const owner = await projects.findUserById(ownerId);
    const created = [];

    for (const email of valid) {
      if (owner && owner.correo?.toLowerCase() === email) {
        skipped.push({ email, reason: 'Eres el propietario del proyecto' });
        continue;
      }
      const invitee = await projects.findUserByEmail(email);
      if (invitee && (invitee.id === project.propietario_id || await projects.findMemberRole(project.id, invitee.id))) {
        skipped.push({ email, reason: 'Ya tiene acceso al proyecto' });
        continue;
      }

      const { token, tokenHash } = generateToken();
      const fields = { rol: role, token: tokenHash, creado_por: ownerId, expira_en: expirationDate() };
      const existing = await invitations.findPendingByProjectAndEmail(project.id, email);
      // Reinvitar a alguien con una invitación pendiente la renueva (nuevo rol, enlace y plazo)
      const invitation = existing
        ? await invitations.update(existing.id, fields)
        : await invitations.insert({ ...fields, proyecto_id: project.id, correo: email, estado: INVITATION_STATUS.PENDING });

      created.push(toOwnerDto({ ...invitation, creador: owner }, token));

      notify(invitee?.id, {
        type: 'invitation-received',
        invitationId: invitation.id,
        projectId: project.id,
        projectName: project.nombre,
        invitedBy: displayName(owner),
        role
      });
      await record({
        userId: ownerId,
        projectId: project.id,
        action: AUDIT_ACTIONS.INVITE,
        entityType: 'invitacion',
        entityId: invitation.id,
        ip: context.ip,
        metadata: { correo: email, rol: role, renovada: Boolean(existing) }
      });
    }

    return { invitations: created, skipped };
  }

  /** LISTAR invitaciones pendientes del proyecto (solo el propietario). Las vencidas se marcan expiradas. */
  async function listProjectInvitations(ownerId, projectId) {
    const { project } = await access.resolveAsOwner(projectId, ownerId, 'gestionar las invitaciones de');
    const pending = await invitations.findPendingByProject(project.id);
    const active = [];
    for (const invitation of pending) {
      if (!(await expireIfNeeded(invitation))) active.push(toOwnerDto(invitation));
    }
    return active;
  }

  /** REENVIAR: nuevo enlace (el anterior deja de funcionar) y nuevo plazo de vencimiento. */
  async function resend(ownerId, projectId, invitationId, context = {}) {
    const { project, invitation } = await loadOwnedInvitation(ownerId, projectId, invitationId);
    if (invitation.estado !== INVITATION_STATUS.PENDING && invitation.estado !== INVITATION_STATUS.EXPIRED) {
      throw new ConflictError('Solo se pueden reenviar invitaciones pendientes o expiradas');
    }

    const { token, tokenHash } = generateToken();
    let updated;
    try {
      updated = await invitations.update(invitation.id, {
        token: tokenHash,
        estado: INVITATION_STATUS.PENDING,
        expira_en: expirationDate()
      });
    } catch (error) {
      // Una invitación expirada no puede reactivarse si ya hay otra pendiente para ese correo
      if (error?.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError('Ya existe una invitación pendiente para ese correo');
      }
      throw error;
    }

    const [owner, invitee] = await Promise.all([
      projects.findUserById(ownerId),
      projects.findUserByEmail(invitation.correo)
    ]);
    notify(invitee?.id, {
      type: 'invitation-received',
      invitationId: invitation.id,
      projectId: project.id,
      projectName: project.nombre,
      invitedBy: displayName(owner),
      role: invitation.rol
    });
    await record({
      userId: ownerId,
      projectId: project.id,
      action: AUDIT_ACTIONS.RESEND_INVITATION,
      entityType: 'invitacion',
      entityId: invitation.id,
      ip: context.ip,
      metadata: { correo: invitation.correo }
    });
    return toOwnerDto({ ...updated, creador: owner }, token);
  }

  /** REVOCAR una invitación pendiente: el enlace deja de funcionar. */
  async function revoke(ownerId, projectId, invitationId, context = {}) {
    const { project, invitation } = await loadOwnedInvitation(ownerId, projectId, invitationId);
    if (invitation.estado !== INVITATION_STATUS.PENDING) {
      throw new ConflictError('La invitación ya no está pendiente');
    }
    await invitations.update(invitation.id, { estado: INVITATION_STATUS.REVOKED });

    const invitee = await projects.findUserByEmail(invitation.correo);
    notify(invitee?.id, { type: 'invitation-revoked', invitationId: invitation.id, projectId: project.id });
    await record({
      userId: ownerId,
      projectId: project.id,
      action: AUDIT_ACTIONS.REVOKE_INVITATION,
      entityType: 'invitacion',
      entityId: invitation.id,
      ip: context.ip,
      metadata: { correo: invitation.correo }
    });
  }

  // ---------- Invitado ----------

  async function currentUserEmail(userId) {
    const user = await projects.findUserById(userId);
    if (!user?.correo) throw new ForbiddenError('No se encontró tu perfil de usuario');
    return { user, email: user.correo.toLowerCase() };
  }

  /** BANDEJA: invitaciones pendientes dirigidas al correo del usuario. */
  async function listMyInvitations(userId) {
    const { email } = await currentUserEmail(userId);
    const pending = await invitations.findPendingByEmail(email);
    const active = [];
    for (const invitation of pending) {
      if (!(await expireIfNeeded(invitation))) active.push(toInviteeDto(invitation));
    }
    return active;
  }

  /**
   * Comprueba que la invitación siga pendiente, no haya vencido y sea para el correo del usuario.
   * Los mensajes no revelan a qué correo se envió (el enlace pudo llegar a otra persona).
   */
  async function assertCanRespond(invitation, userId) {
    if (!invitation) throw new NotFoundError('La invitación no existe o ya no es válida');
    if (invitation.estado === INVITATION_STATUS.ACCEPTED) throw new ConflictError('Esta invitación ya fue aceptada');
    if (invitation.estado !== INVITATION_STATUS.PENDING) {
      throw new ConflictError('Esta invitación ya no es válida. Pide al propietario que te invite de nuevo.');
    }
    if (await expireIfNeeded(invitation)) {
      throw new ConflictError('La invitación expiró. Pide al propietario que la reenvíe.');
    }
    const { user, email } = await currentUserEmail(userId);
    if (invitation.correo !== email) {
      throw new ForbiddenError('Esta invitación fue enviada a otro correo. Inicia sesión con la cuenta invitada.');
    }
    return user;
  }

  async function acceptInvitation(invitation, userId, context) {
    const user = await assertCanRespond(invitation, userId);
    const project = invitation.proyecto || await projects.findById(invitation.proyecto_id);
    if (!project) throw new NotFoundError('El proyecto ya no existe');

    const alreadyMember = project.propietario_id === userId || await projects.findMemberRole(project.id, userId);
    if (!alreadyMember) {
      try {
        await projects.addMember(project.id, userId, invitation.rol, invitation.creado_por);
      } catch (error) {
        // Dos aceptaciones simultáneas: la restricción única (proyecto, usuario) evita el duplicado
        if (error?.code !== PG_UNIQUE_VIOLATION) throw error;
      }
    }

    await invitations.update(invitation.id, { estado: INVITATION_STATUS.ACCEPTED, respondido_en: now().toISOString() });

    notify(project.propietario_id, {
      type: 'invitation-accepted',
      invitationId: invitation.id,
      projectId: project.id,
      projectName: project.nombre,
      acceptedBy: displayName(user),
      role: invitation.rol
    });
    await record({
      userId,
      projectId: project.id,
      action: AUDIT_ACTIONS.ACCEPT_INVITATION,
      entityType: 'invitacion',
      entityId: invitation.id,
      ip: context.ip,
      metadata: { rol: invitation.rol }
    });
    return { projectId: project.id, projectName: project.nombre, role: invitation.rol };
  }

  /** ACEPTAR desde la bandeja de la app. */
  async function acceptById(userId, invitationId, context = {}) {
    validateInvitationId(invitationId);
    return acceptInvitation(await invitations.findById(invitationId), userId, context);
  }

  /** ACEPTAR con el enlace (el token llega en el cuerpo, no en la URL, para no quedar en logs). */
  async function acceptByToken(userId, token, context = {}) {
    validateToken(token);
    return acceptInvitation(await invitations.findByTokenHash(hashToken(token)), userId, context);
  }

  /** VISTA PREVIA del enlace: qué proyecto y con qué rol, antes de aceptar. */
  async function previewByToken(userId, token) {
    validateToken(token);
    const invitation = await invitations.findByTokenHash(hashToken(token));
    await assertCanRespond(invitation, userId);
    return toInviteeDto(invitation);
  }

  /** RECHAZAR una invitación propia. */
  async function decline(userId, invitationId, context = {}) {
    validateInvitationId(invitationId);
    const invitation = await invitations.findById(invitationId);
    const user = await assertCanRespond(invitation, userId);
    await invitations.update(invitation.id, { estado: INVITATION_STATUS.DECLINED, respondido_en: now().toISOString() });

    notify(invitation.proyecto?.propietario_id, {
      type: 'invitation-declined',
      invitationId: invitation.id,
      projectId: invitation.proyecto_id,
      projectName: invitation.proyecto?.nombre || null,
      declinedBy: displayName(user)
    });
    await record({
      userId,
      projectId: invitation.proyecto_id,
      action: AUDIT_ACTIONS.DECLINE_INVITATION,
      entityType: 'invitacion',
      entityId: invitation.id,
      ip: context.ip
    });
  }

  return {
    invite,
    listProjectInvitations,
    resend,
    revoke,
    listMyInvitations,
    acceptById,
    acceptByToken,
    previewByToken,
    decline
  };
}

module.exports = { createInvitationService, hashToken, parseEmailList };
