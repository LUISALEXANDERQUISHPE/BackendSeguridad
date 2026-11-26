const test = require('node:test');
const assert = require('node:assert/strict');
const { createProjectService } = require('../../src/services/projectService');

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function createService({ searchResult = [] } = {}) {
  const calls = [];
  const repository = {
    findById: async () => ({ id: PROJECT_ID, nombre: 'Tesis', propietario_id: 'owner' }),
    findMemberRole: async (_projectId, userId) => (userId === 'editor-1' ? 'editor' : null),
    findMembers: async () => [{ usuario_id: 'editor-1' }],
    searchUsersByEmailPrefix: async (prefix, options) => {
      calls.push({ prefix, options });
      return searchResult;
    }
  };
  const service = createProjectService({ repository, storage: {}, logger: { warn() {} } });
  return { service, calls };
}

test('sugiere usuarios por el inicio del correo, sin el propietario ni los colaboradores actuales', async () => {
  const { service, calls } = createService({
    searchResult: [{ id: 'u2', nombre_completo: 'Luis Pérez', correo: 'luis@correo.com' }]
  });

  const users = await service.suggestUsers('owner', PROJECT_ID, '  LUI ');

  assert.deepEqual(users, [{ name: 'Luis Pérez', email: 'luis@correo.com' }]);
  assert.deepEqual(calls, [{ prefix: 'lui', options: { excludeIds: ['owner', 'editor-1'], limit: 5 } }]);
});

test('no busca con menos de 3 caracteres', async () => {
  const { service, calls } = createService();
  assert.deepEqual(await service.suggestUsers('owner', PROJECT_ID, 'lu'), []);
  assert.deepEqual(await service.suggestUsers('owner', PROJECT_ID, undefined), []);
  assert.equal(calls.length, 0);
});

test('solo el propietario puede pedir sugerencias', async () => {
  const { service, calls } = createService();
  await assert.rejects(service.suggestUsers('editor-1', PROJECT_ID, 'luis'), /Solo el propietario/);
  assert.equal(calls.length, 0);
});
