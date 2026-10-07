const crypto = require('crypto');
const supabase = require('../config/supabase');
const latexService = require('../services/latexService');
const storageService = require('../services/storageService');

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
 * Da formato a un proyecto para la respuesta de la API
 */
function formatProject(project, { role, owner, mainNode, lastCompilation } = {}) {
  const dates = [project.actualizado_en, mainNode?.actualizado_en, project.creado_en].filter(Boolean);
  const updatedAt = dates.sort((a, b) => new Date(b) - new Date(a))[0] || null;

  return {
    id: project.id,
    name: project.nombre,
    description: project.descripcion || '',
    isArchived: !!project.esta_archivado,
    role: role || 'invitado',
    ownerId: project.propietario_id,
    ownerName: owner ? (owner.nombre_completo || owner.correo) : '',
    documentId: mainNode ? mainNode.id : null,
    documentName: mainNode ? mainNode.nombre : null,
    sizeBytes: mainNode ? mainNode.tamano_bytes : 0,
    createdAt: project.creado_en,
    updatedAt,
    lastCompilation: lastCompilation ? {
      id: lastCompilation.id,
      status: lastCompilation.estado,
      startedAt: lastCompilation.iniciado_en,
      finishedAt: lastCompilation.finalizado_en
    } : null
  };
}

/**
 * Elimina de forma permanente un proyecto y todos sus registros dependientes.
 * El esquema no define ON DELETE CASCADE, por lo que se borra en orden de dependencia.
 */
async function purgeProject(projectId) {
  const check = ({ error }) => {
    if (error) throw error;
  };

  const { data: nodes, error: nodesErr } = await supabase
    .from('nodos')
    .select('id')
    .eq('proyecto_id', projectId);

  if (nodesErr) throw nodesErr;

  const { data: comps, error: compsErr } = await supabase
    .from('compilaciones')
    .select('id')
    .eq('proyecto_id', projectId);

  if (compsErr) throw compsErr;

  check(await supabase.from('compilaciones').delete().eq('proyecto_id', projectId));

  const nodeIds = (nodes || []).map(n => n.id);
  if (nodeIds.length > 0) {
    check(await supabase.from('versiones_archivo').delete().in('archivo_id', nodeIds));
    check(await supabase.from('estados_autoguardado').delete().in('archivo_id', nodeIds));
    check(await supabase.from('permisos_archivo').delete().in('nodo_id', nodeIds));
    check(await supabase.from('sesiones_edicion').delete().in('archivo_id', nodeIds));
    check(await supabase.from('comentarios').delete().in('archivo_id', nodeIds));
    check(await supabase.from('nodos').delete().eq('proyecto_id', projectId));
  }

  check(await supabase.from('invitaciones').delete().eq('proyecto_id', projectId));
  check(await supabase.from('miembros_proyecto').delete().eq('proyecto_id', projectId));
  // Los registros de auditoría se conservan, solo se desvinculan del proyecto
  check(await supabase.from('registros_auditoria').update({ proyecto_id: null }).eq('proyecto_id', projectId));
  check(await supabase.from('proyectos').delete().eq('id', projectId));

  // Limpiar los archivos del proyecto en Supabase Storage
  try {
    await storageService.removeProjectFiles(projectId);
  } catch (err) {
    console.warn('Advertencia al eliminar archivos de Storage:', err.message);
  }

  // Limpiar los PDF generados en el almacenamiento local
  for (const comp of comps || []) {
    try {
      await latexService.removeCompiledPdf(comp.id);
    } catch (err) {
      console.warn('Advertencia al eliminar PDF compilado:', err.message);
    }
  }
}

/**
 * LISTAR PROYECTOS
 * GET /api/projects?archived=true|false
 */
