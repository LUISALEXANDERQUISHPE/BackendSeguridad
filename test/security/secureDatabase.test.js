const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { createFakeSupabase } = require('../helpers/fakeSupabase');
const { randomBytes } = require('../../src/security/primitives/random');
const { createSecureDatabaseClient } = require('../../src/security/database/secureDatabaseClient');
const { createProjectResolver } = require('../../src/security/database/projectResolver');
const { createDataProtection, isEncryptedField } = require('../../src/security/storage/dataProtection');
const { createProjectKeyService, createSupabaseProjectKeyRepository } = require('../../src/security/storage/projectKeyService');

/** Cliente con cifrado sobre un Supabase falso, igual a como se arma en src/config/supabase.js. */
function setup(initialTables) {
  const raw = createFakeSupabase(initialTables);
  const masterKey = randomBytes(32);
  const projectKeyService = createProjectKeyService({ masterKey, repository: createSupabaseProjectKeyRepository(raw) });
  const deps = {
    projectKeyService,
    dataProtection: createDataProtection({ projectKeyService }),
    projectResolver: createProjectResolver(raw)
  };
  return { raw, masterKey, deps, db: createSecureDatabaseClient(raw, () => deps) };
}

const LONG_TEX = '\\section{Introducción} Texto con ñ, acentos y emoji 😀.\n'.repeat(20000);

