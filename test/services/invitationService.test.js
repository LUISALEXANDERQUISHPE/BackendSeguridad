const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createInvitationService, hashToken, parseEmailList } = require('../../src/services/invitationService');

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DAY_MS = 24 * 60 * 60 * 1000;

const USERS = {
  owner: { id: 'owner', nombre_completo: 'Ana Dueña', correo: 'ana@correo.com' },
  luis: { id: 'luis', nombre_completo: 'Luis', correo: 'luis@correo.com' },
  marta: { id: 'marta', nombre_completo: 'Marta', correo: 'marta@correo.com' },
  intruso: { id: 'intruso', nombre_completo: 'Intruso', correo: 'intruso@correo.com' }
};

/** Base de datos en memoria con el mismo comportamiento que los repositorios reales. */
function setup() {
  let clock = new Date('2026-11-25T12:00:00.000Z');
  const project = { id: PROJECT_ID, nombre: 'Tesis', propietario_id: 'owner' };
  const members = new Map(); // userId -> rol
  const rows = [];
  const notifications = [];
  const auditLog = [];

  const withRelations = (row) => row && {
    ...row,
    creador: Object.values(USERS).find((user) => user.id === row.creado_por),
    proyecto: project
  };

  const invitations = {
    insert: async (data) => {
      const row = { id: crypto.randomUUID(), creado_en: clock.toISOString(), respondido_en: null, ...data };
      rows.push(row);
      return { ...row };
    },
    update: async (id, changes) => {
      const row = rows.find((item) => item.id === id);
      Object.assign(row, changes);
      return { ...row };
    },
    findById: async (id) => withRelations(rows.find((row) => row.id === id)),
    findByTokenHash: async (hash) => withRelations(rows.find((row) => row.token === hash)),
    findPendingByProject: async (projectId) =>
      rows.filter((row) => row.proyecto_id === projectId && row.estado === 'pendiente').map(withRelations),
    findPendingByProjectAndEmail: async (projectId, email) =>
      rows.find((row) => row.proyecto_id === projectId && row.correo === email && row.estado === 'pendiente') || null,
    findPendingByEmail: async (email) =>
      rows.filter((row) => row.correo === email && row.estado === 'pendiente').map(withRelations),
    countPendingByProject: async (projectId) =>
      rows.filter((row) => row.proyecto_id === projectId && row.estado === 'pendiente').length
  };

  const projects = {
    findById: async (id) => (id === PROJECT_ID ? project : null),
    findMemberRole: async (_projectId, userId) => members.get(userId) || null,
    findUserById: async (id) => Object.values(USERS).find((user) => user.id === id) || null,
    findUserByEmail: async (email) => Object.values(USERS).find((user) => user.correo === email.toLowerCase()) || null,
    addMember: async (_projectId, userId, role) => {
      if (members.has(userId)) throw Object.assign(new Error('duplicado'), { code: '23505' });
      members.set(userId, role);
    }
  };

  const service = createInvitationService({
    invitations,
    projects,
    audit: { record: async (entry) => auditLog.push(entry) },
    notifier: { notify: (userId, payload) => notifications.push({ userId, payload }) },
    logger: { warn() {} },
    now: () => clock
  });

  return {
    service, rows, members, notifications, auditLog,
    advanceDays: (days) => { clock = new Date(clock.getTime() + days * DAY_MS); }
  };
}

test('invita varios correos con un rol: quedan pendientes y el invitado aún NO es miembro', async () => {
  const { service, rows, members, notifications, auditLog } = setup();

  const result = await service.invite('owner', PROJECT_ID, { emails: 'Luis@Correo.com, nuevo@correo.com', role: 'lector' }, { ip: '10.0.0.1' });

  assert.equal(result.invitations.length, 2);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.invitations.map((inv) => [inv.email, inv.role, inv.status]), [
    ['luis@correo.com', 'lector', 'pendiente'],
    ['nuevo@correo.com', 'lector', 'pendiente']
  ]);
  assert.equal(members.size, 0, 'nadie entra al proyecto sin aceptar');
  // Solo el usuario registrado recibe el aviso en tiempo real
  assert.deepEqual(notifications.map((n) => [n.userId, n.payload.type]), [['luis', 'invitation-received']]);
  assert.equal(auditLog.length, 2);
  assert.equal(auditLog[0].action, 'invitar');
  assert.equal(auditLog[0].ip, '10.0.0.1');
  // Vence en 7 días
  assert.equal(rows[0].expira_en, '2026-12-02T12:00:00.000Z');
});

