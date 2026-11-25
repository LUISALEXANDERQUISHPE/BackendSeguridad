const test = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { CollabRoom, TEXT_KEY, toBase64, fromBase64 } = require('../../src/realtime/collabRoom');

/** Cliente simulado: un Y.Doc propio conectado a la sala mediante un "socket" en memoria. */
function createClient(room, { canEdit = true, name = 'Ana' } = {}) {
  const doc = new Y.Doc();
  const received = [];
  const socket = {
    send(data) {
      const message = JSON.parse(data);
      received.push(message);
      if (message.type === 'init' || message.type === 'update') {
        Y.applyUpdate(doc, fromBase64(message.state || message.update), 'remote');
      }
    }
  };
  room.join(socket, { userId: name, name, canEdit });
  doc.on('update', (update, origin) => {
    if (origin !== 'remote') room.handleMessage(socket, { type: 'update', update: toBase64(update) });
  });
  return { doc, text: doc.getText(TEXT_KEY), socket, received };
}

function createRoom(overrides = {}) {
  const saved = [];
  const room = new CollabRoom({
    documentId: 'doc-1',
    initialContent: 'Hola mundo',
    persistDelayMs: 10_000,
    persist: async (content) => {
      saved.push(content);
      return { savedAt: '2026-01-01T00:00:00.000Z' };
    },
    logger: { warn() {} },
    ...overrides
  });
  return { room, saved };
}

test('un cliente nuevo recibe el contenido guardado', () => {
  const { room } = createRoom();
  const client = createClient(room);
  assert.equal(client.text.toString(), 'Hola mundo');
});

test('las ediciones simultáneas de dos colaboradores se fusionan en todos los clientes', async () => {
  const { room, saved } = createRoom();
  const ana = createClient(room, { name: 'Ana' });
  const luis = createClient(room, { name: 'Luis' });

  ana.text.insert(0, '¡');
  luis.text.insert(luis.text.length, '!');
  luis.text.delete(1, 4); // borra "Hola" desde la vista de Luis

  assert.equal(ana.text.toString(), luis.text.toString());
  assert.equal(room.text.toString(), ana.text.toString());

  await room.close();
  assert.deepEqual(saved, [room.text.toString()]);
});

test('un colaborador sin permisos de edición no puede modificar el documento', () => {
  const { room } = createRoom();
  const editor = createClient(room, { name: 'Ana' });
  const reader = createClient(room, { name: 'Luis', canEdit: false });

  reader.text.insert(0, 'X');

  assert.equal(room.text.toString(), 'Hola mundo');
  assert.equal(editor.text.toString(), 'Hola mundo');
  assert.ok(reader.received.some((message) => message.type === 'error'));
});

test('la presencia informa quién está conectado y quién se fue', () => {
  const { room } = createRoom();
  const ana = createClient(room, { name: 'Ana' });
  const luis = createClient(room, { name: 'Luis' });

  const lastPresence = () => ana.received.filter((message) => message.type === 'presence').at(-1);
  assert.deepEqual(lastPresence().users.map((user) => user.name), ['Ana', 'Luis']);

  room.leave(luis.socket);
  assert.deepEqual(lastPresence().users.map((user) => user.name), ['Ana']);
});

test('los cursores inválidos se descartan', () => {
  const { room } = createRoom();
  const ana = createClient(room, { name: 'Ana' });
  const luis = createClient(room, { name: 'Luis' });

  room.handleMessage(luis.socket, { type: 'cursor', cursor: { anchor: 'x', head: 1 } });
  assert.equal(ana.received.at(-1).cursor, null);
});

test('no se guarda si el contenido no cambió', async () => {
  const { room, saved } = createRoom();
  createClient(room);
  await room.close();
  assert.deepEqual(saved, []);
});

test('HU-25: al bajar a lector, los cambios posteriores del usuario se rechazan al instante', () => {
  const { room } = createRoom();
  const ana = createClient(room, { name: 'Ana' });
  const luis = createClient(room, { name: 'Luis' });

  ana.text.insert(0, 'A ');
  assert.equal(room.text.toString(), 'A Hola mundo');

  assert.equal(room.setUserAccess('Ana', false), 1);
  assert.deepEqual(ana.received.findLast((message) => message.type === 'access'), { type: 'access', canEdit: false });
  assert.equal(luis.received.at(-1).type, 'presence');
  assert.equal(luis.received.at(-1).users.find((user) => user.userId === 'Ana').canEdit, false);

  ana.text.insert(0, 'X ');
  assert.equal(room.text.toString(), 'A Hola mundo', 'el servidor no aplica cambios de un lector');
  assert.equal(ana.received.at(-1).type, 'error');

  // Al devolverle el permiso, una conexión resincronizada (sin el cambio rechazado) vuelve a editar
  room.leave(ana.socket);
  createClient(room, { name: 'Ana', canEdit: false });
  room.setUserAccess('Ana', true);
  const anaAgain = room.socketsOf('Ana')[0];
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, Y.encodeStateAsUpdate(room.doc));
  fresh.on('update', (update) => room.handleMessage(anaAgain, { type: 'update', update: toBase64(update) }));
  fresh.getText(TEXT_KEY).insert(0, 'B ');
  assert.equal(room.text.toString(), 'B A Hola mundo');
});

test('HU-25: socketsOf devuelve todas las pestañas de un usuario y setUserAccess ignora a quien no está', () => {
  const { room } = createRoom();
  const tab1 = createClient(room, { name: 'Ana' });
  const tab2 = createClient(room, { name: 'Ana' });
  createClient(room, { name: 'Luis' });

  assert.deepEqual(room.socketsOf('Ana'), [tab1.socket, tab2.socket]);
  assert.equal(room.setUserAccess('Ana', false), 2);
  assert.equal(room.setUserAccess('Nadie', false), 0);
});