describe('Cliente de base de datos con cifrado transparente', () => {
  let ctx;
  let projectId;
  let nodeId;

  beforeEach(async () => {
    ctx = setup({ usuarios: [{ id: 'u1' }] });
    const { data: project } = await ctx.db.from('proyectos')
      .insert({ propietario_id: 'u1', nombre: 'Tesis', descripcion: 'Descripción privada' }).select('*').single();
    projectId = project.id;
    const { data: node } = await ctx.db.from('nodos')
      .insert({ proyecto_id: projectId, nombre: 'main.tex', contenido_actual: LONG_TEX }).select('*').single();
    nodeId = node.id;
  });

  it('un proyecto nuevo nace con su llave, que nunca se devuelve al leer', async () => {
    const stored = ctx.raw.tables.get('proyectos')[0];
    assert.match(stored.llave_cifrada, /^[A-Za-z0-9+/=]+$/);
    const { data } = await ctx.db.from('proyectos').select('*').eq('id', projectId).single();
    assert.equal('llave_cifrada' in data, false);
    assert.equal(data.descripcion, 'Descripción privada');
  });

  it('guarda el contenido cifrado y comprimido, y lo devuelve en claro sin pérdida', async () => {
    const stored = ctx.raw.tables.get('nodos')[0].contenido_actual;
    assert.ok(isEncryptedField(stored));
    assert.ok(stored.startsWith(`slenc1:${projectId}:`));
    assert.ok(!stored.includes('Introducción'));
    assert.ok(stored.length < Buffer.byteLength(LONG_TEX), 'Huffman debe reducir el tamaño');

    const { data } = await ctx.db.from('nodos').select('contenido_actual').eq('id', nodeId).single();
    assert.equal(data.contenido_actual, LONG_TEX);
  });

  it('un update por id (sin proyecto_id) también se cifra con la llave correcta', async () => {
    const { data } = await ctx.db.from('nodos').update({ contenido_actual: 'nuevo contenido' })
      .eq('id', nodeId).select('*').single();
    assert.equal(data.contenido_actual, 'nuevo contenido');
    assert.ok(ctx.raw.tables.get('nodos')[0].contenido_actual.startsWith(`slenc1:${projectId}:`));
  });

  it('versiones, autoguardado y comentarios se cifran con la llave del proyecto de su archivo', async () => {
    await ctx.db.from('versiones_archivo').insert([
      { archivo_id: nodeId, numero_version: 1, contenido_snapshot: 'v1', resumen_cambio: 'Primera' },
      { archivo_id: nodeId, numero_version: 2, contenido_snapshot: 'v2', resumen_cambio: 'Segunda' }
    ]);
    await ctx.db.from('estados_autoguardado').insert({ archivo_id: nodeId, usuario_id: 'u1', buffer_contenido: 'borrador' });
    const { data: comment } = await ctx.db.from('comentarios')
      .insert({ archivo_id: nodeId, usuario_id: 'u1', contenido: 'Revisar esto', texto_citado: 'Introducción' })
      .select('*').single();
    await ctx.db.from('comentarios').update({ contenido: 'Editado' }).eq('id', comment.id);

    for (const [table, columns] of [
      ['versiones_archivo', ['contenido_snapshot', 'resumen_cambio']],
      ['estados_autoguardado', ['buffer_contenido']],
      ['comentarios', ['contenido', 'texto_citado']]
    ]) {
      for (const row of ctx.raw.tables.get(table)) {
        for (const column of columns) assert.ok(row[column].startsWith(`slenc1:${projectId}:`), `${table}.${column}`);
      }
    }

    const { data: versions } = await ctx.db.from('versiones_archivo').select('*').eq('archivo_id', nodeId);
    assert.deepEqual(versions.map((v) => v.contenido_snapshot), ['v1', 'v2']);
    const { data: edited } = await ctx.db.from('comentarios').select('*').eq('id', comment.id).single();
    assert.equal(edited.contenido, 'Editado');
    assert.equal(edited.texto_citado, 'Introducción');
  });

  it('descifra también datos anidados (relaciones) y deja igual los datos anteriores al cifrado', async () => {
    const { data: encrypted } = await ctx.db.from('nodos').select('contenido_actual').eq('id', nodeId).single();
    ctx.raw.tables.set('miembros_proyecto', [{
      id: 'm1',
      proyectos: { id: projectId, descripcion: ctx.raw.tables.get('proyectos')[0].descripcion },
      nota: 'texto en claro de antes'
    }]);
    const { data } = await ctx.db.from('miembros_proyecto').select('*').single();
    assert.equal(data.proyectos.descripcion, 'Descripción privada');
    assert.equal(data.nota, 'texto en claro de antes');
    assert.equal(encrypted.contenido_actual, LONG_TEX);
  });

  it('un dato alterado en la base de datos no se descifra', async () => {
    const row = ctx.raw.tables.get('nodos')[0];
    const payload = Buffer.from(row.contenido_actual.split(':')[2], 'base64');
    payload[payload.length - 40] ^= 1;
    row.contenido_actual = `slenc1:${projectId}:${payload.toString('base64')}`;
    await assert.rejects(async () => ctx.db.from('nodos').select('*').eq('id', nodeId).single(), /alterados/);
  });

  it('un dato copiado a otro proyecto o a otra columna se rechaza', async () => {
    const { data: other } = await ctx.db.from('proyectos').insert({ propietario_id: 'u1', nombre: 'Otro' }).select('*').single();
    const encrypted = ctx.raw.tables.get('nodos')[0].contenido_actual;
    ctx.raw.tables.get('proyectos').find((p) => p.id === other.id).descripcion = encrypted;
    await assert.rejects(async () => ctx.db.from('proyectos').select('*').eq('id', other.id).single());
  });

  it('nunca escribe en claro: si no puede saber el proyecto, la escritura falla', async () => {
    await assert.rejects(
      async () => ctx.db.from('comentarios').update({ contenido: 'x' }).in('id', ['a', 'b']),
      /No se pudo determinar el proyecto/
    );
  });

  it('los proyectos anteriores al cifrado reciben su llave una sola vez, aunque se pida a la vez', async () => {
    const legacyId = randomUUID();
    ctx.raw.tables.get('proyectos').push({ id: legacyId, nombre: 'Antiguo', llave_cifrada: null });
    const [a, b] = await Promise.all([
      ctx.deps.projectKeyService.getProjectKey(legacyId),
      ctx.deps.projectKeyService.getProjectKey(legacyId)
    ]);
    assert.deepEqual(a, b);
    assert.ok(ctx.raw.tables.get('proyectos').find((p) => p.id === legacyId).llave_cifrada);
  });
});

describe('Protección de archivos (Storage y disco)', () => {
  it('cifra y descifra archivos binarios; los anteriores al cifrado se devuelven igual', async () => {
    const { deps, db } = setup();
    const { data: project } = await db.from('proyectos').insert({ nombre: 'P' }).select('id').single();
    const pdf = Buffer.concat([Buffer.from('%PDF-1.5\n'), Buffer.from(randomBytes(300000))]);

    const sealed = await deps.dataProtection.protectBytes(project.id, pdf);
    assert.ok(!sealed.includes(Buffer.from('%PDF')));
    assert.ok((await deps.dataProtection.revealBytes(project.id, sealed)).equals(pdf));
    assert.ok((await deps.dataProtection.revealBytes(project.id, pdf)).equals(pdf));
  });
});
