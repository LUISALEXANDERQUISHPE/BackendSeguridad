const { PROJECT_ROLES, NODE_TYPES, FILE_TYPES } = require('../constants/projectConstants');
const { DEFAULT_LATEX_TEMPLATE } = require('../constants/latexTemplates');
const { toProjectDto } = require('../mappers/projectMapper');
const {
  validateName,
  validateDescription,
  validateContent,
  validateUpdatePayload,
  buildCopyName,
  toMainFileName
} = require('../validators/projectValidator');
const {
  buildIdMap,
  buildClonedNodes,
  buildInitialVersions,
  isMainTexNode,
  resolveBinaryFileName
} = require('./projectCloneBuilder');
const { createProjectAccessService } = require('./projectAccessService');

/**
 * Servicio de negocio de la HU-17 "Gestión de proyectos":
 * crear, abrir, modificar, archivar/restaurar, duplicar y eliminar proyectos LaTeX.
 *
 * Todas sus dependencias se inyectan (principio de inversión de dependencias), lo que
 * permite reemplazar la base de datos o el almacenamiento sin modificar esta lógica.
 *
 * @param {object} deps
 * @param {object} deps.repository Acceso a datos de proyectos
 * @param {object} deps.storage Almacenamiento de archivos (Supabase Storage)
 * @param {object} deps.compiledFiles Almacenamiento local de PDF compilados
 * @param {object} deps.logger Registro de advertencias
 */
