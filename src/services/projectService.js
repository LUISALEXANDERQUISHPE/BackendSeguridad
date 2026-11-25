const { PROJECT_ROLES, NODE_TYPES, FILE_TYPES } = require('../constants/projectConstants');
const { DEFAULT_LATEX_TEMPLATE } = require('../constants/latexTemplates');
const { toProjectDto } = require('../mappers/projectMapper');
const {
  validateName,
  validateDescription,
  validateContent,
  validateUpdatePayload,
  buildCopyName,
  toMainFileName,
  validateEmail
} = require('../validators/projectValidator');
const { ValidationError, NotFoundError, ConflictError } = require('../errors/AppError');
const {
  buildIdMap,
  buildClonedNodes,
  buildInitialVersions,
  isMainTexNode,
  hasTextContent,
  buildRelativePath
} = require('./projectCloneBuilder');
const { createProjectAccessService } = require('./projectAccessService');

// Autocompletado de correos al compartir: límites que dificultan enumerar usuarios
const SHARE_SUGGESTIONS = Object.freeze({
  MIN_QUERY_LENGTH: 3,
  MAX_QUERY_LENGTH: 254,
  MAX_RESULTS: 5
});

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
 * @param {{ notify: Function }} [deps.notifier] Avisos en tiempo real a los usuarios
 */
function createProjectService({ repository, storage, compiledFiles, logger, notifier = null }) {
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
   * Copia en Storage un archivo de la copia en la misma ruta de carpetas que el original:
   * los de texto se vuelven a subir y los binarios (imágenes, PDFs...) se copian dentro del bucket.
   * @returns {Promise<boolean>} true si el archivo quedó en Storage
   */
  async function copyFileToStorage(sourceNode, targetPath) {
    if (hasTextContent(sourceNode)) {
      await storage.uploadSource(targetPath, sourceNode.contenido_actual);
      return true;
    }
    if (sourceNode.storage_path) {
      await storage.copyFile(sourceNode.storage_path, targetPath);
      return true;
    }
    return false;
  }

  /**
   * Guarda en Storage todos los archivos de la copia, conservando la estructura de carpetas.
   */
  async function copyFilesToStorage(sourceNodes, clonedNodes, idMap, targetProjectId) {
    const clonedById = new Map(clonedNodes.map(node => [node.id, node]));
    const sourceById = new Map(sourceNodes.map(node => [node.id, node]));
    const sourceFiles = sourceNodes.filter(node => node.tipo_nodo === NODE_TYPES.FILE);

    for (const sourceNode of sourceFiles) {
      const clonedNode = clonedById.get(idMap.get(sourceNode.id));
      // La ruta usa el nombre de la copia (el archivo principal puede haberse renombrado)
      const relativePath = buildRelativePath({ ...sourceNode, nombre: clonedNode.nombre }, sourceById);
      const targetPath = storage.getNestedFilePath(targetProjectId, relativePath);

      await runSafely('copiar archivo en Storage', async () => {
        if (await copyFileToStorage(sourceNode, targetPath)) {
          await repository.updateNode(clonedNode.id, { storage_path: targetPath });
        }
      });
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

  /**
   * LISTAR colaboradores del proyecto (cualquier miembro puede verlos).
   */
  async function listMembers(userId, projectId) {
    const { project } = await access.resolve(projectId, userId);
    const members = await repository.findMembers(project.id);
    return members
      .filter((member) => member.usuario_id !== project.propietario_id)
      .map((member) => ({
        userId: member.usuario_id,
        name: member.usuarios?.nombre_completo || null,
        email: member.usuarios?.correo || null,
        role: member.rol,
        joinedAt: member.se_unio_en
      }));
  }

  /**
   * SUGERIR usuarios para compartir mientras se escribe el correo (solo el propietario).
   * Para no exponer la lista de usuarios del sistema: exige un mínimo de caracteres, solo busca
   * correos que empiecen con lo escrito, devuelve pocos resultados y omite a quienes ya tienen acceso.
   */
  async function suggestUsers(userId, projectId, query) {
    const { project } = await access.resolveAsOwner(projectId, userId, 'compartir');
    const prefix = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (prefix.length < SHARE_SUGGESTIONS.MIN_QUERY_LENGTH || prefix.length > SHARE_SUGGESTIONS.MAX_QUERY_LENGTH) {
      return [];
    }

    const members = await repository.findMembers(project.id);
    const excludeIds = [project.propietario_id, ...members.map((member) => member.usuario_id)];
    const users = await repository.searchUsersByEmailPrefix(prefix, {
      excludeIds,
      limit: SHARE_SUGGESTIONS.MAX_RESULTS
    });
    return users.map((user) => ({ name: user.nombre_completo || null, email: user.correo }));
  }

  /**
   * COMPARTIR el proyecto con otro usuario registrado (solo el propietario).
   * Por ahora todos los colaboradores entran como editores: la gestión de roles se hará aparte.
   */
  async function shareProject(userId, projectId, { email } = {}) {
    const { project } = await access.resolveAsOwner(projectId, userId, 'compartir');
    const normalizedEmail = validateEmail(email);

    const invitee = await repository.findUserByEmail(normalizedEmail);
    if (!invitee) {
      throw new NotFoundError('No existe un usuario registrado con ese correo');
    }
    if (invitee.id === project.propietario_id) {
      throw new ValidationError('El propietario ya tiene acceso al proyecto');
    }
    if (await repository.findMemberRole(project.id, invitee.id)) {
      throw new ConflictError('Ese usuario ya colabora en el proyecto');
    }

    await repository.addMember(project.id, invitee.id, PROJECT_ROLES.EDITOR, userId);

    // Aviso en tiempo real: el proyecto aparece en el panel del invitado sin recargar
    if (notifier) {
      const owner = await repository.findUserById(userId).catch(() => null);
      notifier.notify(invitee.id, {
        type: 'project-shared',
        projectId: project.id,
        projectName: project.nombre,
        sharedBy: owner?.nombre_completo || owner?.correo || null
      });
    }
    return { userId: invitee.id, name: invitee.nombre_completo, email: invitee.correo, role: PROJECT_ROLES.EDITOR };
  }

  return {
    listProjects,
    getProject,
    createProject,
    updateProject,
    setArchived,
    duplicateProject,
    deleteProject,
    listMembers,
    suggestUsers,
    shareProject
  };
}

module.exports = { createProjectService };