test('el token solo se entrega al crearla y en la base de datos se guarda únicamente su hash', async () => {
  const { service, rows } = setup();
  const { invitations: [created] } = await service.invite('owner', PROJECT_ID, { emails: ['luis@correo.com'], role: 'editor' });

  assert.ok(created.token.length >= 40);
  assert.equal(rows[0].token, hashToken(created.token));
  assert.notEqual(rows[0].token, created.token);

  const listed = await service.listProjectInvitations('owner', PROJECT_ID);
  assert.equal(listed[0].token, undefined, 'el listado nunca vuelve a mostrar el token');
});

test('omite correos inválidos, al propietario y a quien ya es miembro; rechaza roles no asignables', async () => {
  const { service, members } = setup();
  members.set('marta', 'editor');

  const result = await service.invite('owner', PROJECT_ID, {
    emails: ['no-es-correo', 'ana@correo.com', 'marta@correo.com', 'luis@correo.com', 'LUIS@correo.com'],
    role: 'editor'
  });
  assert.deepEqual(result.invitations.map((inv) => inv.email), ['luis@correo.com']);
  assert.deepEqual(result.skipped.map((item) => item.email).sort(), ['ana@correo.com', 'marta@correo.com', 'no-es-correo']);

  for (const role of ['propietario', 'revisor', 'admin', undefined]) {
    await assert.rejects(service.invite('owner', PROJECT_ID, { emails: 'x@correo.com', role }), /editor.*lector/);
  }
});

test('solo el propietario puede invitar, listar, reenviar o revocar', async () => {
  const { service, members } = setup();
  members.set('luis', 'editor');
  await assert.rejects(service.invite('luis', PROJECT_ID, { emails: 'x@correo.com', role: 'lector' }), /Solo el propietario/);
  await assert.rejects(service.listProjectInvitations('luis', PROJECT_ID), /Solo el propietario/);
  await assert.rejects(service.invite('intruso', PROJECT_ID, { emails: 'x@correo.com', role: 'lector' }), /No tienes permisos/);
});

test('limita la cantidad de correos por envío', async () => {
  const { service } = setup();
  const emails = Array.from({ length: 11 }, (_, i) => `u${i}@correo.com`);
  await assert.rejects(service.invite('owner', PROJECT_ID, { emails, role: 'lector' }), /hasta 10/);
  await assert.rejects(service.invite('owner', PROJECT_ID, { emails: '  ', role: 'lector' }), /al menos un correo/);
});

test('reinvitar a alguien pendiente renueva la misma invitación (nuevo rol, nuevo enlace)', async () => {
  const { service, rows } = setup();
  const first = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'lector' });
  const second = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'editor' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].rol, 'editor');
  assert.equal(first.invitations[0].id, second.invitations[0].id);
  assert.notEqual(first.invitations[0].token, second.invitations[0].token);
  assert.equal(rows[0].token, hashToken(second.invitations[0].token));
});

test('el invitado ve su bandeja y al aceptar entra con el rol de la invitación', async () => {
  const { service, members, notifications, rows } = setup();
  await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'lector' });

  const inbox = await service.listMyInvitations('luis');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].projectName, 'Tesis');
  assert.equal(inbox[0].invitedBy, 'Ana Dueña');

  const result = await service.acceptById('luis', inbox[0].id);
  assert.deepEqual(result, { projectId: PROJECT_ID, projectName: 'Tesis', role: 'lector' });
  assert.equal(members.get('luis'), 'lector');
  assert.equal(rows[0].estado, 'aceptada');
  assert.ok(rows[0].respondido_en);
  assert.equal(notifications.at(-1).userId, 'owner');
  assert.equal(notifications.at(-1).payload.type, 'invitation-accepted');

  // No se puede usar dos veces
  await assert.rejects(service.acceptById('luis', inbox[0].id), /ya fue aceptada/);
  assert.deepEqual(await service.listMyInvitations('luis'), []);
});

