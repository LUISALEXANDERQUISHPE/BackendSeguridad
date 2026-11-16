const projectRepository = require('../repositories/projectRepository');
const storageService = require('../services/storageService');
const latexService = require('../services/latexService');
const logger = require('../utils/logger');
const { createProjectService } = require('../services/projectService');
const { isTextFile } = require('../utils/fileTypes');

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

// Plantilla inicial por defecto para el archivo principal de un proyecto nuevo
const DEFAULT_LATEX_TEMPLATE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[spanish]{babel}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{Mi Documento}
\\author{Autor}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introducción}
¡Bienvenido al editor LaTeX! Puedes comenzar a escribir tu código aquí.

\\end{document}
`;

/**
 * Validador de formato UUID
 */
function isValidUuid(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Valida y normaliza el nombre de un proyecto.
 * Retorna { value } si es válido o { error } con el mensaje para el usuario.
 */
function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    return { error: 'El nombre del proyecto es requerido' };
  }

  const cleanName = name.trim().replace(/\.tex$/i, '').trim();

  if (!cleanName) {
    return { error: 'El nombre del proyecto es requerido' };
  }

  if (cleanName.length > MAX_NAME_LENGTH) {
    return { error: `El nombre del proyecto no puede superar los ${MAX_NAME_LENGTH} caracteres` };
  }

  if (/[\u0000-\u001f\u007f<>:"/\\|?*]/.test(cleanName)) {
    return { error: 'El nombre del proyecto contiene caracteres no permitidos (< > : " / \\ | ? *)' };
  }

  return { value: cleanName };
}

/**
 * Valida y normaliza la descripción de un proyecto (opcional).
 */
function validateDescription(description) {
  if (description === undefined || description === null || description === '') {
    return { value: null };
  }

  if (typeof description !== 'string') {
    return { error: 'La descripción debe ser un texto' };
  }

  const cleanDescription = description.trim();

  if (cleanDescription.length > MAX_DESCRIPTION_LENGTH) {
    return { error: `La descripción no puede superar los ${MAX_DESCRIPTION_LENGTH} caracteres` };
  }

  return { value: cleanDescription || null };
}

/**
 * Helper para resolver un proyecto y el rol del usuario dentro de él
 */
async function resolveProjectAndAccess(projectId, userId) {
  if (!isValidUuid(projectId)) {
    return { error: 'Identificador de proyecto inválido (debe ser un UUID válido)', status: 400 };
  }

  const { data: project, error: projError } = await supabase
    .from('proyectos')
    .select('*')
    .eq('id', projectId)
    .maybeSingle();

  if (projError) throw projError;

  if (!project) {
    return { error: 'Proyecto no encontrado', status: 404 };
  }

  if (project.propietario_id === userId) {
    return { project, role: 'propietario' };
  }

  const { data: membership, error: memberError } = await supabase
    .from('miembros_proyecto')
    .select('rol')
    .eq('proyecto_id', project.id)
    .eq('usuario_id', userId)
    .maybeSingle();

  if (memberError) throw memberError;

  if (!membership) {
    return { error: 'No tienes permisos para acceder a este proyecto', status: 403 };
  }

  return { project, role: membership.rol };
}

/**
 * Obtiene el archivo .tex principal (en la raíz) de cada proyecto indicado.
 * Retorna un Map proyecto_id -> nodo.
 */
async function getMainNodes(projectIds) {
  const mainNodes = new Map();
  if (projectIds.length === 0) return mainNodes;

  const { data: nodes, error } = await supabase
    .from('nodos')
    .select('id, proyecto_id, nombre, tamano_bytes, creado_en, actualizado_en')
    .in('proyecto_id', projectIds)
    .eq('tipo_nodo', 'archivo')
    .eq('tipo_archivo', 'tex')
    .is('padre_id', null)
    .order('creado_en', { ascending: true });

  if (error) throw error;

  (nodes || []).forEach(n => {
    if (!mainNodes.has(n.proyecto_id)) {
      mainNodes.set(n.proyecto_id, n);
    }
  });

  return mainNodes;
}

/**
 * Controlador HTTP de la HU-17 "Gestión de proyectos".
 * Solo traduce peticiones HTTP a llamadas del servicio y da forma a la respuesta;
 * la validación, autorización y persistencia viven en sus propias capas.
 * Express 5 propaga al middleware de errores cualquier promesa rechazada.
 *
 * @param {ReturnType<typeof createProjectService>} projectService
 */
function createProjectController(projectService) {
  return {
    /** GET /api/projects?archived=true|false */
    async listProjects(req, res) {
      const archived = req.query.archived === 'true';
      const projects = await projectService.listProjects(req.user.id, { archived });
      res.json({ projects });
    },

    /** POST /api/projects */
    async createProject(req, res) {
      const { project, storageSynced } = await projectService.createProject(req.user.id, req.body);
      res.status(201).json({ message: 'Proyecto creado exitosamente', project, storageSynced });
    },

    /** GET /api/projects/:id */
    async getProjectById(req, res) {
      const project = await projectService.getProject(req.user.id, req.params.id);
      res.json({ project });
    },

    /** PUT /api/projects/:id */
    async updateProject(req, res) {
      const project = await projectService.updateProject(req.user.id, req.params.id, req.body);
      res.json({ message: 'Proyecto actualizado exitosamente', project });
    },

    /** POST /api/projects/:id/archive */
    async archiveProject(req, res) {
      const project = await projectService.setArchived(req.user.id, req.params.id, true);
      res.json({ message: 'Proyecto archivado exitosamente', project });
    },

    /** POST /api/projects/:id/restore */
    async restoreProject(req, res) {
      const project = await projectService.setArchived(req.user.id, req.params.id, false);
      res.json({ message: 'Proyecto restaurado exitosamente', project });
    },

    /** POST /api/projects/:id/duplicate */
    async duplicateProject(req, res) {
      const project = await projectService.duplicateProject(req.user.id, req.params.id, req.body);
      res.status(201).json({ message: 'Proyecto duplicado exitosamente', project });
    },

    /** DELETE /api/projects/:id */
    async deleteProject(req, res) {
      await projectService.deleteProject(req.user.id, req.params.id);
      res.json({ message: 'Proyecto eliminado exitosamente' });
    }
  };
}

// Raíz de composición: aquí se conectan las implementaciones concretas
const projectService = createProjectService({
  repository: projectRepository,
  storage: storageService,
  compiledFiles: latexService,
  logger
});
/**
 * ARCHIVAR PROYECTO
 * POST /api/projects/:id/archive
 */
exports.archiveProject = (req, res, next) => setArchived(req, res, next, true);

/**
 * RESTAURAR PROYECTO ARCHIVADO
 * POST /api/projects/:id/restore
 */
exports.restoreProject = (req, res, next) => setArchived(req, res, next, false);

/**
 * DUPLICAR PROYECTO
 * POST /api/projects/:id/duplicate
 */
exports.duplicateProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body || {};
    const userId = req.user.id;

    const access = await resolveProjectAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { project: source } = access;

    const nameResult = validateName(
      name !== undefined ? name : `${source.nombre.slice(0, MAX_NAME_LENGTH - 8)} (copia)`
    );
    if (nameResult.error) {
      return res.status(400).json({ error: nameResult.error });
    }

    const { data: sourceNodes, error: nodesErr } = await supabase
      .from('nodos')
      .select('*')
      .eq('proyecto_id', source.id)
      .order('creado_en', { ascending: true });

    if (nodesErr) throw nodesErr;

    // 1. Crear el proyecto copia; quien duplica pasa a ser su propietario
    const { data: project, error: projError } = await supabase
      .from('proyectos')
      .insert({
        propietario_id: userId,
        nombre: nameResult.value,
        descripcion: source.descripcion,
        plantilla_id: source.plantilla_id
      })
      .select('*')
      .single();

    if (projError) throw projError;

    let mainNode = null;
    try {
      const { error: memberError } = await supabase
        .from('miembros_proyecto')
        .insert({
          proyecto_id: project.id,
          usuario_id: userId,
          rol: 'propietario'
        });

      if (memberError) throw memberError;

      // 2. Copiar el árbol de archivos y carpetas conservando la jerarquía
      const idMap = new Map();
      (sourceNodes || []).forEach(n => idMap.set(n.id, crypto.randomUUID()));

      const sourceMainNode = (sourceNodes || []).find(
        n => n.tipo_nodo === 'archivo' && n.tipo_archivo === 'tex' && !n.padre_id
      );

      const newNodes = (sourceNodes || []).map(n => ({
        id: idMap.get(n.id),
        proyecto_id: project.id,
        padre_id: n.padre_id ? idMap.get(n.padre_id) || null : null,
        nombre: n === sourceMainNode && n.nombre === `${source.nombre}.tex`
          ? `${nameResult.value}.tex`
          : n.nombre,
        tipo_nodo: n.tipo_nodo,
        tipo_archivo: n.tipo_archivo,
        contenido_actual: n.tipo_nodo === 'archivo' && isTextFile(n.nombre) ? n.contenido_actual : null,
        // Cada copia tendrá su propio archivo en Storage (se asigna más abajo)
        storage_path: null,
        tamano_bytes: n.tamano_bytes,
        creado_por: userId
      }));

      if (newNodes.length > 0) {
        const { data: insertedNodes, error: insertError } = await supabase
          .from('nodos')
          .insert(newNodes)
          .select('id, proyecto_id, nombre, tamano_bytes, creado_en, actualizado_en');

        if (insertError) throw insertError;

        if (sourceMainNode) {
          mainNode = (insertedNodes || []).find(n => n.id === idMap.get(sourceMainNode.id)) || null;
        }

        // 3. Snapshot inicial para cada archivo de texto copiado
        const versions = newNodes
          .filter(n => n.tipo_nodo === 'archivo' && isTextFile(n.nombre) && typeof n.contenido_actual === 'string')
          .map(n => ({
            archivo_id: n.id,
            numero_version: 1,
            contenido_snapshot: n.contenido_actual,
            modificado_por: userId,
            resumen_cambio: `Copia del proyecto "${source.nombre}"`
          }));

        if (versions.length > 0) {
          const { error: versionError } = await supabase
            .from('versiones_archivo')
            .insert(versions);

          if (versionError) throw versionError;
        }

        // 4. Guardar en Supabase Storage los archivos de la copia, conservando la ruta de carpetas
        const sourceById = new Map((sourceNodes || []).map(n => [n.id, n]));
        const relativePathOf = (node) => {
          const parts = [];
          let current = node;
          while (current && parts.length < 64) {
            parts.unshift(current.nombre);
            current = current.padre_id ? sourceById.get(current.padre_id) : null;
          }
          return parts.join('/');
        };

        for (const sourceNode of sourceNodes || []) {
          if (sourceNode.tipo_nodo !== 'archivo') continue;

          const newNode = newNodes.find(n => n.id === idMap.get(sourceNode.id));
          const targetPath = storageService.getNestedFilePath(project.id, relativePathOf({ ...sourceNode, nombre: newNode.nombre }));

          try {
            if (isTextFile(sourceNode.nombre) && typeof sourceNode.contenido_actual === 'string') {
              await storageService.uploadSource(targetPath, sourceNode.contenido_actual);
            } else if (sourceNode.storage_path) {
              // Binarios (imágenes, PDFs, etc.): copiar el objeto dentro del bucket
              await storageService.copyFile(sourceNode.storage_path, targetPath);
            } else {
              continue;
            }
            await supabase.from('nodos').update({ storage_path: targetPath }).eq('id', newNode.id);
          } catch (err) {
            console.warn('Advertencia al copiar archivo en Storage:', err.message);
          }
        }
      }
    } catch (innerError) {
      // Si falla algún paso, deshacer la copia para no dejar un proyecto incompleto
      await purgeProject(project.id).catch(() => {});
      throw innerError;
    }

    return res.status(201).json({
      message: 'Proyecto duplicado exitosamente',
      project: formatProject(project, { role: 'propietario', mainNode })
    });

  } catch (error) {
    next(error);
  }
};

/**
 * ELIMINAR PROYECTO DE FORMA PERMANENTE
 * DELETE /api/projects/:id
 */
exports.deleteProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const access = await resolveProjectAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { project, role } = access;

    if (role !== 'propietario') {
      return res.status(403).json({ error: 'Solo el propietario puede eliminar este proyecto' });
    }

    await purgeProject(project.id);

    return res.json({
      message: 'Proyecto eliminado exitosamente'
    });

module.exports = createProjectController(projectService);
module.exports.createProjectController = createProjectController;