exports.listProjects = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const archived = req.query.archived === 'true';

    // 1. Obtener proyectos propios
    const { data: ownedProjects, error: ownedErr } = await supabase
      .from('proyectos')
      .select('*')
      .eq('propietario_id', userId)
      .eq('esta_archivado', archived);

    if (ownedErr) throw ownedErr;

    // 2. Obtener proyectos compartidos
    const { data: sharedMemberships, error: sharedErr } = await supabase
      .from('miembros_proyecto')
      .select('proyecto_id, rol, proyectos(*)')
      .eq('usuario_id', userId);

    if (sharedErr) throw sharedErr;

    const projectMap = new Map();
    (ownedProjects || []).forEach(p => projectMap.set(p.id, { project: p, role: 'propietario' }));
    (sharedMemberships || []).forEach(m => {
      if (m.proyectos && !!m.proyectos.esta_archivado === archived && !projectMap.has(m.proyectos.id)) {
        projectMap.set(m.proyectos.id, { project: m.proyectos, role: m.rol });
      }
    });

    const projectIds = Array.from(projectMap.keys());
    if (projectIds.length === 0) {
      return res.json({ projects: [] });
    }

    // 3. Obtener archivo principal de cada proyecto
    const mainNodes = await getMainNodes(projectIds);

    // 4. Obtener última compilación de cada proyecto
    const latestCompilations = new Map();
    const { data: comps } = await supabase
      .from('compilaciones')
      .select('id, proyecto_id, estado, iniciado_en, finalizado_en')
      .in('proyecto_id', projectIds)
      .order('iniciado_en', { ascending: false });

    (comps || []).forEach(c => {
      if (!latestCompilations.has(c.proyecto_id)) {
        latestCompilations.set(c.proyecto_id, c);
      }
    });

    // 5. Obtener nombre de los propietarios
    const ownerIds = [...new Set(Array.from(projectMap.values()).map(({ project }) => project.propietario_id))];
    const owners = new Map();
    const { data: ownerRows } = await supabase
      .from('usuarios')
      .select('id, nombre_completo, correo')
      .in('id', ownerIds);

    (ownerRows || []).forEach(o => owners.set(o.id, o));

    const projects = Array.from(projectMap.values())
      .map(({ project, role }) => formatProject(project, {
        role,
        owner: owners.get(project.propietario_id),
        mainNode: mainNodes.get(project.id),
        lastCompilation: latestCompilations.get(project.id)
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return res.json({ projects });

  } catch (error) {
    next(error);
  }
};

/**
 * CREAR PROYECTO
 * POST /api/projects
 */
exports.createProject = async (req, res, next) => {
  try {
    const { name, description, content } = req.body || {};
    const userId = req.user.id;

    const nameResult = validateName(name);
    if (nameResult.error) {
      return res.status(400).json({ error: nameResult.error });
    }

    const descriptionResult = validateDescription(description);
    if (descriptionResult.error) {
      return res.status(400).json({ error: descriptionResult.error });
    }

    const initialContent = typeof content === 'string' ? content : DEFAULT_LATEX_TEMPLATE;

    // 1. Crear el proyecto
    const { data: project, error: projError } = await supabase
      .from('proyectos')
      .insert({
        propietario_id: userId,
        nombre: nameResult.value,
        descripcion: descriptionResult.value
      })
      .select('*')
      .single();

    if (projError) throw projError;

    let node;
    try {
      // 2. Asignar rol de propietario en miembros_proyecto
      const { error: memberError } = await supabase
        .from('miembros_proyecto')
        .insert({
          proyecto_id: project.id,
          usuario_id: userId,
          rol: 'propietario'
        });

      if (memberError) throw memberError;

      // 3. Crear el archivo principal .tex
      const { data: newNode, error: nodeError } = await supabase
        .from('nodos')
        .insert({
          proyecto_id: project.id,
          padre_id: null,
          nombre: `${nameResult.value}.tex`,
          tipo_nodo: 'archivo',
          tipo_archivo: 'tex',
          contenido_actual: initialContent,
          tamano_bytes: Buffer.byteLength(initialContent, 'utf8'),
          creado_por: userId
        })
        .select('*')
        .single();

      if (nodeError) throw nodeError;
      node = newNode;

      // 4. Guardar snapshot inicial en versiones_archivo
      const { error: versionError } = await supabase
        .from('versiones_archivo')
        .insert({
          archivo_id: node.id,
          numero_version: 1,
          contenido_snapshot: initialContent,
          modificado_por: userId,
          resumen_cambio: 'Creación inicial del proyecto'
        });

      if (versionError) throw versionError;

      // 5. Guardar el archivo .tex en Supabase Storage
      node.storage_path = await storageService.syncNodeSource(node, initialContent);
    } catch (innerError) {
      // Si falla algún paso, deshacer lo creado para no dejar un proyecto incompleto
      await purgeProject(project.id).catch(() => {});
      throw innerError;
    }

    return res.status(201).json({
      message: 'Proyecto creado exitosamente',
      project: formatProject(project, { role: 'propietario', mainNode: node }),
      storageSynced: !!node.storage_path
    });

  } catch (error) {
    next(error);
  }
};

/**
 * OBTENER PROYECTO POR ID
 * GET /api/projects/:id
 */
exports.getProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const access = await resolveProjectAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { project, role } = access;

    const mainNodes = await getMainNodes([project.id]);

    const { data: owner } = await supabase
      .from('usuarios')
      .select('id, nombre_completo, correo')
      .eq('id', project.propietario_id)
      .maybeSingle();

    const { data: lastCompilation } = await supabase
      .from('compilaciones')
      .select('id, estado, iniciado_en, finalizado_en')
      .eq('proyecto_id', project.id)
      .order('iniciado_en', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.json({
      project: formatProject(project, {
        role,
        owner,
        mainNode: mainNodes.get(project.id),
        lastCompilation
      })
    });

  } catch (error) {
    next(error);
  }
};