test('SEGURIDAD: otra cuenta no puede aceptar la invitación aunque tenga el enlace o el id', async () => {
  const { service, members } = setup();
  const { invitations: [invitation] } = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'editor' });

  await assert.rejects(service.acceptByToken('intruso', invitation.token), /otro correo/);
  await assert.rejects(service.acceptById('intruso', invitation.id), /otro correo/);
  await assert.rejects(service.previewByToken('intruso', invitation.token), /otro correo/);
  assert.equal(members.has('intruso'), false);

  // La cuenta correcta sí puede, con el enlace
  const preview = await service.previewByToken('luis', invitation.token);
  assert.equal(preview.role, 'editor');
  await service.acceptByToken('luis', invitation.token);
  assert.equal(members.get('luis'), 'editor');
});

test('SEGURIDAD: un token inventado o manipulado no sirve', async () => {
  const { service } = setup();
  const { invitations: [invitation] } = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'editor' });

  await assert.rejects(service.acceptByToken('luis', `${invitation.token}x`), /no existe/);
  await assert.rejects(service.acceptByToken('luis', hashToken(invitation.token)), /no existe/, 'el hash guardado no funciona como token');
  await assert.rejects(service.acceptByToken('luis', ''), /inválido/);
  await assert.rejects(service.acceptByToken('luis', 'a'.repeat(500)), /inválido/);
  await assert.rejects(service.acceptById('luis', 'no-es-uuid'), /inválido/);
});

test('una invitación vencida no se puede aceptar y desaparece de las listas; reenviarla la reactiva', async () => {
  const { service, rows, members, advanceDays } = setup();
  const { invitations: [invitation] } = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'lector' });

  // A los 6 días sigue válida
  advanceDays(6);
  assert.equal((await service.listMyInvitations('luis')).length, 1);

  // A los 8 días ya venció
  advanceDays(2);
  await assert.rejects(service.acceptByToken('luis', invitation.token), /expiró/);
  assert.equal(rows[0].estado, 'expirada');
  assert.deepEqual(await service.listMyInvitations('luis'), []);
  assert.deepEqual(await service.listProjectInvitations('owner', PROJECT_ID), []);
  assert.equal(members.has('luis'), false);

  // El propietario la reenvía: nuevo enlace, el anterior ya no sirve
  const resent = await service.resend('owner', PROJECT_ID, invitation.id);
  assert.equal(rows[0].estado, 'pendiente');
  await assert.rejects(service.acceptByToken('luis', invitation.token), /no existe/);
  await service.acceptByToken('luis', resent.token);
  assert.equal(members.get('luis'), 'lector');
});

test('revocar invalida el enlace y avisa al invitado', async () => {
  const { service, rows, notifications, auditLog } = setup();
  const { invitations: [invitation] } = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'editor' });

  await service.revoke('owner', PROJECT_ID, invitation.id);
  assert.equal(rows[0].estado, 'revocada');
  assert.equal(notifications.at(-1).payload.type, 'invitation-revoked');
  assert.equal(auditLog.at(-1).action, 'revocar_invitacion');
  await assert.rejects(service.acceptByToken('luis', invitation.token), /ya no es válida/);
  await assert.rejects(service.revoke('owner', PROJECT_ID, invitation.id), /ya no está pendiente/);
});

test('rechazar marca la invitación y avisa al propietario', async () => {
  const { service, rows, members, notifications } = setup();
  const { invitations: [invitation] } = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'editor' });

  await assert.rejects(service.decline('intruso', invitation.id), /otro correo/);
  await service.decline('luis', invitation.id);
  assert.equal(rows[0].estado, 'rechazada');
  assert.equal(members.has('luis'), false);
  assert.equal(notifications.at(-1).userId, 'owner');
  assert.equal(notifications.at(-1).payload.type, 'invitation-declined');
});

test('no se puede gestionar la invitación de otro proyecto con el id de este', async () => {
  const { service } = setup();
  const { invitations: [invitation] } = await service.invite('owner', PROJECT_ID, { emails: 'luis@correo.com', role: 'editor' });
  const otherProject = '22222222-2222-4222-8222-222222222222';
  await assert.rejects(service.revoke('owner', otherProject, invitation.id), /no encontrado|Proyecto/i);
});

test('parseEmailList acepta texto separado por comas, punto y coma o espacios, y arreglos', () => {
  assert.deepEqual(parseEmailList('a@x.com, b@x.com;c@x.com  d@x.com'), ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  assert.deepEqual(parseEmailList([' a@x.com ', '', 5]), ['a@x.com']);
  assert.deepEqual(parseEmailList(undefined), []);
});
