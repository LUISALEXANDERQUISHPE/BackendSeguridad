const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createProjectService } = require('../../src/services/projectService');
const { createTemplateService } = require('../../src/services/templateService');
const { createTemplateFileRepository } = require('../../src/repositories/templateFileRepository');

const TESIS_ID = 'e63e0b09-ffca-41af-b88e-68229fb8166c';

/**
 * Crea proyectos desde las plantillas REALES del sistema con una base de datos y un Storage
 * en memoria, para comprobar que cada proyecto es una copia independiente de la plantilla.
 */
function createEnvironment() {
  const db = { projects: [], nodes: [], versions: [], members: [], deleted: [] };
  const stored = new Map();
  let nextId = 1;

  const repository = {
    insertProject: async project => {
      const row = { id: `proyecto-${nextId++}`, ...project };
      db.projects.push(row);
      return row;
    },
    addMember: async (projectId, userId, role) => db.members.push({ projectId, userId, role }),
    insertNodes: async nodes => {
      db.nodes.push(...nodes.map(node => ({ ...node })));
      return nodes;
    },
    insertVersions: async versions => db.versions.push(...versions),
    updateNode: async (id, changes) => Object.assign(db.nodes.find(node => node.id === id), changes),
    deleteProjectCascade: async projectId => {
      db.deleted.push(projectId);
      db.nodes = db.nodes.filter(node => node.proyecto_id !== projectId);
    }
  };

  const storage = {
    getNestedFilePath: (projectId, relativePath) => `proyectos/${projectId}/${relativePath}`,
    uploadSource: async (path, text) => stored.set(path, text),
    uploadBinary: async (path, buffer) => stored.set(path, buffer),
    removeProjectFiles: async () => {}
  };

  const templateFiles = createTemplateFileRepository();
  const templates = createTemplateService({
    files: templateFiles,
    catalog: { upsertSystemTemplates: async () => {} },
    logger: { info() {}, warn() {} }
  });
  const service = createProjectService({ repository, storage, logger: { warn() {} }, templates });

  return { db, stored, service, templateFiles };
}

describe('crear un proyecto desde una plantilla', () => {
  let env;

  beforeEach(() => {
    env = createEnvironment();
  });

  it('crea un proyecto propio con todos los archivos y carpetas de la plantilla', async () => {
    const project = await env.service.createProjectFromTemplate('usuario-1', { templateId: TESIS_ID, name: 'Mi tesis' });

    assert.equal(project.name, 'Mi tesis');
    assert.equal(project.role, 'propietario');
    assert.equal(project.documentName, 'main.tex');
    assert.equal(env.db.projects[0].plantilla_id, TESIS_ID);
    assert.deepEqual(env.db.members, [{ projectId: project.id, userId: 'usuario-1', role: 'propietario' }]);

    const names = env.db.nodes.map(node => node.nombre);
    assert.ok(names.includes('capitulos'));
    assert.ok(names.includes('introduccion.tex'));
    assert.ok(names.includes('referencias.bib'));
    assert.ok(!names.includes('template.json'));
    assert.ok(!names.includes('preview.pdf'));
  });

  it('usa el nombre y la descripción de la plantilla si no se indican', async () => {
    const project = await env.service.createProjectFromTemplate('usuario-1', { templateId: TESIS_ID });
    assert.equal(project.name, 'Tesis de grado');
    assert.match(project.description, /capítulos/);
  });

  it('guarda una versión inicial de cada archivo de texto y su copia en Storage', async () => {
    const project = await env.service.createProjectFromTemplate('usuario-1', { templateId: TESIS_ID });
    const textFiles = env.db.nodes.filter(node => node.tipo_nodo === 'archivo');

    assert.equal(env.db.versions.length, textFiles.length);
    assert.ok(env.db.versions.every(version => version.resumen_cambio === 'Creado desde la plantilla "Tesis de grado"'));
    assert.ok(env.stored.has(`proyectos/${project.id}/capitulos/introduccion.tex`));
    assert.ok(textFiles.every(node => node.storage_path?.startsWith(`proyectos/${project.id}/`)));
  });

  it('cada uso es una copia independiente: modificarla no cambia la plantilla base', async () => {
    const [template] = await env.templateFiles.listTemplates();
    const before = (await env.templateFiles.readFiles(template)).map(file => file.content.toString('utf8'));

    const first = await env.service.createProjectFromTemplate('usuario-1', { templateId: template.id });
    const second = await env.service.createProjectFromTemplate('usuario-2', { templateId: template.id });

    // Editar la copia del primer usuario
    const firstMain = env.db.nodes.find(node => node.proyecto_id === first.id && node.nombre === 'main.tex');
    firstMain.contenido_actual = 'contenido editado por el usuario';

    const secondMain = env.db.nodes.find(node => node.proyecto_id === second.id && node.nombre === 'main.tex');
    const after = (await env.templateFiles.readFiles(template)).map(file => file.content.toString('utf8'));

    assert.notEqual(first.id, second.id);
    assert.notEqual(firstMain.id, secondMain.id);
    assert.notEqual(secondMain.contenido_actual, 'contenido editado por el usuario');
    assert.deepEqual(after, before);
  });

  it('rechaza una plantilla inexistente sin crear ningún proyecto', async () => {
    await assert.rejects(
      env.service.createProjectFromTemplate('usuario-1', { templateId: '99999999-9999-4999-8999-999999999999' }),
      { statusCode: 404 }
    );
    assert.equal(env.db.projects.length, 0);
  });

  it('valida el nombre elegido por el usuario', async () => {
    await assert.rejects(
      env.service.createProjectFromTemplate('usuario-1', { templateId: TESIS_ID, name: 'a/b' }),
      { statusCode: 400 }
    );
  });

  it('revierte el proyecto si no se puede guardar un archivo binario', async () => {
    const deleted = [];
    const binaryTemplate = {
      loadForCopy: async () => ({
        template: { id: TESIS_ID, name: 'Con imagen', description: 'x', mainFile: 'main.tex' },
        files: [
          { path: 'main.tex', content: Buffer.from('x') },
          { path: 'logo.png', content: Buffer.from([1, 2, 3]) }
        ]
      })
    };
    const service = createProjectService({
      repository: {
        insertProject: async project => ({ id: 'p-1', ...project }),
        addMember: async () => {},
        insertNodes: async nodes => nodes,
        insertVersions: async () => {},
        updateNode: async () => {},
        deleteProjectCascade: async projectId => deleted.push(projectId)
      },
      storage: {
        getNestedFilePath: (projectId, relativePath) => `${projectId}/${relativePath}`,
        uploadSource: async () => {},
        uploadBinary: async () => {
          throw new Error('Storage no disponible');
        },
        removeProjectFiles: async () => {}
      },
      logger: { warn() {} },
      templates: binaryTemplate
    });

    await assert.rejects(service.createProjectFromTemplate('usuario-1', { templateId: TESIS_ID }), /Storage no disponible/);
    assert.deepEqual(deleted, ['p-1']);
  });

  it('informa si el catálogo de plantillas no está configurado', async () => {
    const service = createProjectService({ repository: {}, storage: {}, logger: { warn() {} } });
    await assert.rejects(service.createProjectFromTemplate('usuario-1', { templateId: TESIS_ID }), /no está configurado/);
  });
});