/**
 * MODIFICAR PROYECTO (renombrar o cambiar descripción)
 * PUT /api/projects/:id
 */
exports.updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body || {};
    const userId = req.user.id;

    const access = await resolveProjectAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { project, role } = access;

    if (role !== 'propietario') {
      return res.status(403).json({ error: 'Solo el propietario puede modificar este proyecto' });
    }

    if (name === undefined && description === undefined) {
      return res.status(400).json({ error: 'No se enviaron datos para modificar' });
    }

    const updates = {
      actualizado_en: new Date().toISOString()
    };

    if (name !== undefined) {
      const nameResult = validateName(name);
      if (nameResult.error) {
        return res.status(400).json({ error: nameResult.error });
      }
      updates.nombre = nameResult.value;
    }

    if (description !== undefined) {
      const descriptionResult = validateDescription(description);
      if (descriptionResult.error) {
        return res.status(400).json({ error: descriptionResult.error });
      }
      updates.descripcion = descriptionResult.value;
    }

    const { data: updatedProject, error: updateError } = await supabase
      .from('proyectos')
      .update(updates)
      .eq('id', project.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    // Si el archivo principal llevaba el nombre del proyecto, renombrarlo también
    const mainNodes = await getMainNodes([project.id]);
    let mainNode = mainNodes.get(project.id);

    if (mainNode && updates.nombre && updates.nombre !== project.nombre && mainNode.nombre === `${project.nombre}.tex`) {
      const { data: renamedNode, error: renameError } = await supabase
        .from('nodos')
        .update({ nombre: `${updates.nombre}.tex` })
        .eq('id', mainNode.id)
        .select('*')
        .single();

      if (renameError) throw renameError;
      mainNode = renamedNode;

      // Reflejar el nuevo nombre también en los archivos de Supabase Storage
      await storageService.syncNodeSource(renamedNode, renamedNode.contenido_actual);
    }

    return res.json({
      message: 'Proyecto actualizado exitosamente',
      project: formatProject(updatedProject, { role, mainNode })
    });

  } catch (error) {
    next(error);
  }
};

/**
 * Cambia el estado de archivado de un proyecto (solo propietario)
 */
async function setArchived(req, res, next, archived) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const access = await resolveProjectAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { project, role } = access;

    if (role !== 'propietario') {
      return res.status(403).json({
        error: `Solo el propietario puede ${archived ? 'archivar' : 'restaurar'} este proyecto`
      });
    }

    const { data: updatedProject, error: updateError } = await supabase
      .from('proyectos')
      .update({ esta_archivado: archived, actualizado_en: new Date().toISOString() })
      .eq('id', project.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    const mainNodes = await getMainNodes([project.id]);

    return res.json({
      message: archived ? 'Proyecto archivado exitosamente' : 'Proyecto restaurado exitosamente',
      project: formatProject(updatedProject, { role, mainNode: mainNodes.get(project.id) })
    });

  } catch (error) {
    next(error);
  }
}

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
        contenido_actual: n.contenido_actual,
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
          .filter(n => n.tipo_nodo === 'archivo' && typeof n.contenido_actual === 'string')
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

        // 4. Guardar en Supabase Storage los archivos de la copia
        for (const sourceNode of sourceNodes || []) {
          if (sourceNode.tipo_nodo !== 'archivo') continue;

          const newNode = newNodes.find(n => n.id === idMap.get(sourceNode.id));

          if (typeof sourceNode.contenido_actual === 'string') {
            await storageService.syncNodeSource(newNode, sourceNode.contenido_actual);
          } else if (sourceNode.storage_path) {
            // Binarios (imágenes, etc.): copiar el objeto dentro del bucket
            try {
              const extension = sourceNode.storage_path.includes('.')
                ? sourceNode.storage_path.split('.').pop()
                : 'bin';
              const copyPath = await storageService.copyFile(
                sourceNode.storage_path,
                storageService.getFilePath(
                  project.id,
                  newNode.nombre.includes('.') ? newNode.nombre : `${newNode.nombre}.${extension}`
                )
              );
              await supabase.from('nodos').update({ storage_path: copyPath }).eq('id', newNode.id);
            } catch (err) {
              console.warn('Advertencia al copiar archivo en Storage:', err.message);
            }
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

  } catch (error) {
    next(error);
  }
};
