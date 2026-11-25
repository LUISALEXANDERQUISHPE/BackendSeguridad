const test = require('node:test');
const assert = require('node:assert/strict');
const { can, permissionsOf, isAssignableRole, PROJECT_ACTIONS: A } = require('../../src/constants/permissions');

test('el propietario puede hacer todo menos salir de su propio proyecto', () => {
  for (const action of Object.values(A)) {
    assert.equal(can('propietario', action), action !== A.LEAVE, action);
  }
});

test('el editor edita, gestiona archivos, versiones y comentarios, pero no el acceso ni el proyecto', () => {
  for (const action of [A.VIEW, A.COMPILE, A.EDIT_CONTENT, A.MANAGE_FILES, A.MANAGE_VERSIONS, A.COMMENT, A.RESOLVE_COMMENTS, A.LEAVE]) {
    assert.equal(can('editor', action), true, action);
  }
  for (const action of [A.MANAGE_MEMBERS, A.MANAGE_PROJECT]) {
    assert.equal(can('editor', action), false, action);
  }
});

test('el lector solo lee: ver, compilar lo guardado, duplicar, ver comentarios e historial y salir', () => {
  const allowed = new Set([A.VIEW, A.COMPILE, A.DUPLICATE, A.VIEW_COMMENTS, A.VIEW_HISTORY, A.LEAVE]);
  for (const action of Object.values(A)) {
    assert.equal(can('lector', action), allowed.has(action), action);
  }
});

test('un rol desconocido, vacío o nulo no puede hacer nada (lista de permitidos)', () => {
  for (const role of ['admin', '', null, undefined, '__proto__', 'constructor']) {
    for (const action of Object.values(A)) {
      assert.equal(can(role, action), false, `${role}:${action}`);
    }
    assert.deepEqual(permissionsOf(role), []);
  }
});

test('los roles heredados (invitado, revisor) nunca pueden editar el contenido', () => {
  assert.equal(can('invitado', A.EDIT_CONTENT), false);
  assert.equal(can('revisor', A.EDIT_CONTENT), false);
  assert.equal(can('revisor', A.COMMENT), true);
});

test('solo editor y lector se pueden asignar al invitar o cambiar el rol', () => {
  assert.equal(isAssignableRole('editor'), true);
  assert.equal(isAssignableRole('lector'), true);
  for (const role of ['propietario', 'revisor', 'invitado', 'admin', undefined]) {
    assert.equal(isAssignableRole(role), false, String(role));
  }
});
