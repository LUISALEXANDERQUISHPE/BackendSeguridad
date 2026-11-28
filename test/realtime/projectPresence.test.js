const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectPresence, userColor } = require('../../src/realtime/projectPresence');

test('une a los conectados de todos los archivos del proyecto, una vez por usuario', () => {
  const users = buildProjectPresence([
    {
      documentId: 'doc-main',
      documentName: 'main.tex',
      clients: [
        { userId: 'u-luis', name: 'Luis', canEdit: true },
        { userId: 'u-luis', name: 'Luis', canEdit: true } // otra pestaña del mismo usuario
      ]
    },
    {
      documentId: 'doc-cap1',
      documentName: 'capitulo1.tex',
      clients: [
        { userId: 'u-ana', name: 'Ana', canEdit: false },
        { userId: 'u-luis', name: 'Luis', canEdit: true }
      ]
    }
  ]);

  assert.deepEqual(users.map((user) => [user.name, user.documentName, user.canEdit]), [
    ['Ana', 'capitulo1.tex', false],
    ['Luis', 'main.tex', true]
  ]);
});

test('cada usuario tiene siempre el mismo color, en cualquier archivo', () => {
  const first = buildProjectPresence([{ documentId: 'a', documentName: 'a.tex', clients: [{ userId: 'u-1', name: 'X', canEdit: true }] }]);
  const second = buildProjectPresence([{ documentId: 'b', documentName: 'b.tex', clients: [{ userId: 'u-1', name: 'X', canEdit: true }] }]);
  assert.equal(first[0].color, second[0].color);
  assert.equal(first[0].color, userColor('u-1'));
  assert.match(userColor('otro'), /^#[0-9a-f]{6}$/);
});

test('sin salas no hay nadie conectado', () => {
  assert.deepEqual(buildProjectPresence([]), []);
});