function createProjectService({ repository, storage, compiledFiles, logger }) {
  const access = createProjectAccessService({ repository });

  const nowIso = () => new Date().toISOString();

  /**
   * Ejecuta una operación secundaria sin interrumpir el flujo principal si falla.
   * @param {string} description
   * @param {() => Promise<unknown>} operation
   */
  async function runSafely(description, operation) {
    try {
      await operation();
    } catch (err) {
      logger.warn(`Advertencia al ${description}:`, err.message);
    }
  }

  /**
   * Elimina el proyecto con todos sus datos y archivos asociados.
   * @param {string} projectId
   */
  async function purgeProject(projectId) {
    const compilationIds = await repository.findCompilationIds(projectId);
    await repository.deleteProjectCascade(projectId);

    await runSafely('eliminar archivos de Storage', () => storage.removeProjectFiles(projectId));
    for (const compilationId of compilationIds) {
      await runSafely('eliminar PDF compilado', () => compiledFiles.removeCompiledPdf(compilationId));
    }
  }

  /**
   * Crea un proyecto vacío con su propietario. Si "populate" falla, revierte lo creado
   * para no dejar proyectos incompletos (compensación, ya que Supabase no expone transacciones).
   *
   * @param {object} projectData Fila a insertar en "proyectos"
   * @param {string} userId Propietario
   * @param {(project: object) => Promise<object|null>} populate Crea los archivos del proyecto
   * @returns {Promise<{ project: object, mainNode: object|null }>}
   */
  async function createWithRollback(projectData, userId, populate) {
    const project = await repository.insertProject({ ...projectData, propietario_id: userId });

    try {
      await repository.addMember(project.id, userId, PROJECT_ROLES.OWNER);
      const mainNode = await populate(project);
      return { project, mainNode };
    } catch (error) {
      await runSafely('revertir el proyecto incompleto', () => purgeProject(project.id));
      throw error;
    }
  }

  /**
   * Proyectos propios y compartidos del usuario, sin duplicados.
   * @returns {Promise<Map<string, { project: object, role: string }>>}
   */
  async function collectAccessibleProjects(userId, archived) {
    const owned = await repository.findOwnedByUser(userId, archived);
    const memberships = await repository.findMembershipsWithProject(userId);

    const projects = new Map(
      owned.map(project => [project.id, { project, role: PROJECT_ROLES.OWNER }])
    );

    for (const { rol, proyectos: project } of memberships) {
      const matchesView = project && Boolean(project.esta_archivado) === archived;
      if (matchesView && !projects.has(project.id)) {
        projects.set(project.id, { project, role: rol });
      }
    }

    return projects;
  }

  /**
   * LISTAR proyectos del usuario (activos o archivados), ordenados por última modificación.
   * @param {string} userId
   * @param {{ archived: boolean }} options
   */
  async function listProjects(userId, { archived }) {
    const accessible = await collectAccessibleProjects(userId, archived);
    const projectIds = [...accessible.keys()];
    if (projectIds.length === 0) return [];

    const entries = [...accessible.values()];
    const ownerIds = [...new Set(entries.map(({ project }) => project.propietario_id))];

    const [mainNodes, compilations, owners] = await Promise.all([
      repository.findMainNodes(projectIds),
      repository.findLatestCompilations(projectIds),
      repository.findUsersByIds(ownerIds)
    ]);

    return entries
      .map(({ project, role }) => toProjectDto(project, {
        role,
        owner: owners.get(project.propietario_id),
        mainNode: mainNodes.get(project.id),
        lastCompilation: compilations.get(project.id)
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  /**
   * OBTENER el detalle de un proyecto al que el usuario tiene acceso.
   */
  async function getProject(userId, projectId) {
    const { project, role } = await access.resolve(projectId, userId);

    const [mainNodes, compilations, owners] = await Promise.all([
      repository.findMainNodes([project.id]),
      repository.findLatestCompilations([project.id]),
      repository.findUsersByIds([project.propietario_id])
    ]);

    return toProjectDto(project, {
      role,
      owner: owners.get(project.propietario_id),
      mainNode: mainNodes.get(project.id),
      lastCompilation: compilations.get(project.id)
    });
  }

  /**
   * CREAR un proyecto con su archivo principal .tex, snapshot inicial y copia en Storage.
   * @returns {Promise<{ project: object, storageSynced: boolean }>}
   */
  async function createProject(userId, { name, description, content } = {}) {
    const nombre = validateName(name);
    const descripcion = validateDescription(description);
    const initialContent = validateContent(content, DEFAULT_LATEX_TEMPLATE);

    const { project, mainNode } = await createWithRollback({ nombre, descripcion }, userId, async created => {
      const node = await repository.insertNode({
        proyecto_id: created.id,
        padre_id: null,
        nombre: toMainFileName(nombre),
        tipo_nodo: NODE_TYPES.FILE,
        tipo_archivo: FILE_TYPES.TEX,
        contenido_actual: initialContent,
        tamano_bytes: Buffer.byteLength(initialContent, 'utf8'),
        creado_por: userId
      });

      await repository.insertVersions(
        buildInitialVersions([node], userId, 'Creación inicial del proyecto')
      );

      node.storage_path = await storage.syncNodeSource(node, initialContent);
      return node;
    });

    return {
      project: toProjectDto(project, { role: PROJECT_ROLES.OWNER, mainNode }),
      storageSynced: Boolean(mainNode?.storage_path)
    };
  }

  /**
   * Si el archivo principal llevaba el nombre anterior del proyecto, lo renombra también.
   * @returns {Promise<object|undefined>} Nodo principal vigente
   */
  async function renameMainNodeIfNeeded(previousName, updated) {
    const mainNodes = await repository.findMainNodes([updated.id]);
    const mainNode = mainNodes.get(updated.id);

    const nameChanged = previousName !== updated.nombre;
    if (!mainNode || !nameChanged || mainNode.nombre !== toMainFileName(previousName)) {
      return mainNode;
    }

    const renamed = await repository.updateNode(mainNode.id, { nombre: toMainFileName(updated.nombre) });
    await storage.syncNodeSource(renamed, renamed.contenido_actual);
    return renamed;
  }

  /**
   * MODIFICAR nombre y/o descripción (solo el propietario).
   */
  async function updateProject(userId, projectId, payload) {
    const { project, role } = await access.resolveAsOwner(projectId, userId, 'modificar');
    const changes = validateUpdatePayload(payload);
    const previousName = project.nombre;

    const updated = await repository.updateProject(project.id, { ...changes, actualizado_en: nowIso() });
    const mainNode = await renameMainNodeIfNeeded(previousName, updated);

    return toProjectDto(updated, { role, mainNode });
  }

  /**
   * ARCHIVAR o RESTAURAR un proyecto (solo el propietario).
   */
  async function setArchived(userId, projectId, archived) {
    const action = archived ? 'archivar' : 'restaurar';
    const { project, role } = await access.resolveAsOwner(projectId, userId, action);

    const updated = await repository.updateProject(project.id, {
      esta_archivado: archived,
      actualizado_en: nowIso()
    });
    const mainNodes = await repository.findMainNodes([project.id]);

    return toProjectDto(updated, { role, mainNode: mainNodes.get(project.id) });
  }

  /**
   * Copia en Storage un archivo binario (imágenes, etc.) del proyecto original.
   */
  async function copyBinaryFile(sourceNode, clonedNode, targetProjectId) {
    const fileName = resolveBinaryFileName(clonedNode.nombre, sourceNode.storage_path);
    const copyPath = await storage.copyFile(
      sourceNode.storage_path,
      storage.getFilePath(targetProjectId, fileName)
    );
    await repository.updateNode(clonedNode.id, { storage_path: copyPath });
  }

  /**
   * Guarda en Storage los archivos de la copia (texto se vuelve a subir, binarios se copian).
   */
  async function copyFilesToStorage(sourceNodes, clonedNodes, idMap, targetProjectId) {
    const clonedById = new Map(clonedNodes.map(node => [node.id, node]));

    for (const sourceNode of sourceNodes) {
      const clonedNode = clonedById.get(idMap.get(sourceNode.id));
      const isFile = sourceNode.tipo_nodo === NODE_TYPES.FILE;

      if (isFile && typeof sourceNode.contenido_actual === 'string') {
        await storage.syncNodeSource(clonedNode, sourceNode.contenido_actual);
      } else if (isFile && sourceNode.storage_path) {
        await runSafely('copiar archivo en Storage', () =>
          copyBinaryFile(sourceNode, clonedNode, targetProjectId)
        );
      }
    }
  }

  /**
   * DUPLICAR un proyecto con todo su árbol de archivos. Quien duplica es el propietario de la copia.
   */
  async function duplicateProject(userId, projectId, { name } = {}) {
    const { project: source } = await access.resolve(projectId, userId);
    const nombre = validateName(name ?? buildCopyName(source.nombre));
    const sourceNodes = await repository.findNodesByProject(source.id);

    const projectData = {
      nombre,
      descripcion: source.descripcion,
      plantilla_id: source.plantilla_id
    };

    const { project, mainNode } = await createWithRollback(projectData, userId, async created => {
      const idMap = buildIdMap(sourceNodes);
      const clonedNodes = buildClonedNodes({
        sourceNodes,
        idMap,
        sourceProject: source,
        targetProject: created,
        userId
      });

      const inserted = await repository.insertNodes(clonedNodes);
      await repository.insertVersions(
        buildInitialVersions(clonedNodes, userId, `Copia del proyecto "${source.nombre}"`)
      );
      await copyFilesToStorage(sourceNodes, clonedNodes, idMap, created.id);

      const sourceMain = sourceNodes.find(isMainTexNode);
      const mainId = sourceMain ? idMap.get(sourceMain.id) : null;
      return inserted.find(node => node.id === mainId) ?? null;
    });

    return toProjectDto(project, { role: PROJECT_ROLES.OWNER, mainNode });
  }

  /**
   * ELIMINAR un proyecto de forma permanente (solo el propietario).
   */
  async function deleteProject(userId, projectId) {
    const { project } = await access.resolveAsOwner(projectId, userId, 'eliminar');
    await purgeProject(project.id);
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    setArchived,
    duplicateProject,
    deleteProject
  };
}

module.exports = { createProjectService };
