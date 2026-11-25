const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemberService } = require('../../src/services/memberService');

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LUIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MARTA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRANGER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function setup() {
  const project = { id: PROJECT_ID, nombre: 'Tesis', propietario_id: OWNER };
  const members = new Map([[LUIS, 'editor'], [MARTA, 'lector']]);
  const accessChanges = [];
  const notifications = [];
  const auditLog = [];

  const projects = {
    findById: async (id) => (id === PROJECT_ID ? project : null),
    findMemberRole: async (_projectId, userId) => members.get(userId) || null,
    findUserById: async (id) => ({ id, nombre_completo: id === MARTA ? 'Marta' : 'Otro', correo: 'x@correo.com' }),
    updateMemberRole: async (_projectId, userId, role) => {
      if (!members.has(userId)) return null;
      members.set(userId, role);
      return { usuario_id: userId, rol: role };
    },
    removeMember: async (_projectId, userId) => members.delete(userId)
  };

  const service = createMemberService({
    projects,
    audit: { record: async (entry) => auditLog.push(entry) },
    notifier: { notify: (userId, payload) => notifications.push({ userId, payload }) },
    onAccessChanged: (change) => accessChanges.push(change),
    logger: { warn() {} }
  });
  return { service, members, accessChanges, notifications, auditLog };
}

test('el propietario cambia un editor a lector: se aplica en caliente, se avisa y se audita', async () => {
  const { service, members, accessChanges, notifications, auditLog } = setup();

  const result = await service.changeRole(OWNER, PROJECT_ID, LUIS, { role: 'lector' }, { ip: '10.0.0.9' });

  assert.deepEqual(result, { userId: LUIS, role: 'lector' });
  assert.equal(members.get(LUIS), 'lector');
  assert.deepEqual(accessChanges, [{ projectId: PROJECT_ID, userId: LUIS, role: 'lector' }]);
  assert.deepEqual(notifications[0], {
    userId: LUIS,
    payload: { type: 'access-changed', projectId: PROJECT_ID, projectName: 'Tesis', role: 'lector' }
  });
  assert.equal(auditLog[0].action, 'cambio_rol');
  assert.deepEqual(auditLog[0].metadata, { antes: 'editor', despues: 'lector' });
  assert.equal(auditLog[0].ip, '10.0.0.9');
});

test('asignar el mismo rol no genera avisos ni auditoría', async () => {
  const { service, accessChanges, notifications, auditLog } = setup();
  await service.changeRole(OWNER, PROJECT_ID, LUIS, { role: 'editor' });
  assert.equal(accessChanges.length + notifications.length + auditLog.length, 0);
});

test('solo se pueden asignar los roles editor y lector', async () => {
  const { service, members } = setup();
  for (const role of ['propietario', 'revisor', 'invitado', 'admin', undefined]) {
    await assert.rejects(service.changeRole(OWNER, PROJECT_ID, LUIS, { role }), /editor.*lector/);
  }
  assert.equal(members.get(LUIS), 'editor');
});

test('SEGURIDAD: un editor o un lector no pueden cambiar roles ni quitar accesos', async () => {
  const { service, members } = setup();
  await assert.rejects(service.changeRole(LUIS, PROJECT_ID, MARTA, { role: 'editor' }), /Solo el propietario/);
  await assert.rejects(service.removeMember(MARTA, PROJECT_ID, LUIS), /Solo el propietario/);
  await assert.rejects(service.changeRole(STRANGER, PROJECT_ID, LUIS, { role: 'lector' }), /No tienes permisos/);
  assert.equal(members.get(MARTA), 'lector');
  assert.equal(members.get(LUIS), 'editor');
});

test('SEGURIDAD: nadie puede cambiar el acceso del propietario', async () => {
  const { service } = setup();
  await assert.rejects(service.changeRole(OWNER, PROJECT_ID, OWNER, { role: 'lector' }), /propietario/);
  await assert.rejects(service.removeMember(OWNER, PROJECT_ID, OWNER), /propietario/);
});

test('no se puede gestionar a alguien que no colabora o con un id inválido', async () => {
  const { service } = setup();
  await assert.rejects(service.changeRole(OWNER, PROJECT_ID, STRANGER, { role: 'lector' }), /no colabora/);
  await assert.rejects(service.removeMember(OWNER, PROJECT_ID, 'no-es-uuid'), /inválido/);
});

test('quitar el acceso desconecta al usuario de los editores abiertos y le avisa', async () => {
  const { service, members, accessChanges, notifications, auditLog } = setup();

  await service.removeMember(OWNER, PROJECT_ID, LUIS);

  assert.equal(members.has(LUIS), false);
  assert.deepEqual(accessChanges, [{ projectId: PROJECT_ID, userId: LUIS, role: null }]);
  assert.equal(notifications[0].payload.type, 'access-removed');
  assert.equal(auditLog[0].action, 'quitar_acceso');
  await assert.rejects(service.removeMember(OWNER, PROJECT_ID, LUIS), /no colabora/);
});

test('un colaborador puede salir del proyecto; el propietario recibe el aviso', async () => {
  const { service, members, accessChanges, notifications, auditLog } = setup();

  await service.leaveProject(MARTA, PROJECT_ID);

  assert.equal(members.has(MARTA), false);
  assert.deepEqual(accessChanges, [{ projectId: PROJECT_ID, userId: MARTA, role: null }]);
  assert.deepEqual(notifications[0], {
    userId: OWNER,
    payload: { type: 'member-left', projectId: PROJECT_ID, projectName: 'Tesis', userName: 'Marta' }
  });
  assert.equal(auditLog[0].action, 'salir_proyecto');
});

test('el propietario no puede salir de su proyecto y un extraño no puede "salir" de lo que no es suyo', async () => {
  const { service } = setup();
  await assert.rejects(service.leaveProject(OWNER, PROJECT_ID), /propietario no puede salir/);
  await assert.rejects(service.leaveProject(STRANGER, PROJECT_ID), /No tienes permisos/);
});
