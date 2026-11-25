const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createCommentService } = require('../../src/services/commentService');

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';
const IMAGE_ID = '33333333-3333-4333-8333-333333333333';
const OWNER = 'owner';
const EDITOR = 'editor-1';
const EDITOR_2 = 'editor-2';
const READER = 'lector-1';
const STRANGER = 'extraño';

function setup() {
  const roles = new Map([[EDITOR, 'editor'], [EDITOR_2, 'editor'], [READER, 'lector']]);
  const rows = [];
  const changes = [];
  const files = new Map([
    [FILE_ID, { id: FILE_ID, proyecto_id: PROJECT_ID, nombre: 'main.tex', tipo_nodo: 'archivo' }],
    [IMAGE_ID, { id: IMAGE_ID, proyecto_id: PROJECT_ID, nombre: 'logo.png', tipo_nodo: 'archivo' }]
  ]);
  const withAuthor = (row) => ({ ...row, autor: { nombre_completo: `Nombre de ${row.usuario_id}` } });

  const comments = {
    findFile: async (id) => files.get(id) || null,
    findByFile: async (fileId) => rows.filter((row) => row.archivo_id === fileId).map(withAuthor),
    findById: async (id) => rows.find((row) => row.id === id) || null,
    insert: async (data) => {
      const row = { id: crypto.randomUUID(), creado_en: new Date(Date.now() + rows.length).toISOString(), actualizado_en: null, ...data };
      rows.push(row);
      return withAuthor(row);
    },
    update: async (id, data) => {
      const row = rows.find((item) => item.id === id);
      Object.assign(row, data);
      return withAuthor(row);
    },
    deleteThread: async (id) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].id === id || rows[i].comentario_padre_id === id) rows.splice(i, 1);
      }
    }
  };
  const projects = {
    findById: async (id) => (id === PROJECT_ID ? { id, propietario_id: OWNER } : null),
    findMemberRole: async (_projectId, userId) => roles.get(userId) || null
  };

  const service = createCommentService({ comments, projects, onCommentsChanged: (fileId) => changes.push(fileId) });
  const newThread = (userId = EDITOR, extra = {}) =>
    service.createThread(userId, FILE_ID, { content: 'Revisa esta cita', selectionStart: 10, selectionEnd: 20, quotedText: '\\cite{x}', ...extra });

  return { service, rows, roles, changes, newThread };
}

test('un editor comenta una selección; todos los miembros ven el hilo y se avisa en tiempo real', async () => {
  const { service, changes, newThread } = setup();
  const thread = await newThread();

  assert.equal(thread.content, 'Revisa esta cita');
  assert.deepEqual(thread.selection, { start: 10, end: 20 });
  assert.equal(thread.quotedText, '\\cite{x}');
  assert.equal(thread.isOwn, true);
  assert.deepEqual(changes, [FILE_ID]);

  for (const user of [OWNER, EDITOR_2, READER]) {
    const threads = await service.listThreads(user, FILE_ID);
    assert.equal(threads.length, 1, user);
    assert.equal(threads[0].isOwn, false);
    assert.equal(threads[0].author.name, `Nombre de ${EDITOR}`);
  }
});

test('SEGURIDAD: el lector puede leer pero no comentar, responder, resolver ni borrar', async () => {
  const { service, newThread, rows } = setup();
  const thread = await newThread();

  await assert.rejects(newThread(READER), /Solo el propietario o un editor/);
  await assert.rejects(service.reply(READER, thread.id, { content: 'hola' }), /Solo el propietario o un editor/);
  await assert.rejects(service.resolve(READER, thread.id), /Solo el propietario o un editor/);
  await assert.rejects(service.deleteComment(READER, thread.id), /No puedes eliminar/);
  assert.equal(rows.length, 1);
});

test('SEGURIDAD: alguien ajeno al proyecto no ve ni toca los comentarios', async () => {
  const { service, newThread } = setup();
  const thread = await newThread();
  await assert.rejects(service.listThreads(STRANGER, FILE_ID), /No tienes permisos/);
  await assert.rejects(newThread(STRANGER), /No tienes permisos/);
  await assert.rejects(service.reply(STRANGER, thread.id, { content: 'x' }), /No tienes permisos/);
  await assert.rejects(service.deleteComment(STRANGER, thread.id), /No tienes permisos/);
});

test('SEGURIDAD: solo el autor edita su comentario', async () => {
  const { service, newThread } = setup();
  const thread = await newThread(EDITOR);

  await assert.rejects(service.editComment(EDITOR_2, thread.id, { content: 'cambio ajeno' }), /tus propios comentarios/);
  await assert.rejects(service.editComment(OWNER, thread.id, { content: 'cambio ajeno' }), /tus propios comentarios/);

  const edited = await service.editComment(EDITOR, thread.id, { content: '  Texto corregido  ' });
  assert.equal(edited.content, 'Texto corregido');
  assert.ok(edited.updatedAt);
});

