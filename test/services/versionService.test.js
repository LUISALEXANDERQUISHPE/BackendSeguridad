const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createVersionService } = require('../../src/services/versionService');

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';
const IMAGE_ID = '33333333-3333-4333-8333-333333333333';
const OWNER = 'owner';
const EDITOR = 'editor-user';
const REVIEWER = 'reviewer-user';

/** Base de datos en memoria con la misma interfaz que los repositorios reales. */
function createFakeDatabase() {
  const files = new Map([
    [FILE_ID, { id: FILE_ID, proyecto_id: PROJECT_ID, nombre: 'main.tex', tipo_nodo: 'archivo', contenido_actual: 'v3' }],
    [IMAGE_ID, { id: IMAGE_ID, proyecto_id: PROJECT_ID, nombre: 'logo.png', tipo_nodo: 'archivo', contenido_actual: null }]
  ]);
  const rows = [];
  const autosaves = new Map();
  const storageWrites = [];
  let nextId = 1;
  let forceConflicts = 0;

  const addRow = (number, content, author = OWNER) => {
    const row = {
      id: `v${nextId++}`,
      archivo_id: FILE_ID,
      numero_version: number,
      contenido_snapshot: content,
      modificado_por: author,
      resumen_cambio: `Versión ${number}`,
      creado_en: `2026-01-0${number}T00:00:00Z`
    };
    rows.push(row);
    return row;
  };
  const byFile = fileId =>
    rows.filter(row => row.archivo_id === fileId).sort((a, b) => b.numero_version - a.numero_version);

  const versions = {
    findFile: async id => files.get(id) ?? null,
    listVersions: async (fileId, { limit, offset }) => ({
      rows: byFile(fileId).slice(offset, offset + limit + 1),
      total: byFile(fileId).length
    }),
    findVersion: async (fileId, number) => byFile(fileId).find(row => row.numero_version === number) ?? null,
    findLatestVersion: async fileId => byFile(fileId)[0] ?? null,
    insertVersion: async version => {
      if (forceConflicts > 0) {
        forceConflicts -= 1;
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      const row = { ...version, id: `v${nextId++}`, creado_en: '2026-02-01T00:00:00Z' };
      rows.push(row);
      return row;
    },
    updateFileContent: async (fileId, content) => {
      const file = { ...files.get(fileId), contenido_actual: content };
      files.set(fileId, file);
      return file;
    },
    replaceAutosaves: async (fileId, content) => autosaves.set(fileId, content)
  };

  const projects = {
    findById: async () => ({ id: PROJECT_ID, propietario_id: OWNER }),
    findMemberRole: async (_projectId, userId) => ({ [EDITOR]: 'editor', [REVIEWER]: 'revisor' })[userId] ?? null,
    findUsersByIds: async ids => new Map(ids.map(id => [id, { id, nombre_completo: `Nombre ${id}` }]))
  };

  const storage = {
    syncNodeSource: async (file, content) => storageWrites.push({ name: file.nombre, content })
  };

  return {
    files,
    rows,
    autosaves,
    storageWrites,
    addRow,
    forceConflicts: count => {
      forceConflicts = count;
    },
    deps: { versions, projects, storage, logger: { warn: () => {} } }
  };
}

describe('versionService', () => {
  let db;
  let service;

  beforeEach(() => {
    db = createFakeDatabase();
    db.addRow(1, 'v1');
    db.addRow(2, 'v1\nv2', EDITOR);
    db.addRow(3, 'v3');
    service = createVersionService(db.deps);
  });

  describe('recordVersion', () => {
    it('crea la siguiente versión numerada', async () => {
      const created = await service.recordVersion({ fileId: FILE_ID, userId: OWNER, content: 'v4' });
      assert.equal(created.numero_version, 4);
      assert.equal(created.resumen_cambio, 'Versión 4');
    });

    it('no duplica la versión si el contenido no cambió', async () => {
      assert.equal(await service.recordVersion({ fileId: FILE_ID, userId: OWNER, content: 'v3' }), null);
      assert.equal(db.rows.length, 3);
    });

    it('reintenta si otro guardado simultáneo tomó el mismo número', async () => {
      db.forceConflicts(1);
      const created = await service.recordVersion({ fileId: FILE_ID, userId: OWNER, content: 'v4' });
      assert.equal(created.numero_version, 4);
    });

    it('propaga el error si el conflicto persiste tras los reintentos', async () => {
      db.forceConflicts(10);
      await assert.rejects(service.recordVersion({ fileId: FILE_ID, userId: OWNER, content: 'v4' }), {
        code: '23505'
      });
    });
  });

  describe('listVersions', () => {
    it('devuelve el historial más reciente primero con autor y líneas cambiadas', async () => {
      const result = await service.listVersions(OWNER, FILE_ID, {});

      assert.equal(result.total, 3);
      assert.deepEqual(result.versions.map(v => v.number), [3, 2, 1]);
      assert.equal(result.versions[1].author.name, `Nombre ${EDITOR}`);
      assert.deepEqual(result.versions[1].changes, { added: 1, removed: 0 });
      assert.deepEqual(result.versions[2].changes, { added: 1, removed: 0 });
      assert.equal(result.versions[0].content, undefined);
      assert.equal(result.hasUnversionedChanges, false);
    });

    it('calcula los cambios de la última versión de la página usando la anterior', async () => {
      const result = await service.listVersions(OWNER, FILE_ID, { limit: '1', offset: '1' });
      assert.deepEqual(result.versions.map(v => v.number), [2]);
      assert.deepEqual(result.versions[0].changes, { added: 1, removed: 0 });
    });

    it('indica si el archivo tiene cambios posteriores a la última versión', async () => {
      db.files.get(FILE_ID).contenido_actual = 'v3 editado';
      assert.equal((await service.listVersions(OWNER, FILE_ID, {})).hasUnversionedChanges, true);
    });

    it('rechaza a usuarios sin acceso, archivos binarios e identificadores inválidos', async () => {
      await assert.rejects(service.listVersions('extraño', FILE_ID, {}), { statusCode: 403 });
      await assert.rejects(service.listVersions(OWNER, IMAGE_ID, {}), { statusCode: 400 });
      await assert.rejects(service.listVersions(OWNER, 'no-uuid', {}), { statusCode: 400 });
      await assert.rejects(
        service.listVersions(OWNER, '44444444-4444-4444-8444-444444444444', {}),
        { statusCode: 404 }
      );
    });
  });

  describe('getVersion y compareVersions', () => {
    it('devuelve el contenido de una versión', async () => {
      const version = await service.getVersion(REVIEWER, FILE_ID, 2);
      assert.equal(version.content, 'v1\nv2');
    });

    it('responde 404 si la versión no existe', async () => {
      await assert.rejects(service.getVersion(OWNER, FILE_ID, 99), { statusCode: 404 });
    });

    it('compara dos versiones línea a línea', async () => {
      const result = await service.compareVersions(OWNER, FILE_ID, { from: 1, to: 2 });
      assert.deepEqual(result.stats, { added: 1, removed: 0, unchanged: 1 });
      assert.equal(result.fileName, 'main.tex');
    });

    it('compara una versión con el contenido actual del archivo', async () => {
      db.files.get(FILE_ID).contenido_actual = 'v3\nnuevo';
      const result = await service.compareVersions(OWNER, FILE_ID, { from: 3, to: 'current' });
      assert.deepEqual(result.stats, { added: 1, removed: 0, unchanged: 1 });
    });
  });

  describe('createVersion', () => {
    it('guarda el contenido actual con la descripción indicada', async () => {
      db.files.get(FILE_ID).contenido_actual = 'v4';
      const version = await service.createVersion(EDITOR, FILE_ID, { summary: '  Capítulo 2 listo ' });
      assert.equal(version.number, 4);
      assert.equal(version.summary, 'Capítulo 2 listo');
    });

    it('rechaza guardar si no hay cambios (409) o si el usuario es revisor (403)', async () => {
      await assert.rejects(service.createVersion(OWNER, FILE_ID, {}), { statusCode: 409 });
      db.files.get(FILE_ID).contenido_actual = 'v4';
      await assert.rejects(service.createVersion(REVIEWER, FILE_ID, {}), { statusCode: 403 });
    });
  });

  describe('restoreVersion', () => {
    it('restaura como versión nueva sin modificar el historial anterior', async () => {
      const result = await service.restoreVersion(OWNER, FILE_ID, 1);

      assert.equal(result.content, 'v1');
      assert.equal(result.version.number, 4);
      assert.equal(result.version.summary, 'Restaurada desde la versión 1');
      assert.equal(db.files.get(FILE_ID).contenido_actual, 'v1');
      assert.equal(db.autosaves.get(FILE_ID), 'v1');
      assert.deepEqual(db.storageWrites, [{ name: 'main.tex', content: 'v1' }]);
      assert.deepEqual(db.rows.slice(0, 3).map(row => row.contenido_snapshot), ['v1', 'v1\nv2', 'v3']);
    });

    it('respalda antes los cambios que aún no eran versión', async () => {
      db.files.get(FILE_ID).contenido_actual = 'trabajo sin guardar';
      await service.restoreVersion(OWNER, FILE_ID, 1);

      const summaries = db.rows.slice(3).map(row => [row.numero_version, row.resumen_cambio, row.contenido_snapshot]);
      assert.deepEqual(summaries, [
        [4, 'Respaldo automático antes de restaurar la versión 1', 'trabajo sin guardar'],
        [5, 'Restaurada desde la versión 1', 'v1']
      ]);
    });

    it('continúa aunque falle la copia en Storage', async () => {
      db.deps.storage.syncNodeSource = async () => {
        throw new Error('Storage caído');
      };
      service = createVersionService(db.deps);
      const result = await service.restoreVersion(OWNER, FILE_ID, 1);
      assert.equal(result.content, 'v1');
    });

    it('rechaza restaurar el contenido actual (409), sin permisos (403) o una versión inexistente (404)', async () => {
      await assert.rejects(service.restoreVersion(OWNER, FILE_ID, 3), { statusCode: 409 });
      await assert.rejects(service.restoreVersion(REVIEWER, FILE_ID, 1), { statusCode: 403 });
      await assert.rejects(service.restoreVersion(OWNER, FILE_ID, 42), { statusCode: 404 });
    });
  });
});
