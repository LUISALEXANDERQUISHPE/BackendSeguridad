const test = require('node:test');
const assert = require('node:assert/strict');
const { createUserNotifier } = require('../../src/realtime/userNotifier');
const { createProjectService } = require('../../src/services/projectService');

const fakeSocket = () => {
  const received = [];
  return { received, send: (data) => received.push(JSON.parse(data)) };
};

test('el aviso llega a todas las conexiones del usuario y solo a él', () => {
  const notifier = createUserNotifier({ logger: { warn() {} } });
  const tab1 = fakeSocket();
  const tab2 = fakeSocket();
  const other = fakeSocket();
  notifier.subscribe('ana', tab1);
  notifier.subscribe('ana', tab2);
  notifier.subscribe('luis', other);

  assert.equal(notifier.notify('ana', { type: 'project-shared' }), 2);
  assert.equal(tab1.received.length, 1);
  assert.equal(tab2.received.length, 1);
  assert.equal(other.received.length, 0);

  notifier.unsubscribe('ana', tab1);
  notifier.unsubscribe('ana', tab2);
  assert.equal(notifier.notify('ana', { type: 'project-shared' }), 0);
});

test('compartir un proyecto avisa en tiempo real al invitado', async () => {
  const project = { id: '11111111-1111-4111-8111-111111111111', nombre: 'Tesis', propietario_id: 'owner' };
  const members = [];
  const repository = {
    findById: async () => project,
    findMemberRole: async (_projectId, userId) => (members.includes(userId) ? 'editor' : null),
    findUserByEmail: async () => ({ id: 'invitee', nombre_completo: 'Luis', correo: 'luis@correo.com' }),
    findUserById: async () => ({ id: 'owner', nombre_completo: 'Ana', correo: 'ana@correo.com' }),
    addMember: async (_projectId, userId) => { members.push(userId); }
  };
  const notifications = [];
  const service = createProjectService({
    repository,
    storage: {},
    compiledFiles: {},
    logger: { warn() {} },
    notifier: { notify: (userId, payload) => notifications.push({ userId, payload }) }
  });

  const member = await service.shareProject('owner', project.id, { email: 'Luis@Correo.com' });

  assert.equal(member.role, 'editor');
  assert.deepEqual(notifications, [{
    userId: 'invitee',
    payload: { type: 'project-shared', projectId: project.id, projectName: 'Tesis', sharedBy: 'Ana' }
  }]);
  await assert.rejects(service.shareProject('owner', project.id, { email: 'luis@correo.com' }), /ya colabora/);
});