test('un autor que pasó a lector ya no puede editar ni borrar su comentario', async () => {
  const { service, newThread, roles } = setup();
  const thread = await newThread(EDITOR);
  roles.set(EDITOR, 'lector');
  await assert.rejects(service.editComment(EDITOR, thread.id, { content: 'x' }), /no permite editar/);
  await assert.rejects(service.deleteComment(EDITOR, thread.id), /No puedes eliminar/);
});

test('responder agrega al hilo; no se responde a una respuesta ni en un hilo resuelto', async () => {
  const { service, newThread } = setup();
  const thread = await newThread();
  const reply = await service.reply(OWNER, thread.id, { content: 'De acuerdo' });

  const [listed] = await service.listThreads(EDITOR, FILE_ID);
  assert.deepEqual(listed.replies.map((item) => item.content), ['De acuerdo']);

  await assert.rejects(service.reply(EDITOR, reply.id, { content: 'anidada' }), /comentario principal/);

  await service.resolve(OWNER, thread.id);
  await assert.rejects(service.reply(EDITOR, thread.id, { content: 'tarde' }), /resuelto/);
});

test('resolver y reabrir guarda quién y cuándo; solo sobre el hilo principal', async () => {
  const { service, rows, newThread } = setup();
  const thread = await newThread();
  const reply = await service.reply(OWNER, thread.id, { content: 'ok' });

  await service.resolve(EDITOR_2, thread.id);
  const root = rows.find((row) => row.id === thread.id);
  assert.equal(root.esta_resuelto, true);
  assert.equal(root.resuelto_por, EDITOR_2);
  assert.ok(root.resuelto_en);
  assert.equal((await service.listThreads(READER, FILE_ID))[0].resolved, true);

  await assert.rejects(service.resolve(OWNER, reply.id), /hilo completo/);

  await service.reopen(OWNER, thread.id);
  assert.equal(root.esta_resuelto, false);
  assert.equal(root.resuelto_por, null);
});

test('borrar: el autor borra lo suyo; propietario y editores borran cualquiera; el principal borra el hilo', async () => {
  const { service, rows, newThread } = setup();
  const thread = await newThread(EDITOR);
  const reply = await service.reply(EDITOR_2, thread.id, { content: 'respuesta' });

  await service.deleteComment(EDITOR_2, reply.id);
  assert.equal(rows.length, 1);

  await service.reply(EDITOR_2, thread.id, { content: 'otra' });
  await service.deleteComment(OWNER, thread.id);
  assert.equal(rows.length, 0, 'se borra el hilo con sus respuestas');
});

test('valida el contenido y la selección', async () => {
  const { newThread } = setup();
  await assert.rejects(newThread(EDITOR, { content: '   ' }), /vacío/);
  await assert.rejects(newThread(EDITOR, { content: 'x'.repeat(2001) }), /2000/);
  await assert.rejects(newThread(EDITOR, { selectionStart: 20, selectionEnd: 10 }), /selección/);
  await assert.rejects(newThread(EDITOR, { selectionStart: -1, selectionEnd: 10 }), /selección/);
  await assert.rejects(newThread(EDITOR, { selectionStart: 1.5, selectionEnd: 10 }), /selección/);
  await assert.rejects(newThread(EDITOR, { selectionStart: '0', selectionEnd: 10 }), /selección/);
  await assert.rejects(newThread(EDITOR, { selectionStart: 5, selectionEnd: 5 }), /Selecciona/);
});

test('limpia caracteres de control y acota la cita; el contenido se guarda como texto plano', async () => {
  const { newThread } = setup();
  const thread = await newThread(EDITOR, {
    content: 'Hola\u0000 <script>alert(1)</script>\nlínea 2',
    quotedText: 'q'.repeat(900)
  });
  assert.equal(thread.content, 'Hola <script>alert(1)</script>\nlínea 2', 'no se interpreta: el frontend lo muestra como texto');
  assert.equal(thread.quotedText.length, 500);
});

test('solo se comentan archivos de texto y con ids válidos', async () => {
  const { service } = setup();
  await assert.rejects(service.createThread(EDITOR, IMAGE_ID, { content: 'x', selectionStart: 0, selectionEnd: 1 }), /archivos de texto/);
  await assert.rejects(service.listThreads(EDITOR, 'no-uuid'), /inválido/);
  await assert.rejects(service.reply(EDITOR, 'no-uuid', { content: 'x' }), /inválido/);
});

test('los hilos se ordenan por su posición en el documento', async () => {
  const { service, newThread } = setup();
  await newThread(EDITOR, { selectionStart: 300, selectionEnd: 310 });
  await newThread(EDITOR, { selectionStart: 5, selectionEnd: 8 });
  const threads = await service.listThreads(READER, FILE_ID);
  assert.deepEqual(threads.map((thread) => thread.selection.start), [5, 300]);
});
