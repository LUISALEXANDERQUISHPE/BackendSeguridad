const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const supabase = require('../config/supabase');
const latexService = require('../services/latexService');
const storageService = require('../services/storageService');
const { getFileType, getMimeType, isTextFile, isValidNodeName } = require('../utils/fileTypes');

// Plantilla inicial por defecto para nuevos documentos LaTeX
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
 * Validador de formato UUID v4
 */
function isValidUuid(id) {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function resolveProjectAccess(projectId, userId) {
  if (!isValidUuid(projectId)) return { error: 'Identificador de proyecto inválido', status: 400 };
  const { data: project, error } = await supabase.from('proyectos').select('*').eq('id', projectId).maybeSingle();
  if (error) throw error;
  if (!project) return { error: 'Proyecto no encontrado', status: 404 };
  if (project.propietario_id === userId) return { project, role: 'propietario' };
  const { data: membership, error: memberError } = await supabase
    .from('miembros_proyecto').select('rol').eq('proyecto_id', projectId).eq('usuario_id', userId).maybeSingle();
  if (memberError) throw memberError;
  if (!membership) return { error: 'No tienes permisos para acceder a este proyecto', status: 403 };
  return { project, role: membership.rol };
}

/**
 * Construye la ruta relativa (ej. "capitulos/intro.tex") de cada nodo del proyecto a partir de padre_id
 * @returns {Map<string, string>} nodo_id -> ruta relativa
 */
function buildRelativePaths(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const paths = new Map();
  const resolvePath = (node, depth = 0) => {
    if (paths.has(node.id)) return paths.get(node.id);
    const parent = node.padre_id ? byId.get(node.padre_id) : null;
    // depth evita ciclos en datos corruptos
    const value = parent && depth < 64 ? `${resolvePath(parent, depth + 1)}/${node.nombre}` : node.nombre;
    paths.set(node.id, value);
    return value;
  };
  nodes.forEach(node => resolvePath(node));
  return paths;
}

/**
 * Indica si un código .tex es un documento completo (tiene \documentclass fuera de comentarios)
 */
function isStandaloneDocument(content) {
  return String(content || '').split(/\r?\n/).some(line => /^[^%]*\\documentclass\s*[[{]/.test(line));
}

/**
 * Elige el archivo .tex que se compila: el archivo abierto si es un documento completo; si no
 * (un capítulo incluido con \input, un .bib, una imagen...), el documento principal del proyecto:
 * primero un .tex con \documentclass en la raíz, luego en cualquier carpeta, y por último el .tex más antiguo.
 */
function selectMainNode(nodes, currentNode, currentContent) {
  const texNodes = nodes
    .filter(node => node.tipo_nodo === 'archivo' && /\.tex$/i.test(node.nombre))
    .sort((left, right) => new Date(left.creado_en) - new Date(right.creado_en));
  const contentOf = node => (node.id === currentNode?.id && typeof currentContent === 'string' ? currentContent : node.contenido_actual);

  if (currentNode && /\.tex$/i.test(currentNode.nombre) && isStandaloneDocument(contentOf(currentNode))) {
    return currentNode;
  }

  return texNodes.find(node => !node.padre_id && isStandaloneDocument(contentOf(node)))
    || texNodes.find(node => isStandaloneDocument(contentOf(node)))
    || texNodes.find(node => !node.padre_id)
    || texNodes[0]
    || null;
}

/**
 * Obtiene todos los archivos del proyecto listos para escribirse en el sandbox de compilación.
 * Los archivos de texto salen de la base de datos (versión más reciente); los binarios de Storage.
 */
async function getProjectFilesForCompilation(nodes, overrides = new Map()) {
  const relativePaths = buildRelativePaths(nodes);

  return Promise.all(nodes.map(async (node) => {
    const filePath = relativePaths.get(node.id);
    if (node.tipo_nodo === 'carpeta') return { path: filePath, isDirectory: true };

    if (overrides.has(node.id)) return { path: filePath, content: overrides.get(node.id) };

    if (isTextFile(node.nombre) && node.contenido_actual) {
      return { path: filePath, content: node.contenido_actual };
    }

    const stored = node.storage_path ? await storageService.downloadFile(node.storage_path) : null;
    return { path: filePath, content: stored || Buffer.from(node.contenido_actual || '', 'utf8') };
  }));
}

/**
 * Guarda en Storage el archivo de un nodo en su ruta nueva, con el mismo formato que al crear archivos
 * (createProjectNode). Los de texto se vuelven a subir desde contenido_actual, así no dependen de que
 * el objeto anterior exista en el bucket; los binarios se mueven.
 */
async function relocateNodeFile(node, newPath) {
  const oldPath = node.storage_path || null;
  if (oldPath === newPath) return;

  if (isTextFile(node.nombre) && typeof node.contenido_actual === 'string') {
    await storageService.uploadBinary(newPath, Buffer.from(node.contenido_actual, 'utf8'), 'text/plain; charset=utf-8');
    if (oldPath) await storageService.removeFiles([oldPath]).catch(() => {});
  } else if (oldPath) {
    try {
      await storageService.moveFile(oldPath, newPath);
    } catch (err) {
      // El objeto no estaba en la ruta registrada: si se puede leer, copiarlo; si no, solo se actualiza la ruta
      const data = await storageService.downloadFile(oldPath);
      if (data) {
        await storageService.uploadBinary(newPath, data, getMimeType(node.nombre));
        await storageService.removeFiles([oldPath]).catch(() => {});
      } else {
        console.warn(`Advertencia: el archivo ${oldPath} no existe en Storage (${err.message})`);
      }
    }
  }

  const { error } = await supabase.from('nodos').update({ storage_path: newPath }).eq('id', node.id);
  if (error) throw error;
}

/**
 * Tras renombrar o mover un nodo, lleva a su ruta nueva en Storage el archivo (o todos los archivos
 * de la carpeta y sus subcarpetas), calculando las rutas desde el árbol igual que al crearlos.
 */
async function syncSubtreeStorage(projectId, rootNodeId) {
  const { data: nodes, error } = await supabase.from('nodos')
    .select('id, padre_id, nombre, tipo_nodo, contenido_actual, storage_path')
    .eq('proyecto_id', projectId);
  if (error) throw error;

  const relativePaths = buildRelativePaths(nodes || []);
  const byId = new Map((nodes || []).map(node => [node.id, node]));
  const isInSubtree = (node) => {
    for (let current = node, depth = 0; current && depth < 64; current = byId.get(current.padre_id), depth++) {
      if (current.id === rootNodeId) return true;
    }
    return false;
  };

  for (const node of nodes || []) {
    if (node.tipo_nodo !== 'archivo' || !isInSubtree(node)) continue;
    await relocateNodeFile(node, storageService.getNestedFilePath(projectId, relativePaths.get(node.id)));
  }
}

async function findNameConflict(projectId, parentId, name, excludeId = null) {
  let query = supabase.from('nodos').select('id, nombre').eq('proyecto_id', projectId);
  query = parentId ? query.eq('padre_id', parentId) : query.is('padre_id', null);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).some(node => node.id !== excludeId && node.nombre.toLowerCase() === name.toLowerCase());
}

/**
 * Última compilación del proyecto (y última exitosa con PDF). Se consulta por proyecto para que el
 * PDF se muestre sin importar qué archivo del proyecto esté abierto en el editor.
 */
async function getProjectCompilations(projectId) {
  const { data: lastCompilation } = await supabase
    .from('compilaciones')
    .select('id, archivo_principal_id, estado, pdf_output_path, iniciado_en, finalizado_en')
    .eq('proyecto_id', projectId)
    .order('iniciado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastSuccessfulCompilation } = await supabase
    .from('compilaciones')
    .select('id, archivo_principal_id, pdf_output_path, finalizado_en')
    .eq('proyecto_id', projectId)
    .eq('estado', 'exitosa')
    .not('pdf_output_path', 'is', null)
    .order('iniciado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { lastCompilation, lastSuccessfulCompilation };
}

function canEdit(role) {
  return role === 'propietario' || role === 'editor';
}

function isMissingOrderColumn(error) {
  return Boolean(error?.message && /column .*orden does not exist/i.test(error.message));
}

/**
 * Helper para verificar permisos y resolver el nodo y proyecto del usuario
 */
async function resolveDocumentAndAccess(documentId, userId) {
  if (!isValidUuid(documentId)) {
    return { error: 'Identificador de documento inválido (debe ser un UUID válido)', status: 400 };
  }

  // 1. Intentar buscar como nodo (archivo tex)
  let { data: node, error: nodeError } = await supabase
    .from('nodos')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();

  if (nodeError) throw nodeError;

  let project = null;

  // 2. Si no se encontró como nodo, intentar buscar como proyecto
  if (!node) {
    const { data: proj, error: projError } = await supabase
      .from('proyectos')
      .select('*')
      .eq('id', documentId)
      .maybeSingle();

    if (projError) throw projError;

    if (proj) {
      project = proj;
      // Obtener el nodo .tex principal de este proyecto
      const { data: mainNode, error: mainError } = await supabase
        .from('nodos')
        .select('*')
        .eq('proyecto_id', proj.id)
        .eq('tipo_nodo', 'archivo')
        .eq('tipo_archivo', 'tex')
        .is('padre_id', null)
        .order('creado_en', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (mainError) throw mainError;
      node = mainNode;
    }
  } else {
    // Si se encontró como nodo, obtener su proyecto
    const { data: proj, error: projError } = await supabase
      .from('proyectos')
      .select('*')
      .eq('id', node.proyecto_id)
      .maybeSingle();

    if (projError) throw projError;
    project = proj;
  }

  if (!node || !project) {
    return { error: 'Documento no encontrado', status: 404 };
  }

  // 3. Verificar si el usuario tiene acceso (es propietario o miembro del proyecto)
  if (project.propietario_id === userId) {
    return { node, project, role: 'propietario' };
  }

  const { data: membership, error: memberError } = await supabase
    .from('miembros_proyecto')
    .select('rol')
    .eq('proyecto_id', project.id)
    .eq('usuario_id', userId)
    .maybeSingle();

  if (memberError) throw memberError;

  if (!membership) {
    return { error: 'No tienes permisos para acceder a este documento', status: 403 };
  }

  return { node, project, role: membership.rol };
}

/**
 * CREAR DOCUMENTO
 * POST /api/documents
 */
exports.createDocument = async (req, res, next) => {
  try {
    const { name, content, description } = req.body;
    const userId = req.user.id;

    const rawName = (name && name.trim()) || 'documento.tex';
    const cleanProjectName = rawName.replace(/\.tex$/i, '');
    const fileName = rawName.toLowerCase().endsWith('.tex') ? rawName : `${cleanProjectName}.tex`;
    const initialContent = typeof content === 'string' ? content : DEFAULT_LATEX_TEMPLATE;
    const sizeBytes = Buffer.byteLength(initialContent, 'utf8');

    // 1. Crear el proyecto contenedor
    const { data: project, error: projError } = await supabase
      .from('proyectos')
      .insert({
        propietario_id: userId,
        nombre: cleanProjectName,
        descripcion: description || null
      })
      .select('*')
      .single();

    if (projError) throw projError;

    // 2. Asignar rol de propietario en miembros_proyecto
    const { error: memberError } = await supabase
      .from('miembros_proyecto')
      .insert({
        proyecto_id: project.id,
        usuario_id: userId,
        rol: 'propietario'
      });

    if (memberError) {
      console.warn('Advertencia al insertar miembro de proyecto:', memberError.message);
    }

    // 3. Crear el nodo de archivo principal .tex
    const { data: node, error: nodeError } = await supabase
      .from('nodos')
      .insert({
        proyecto_id: project.id,
        padre_id: null,
        nombre: fileName,
        tipo_nodo: 'archivo',
        tipo_archivo: 'tex',
        contenido_actual: initialContent,
        tamano_bytes: sizeBytes,
        creado_por: userId
      })
      .select('*')
      .single();

    if (nodeError) throw nodeError;

    // 4. Guardar snapshot inicial en versiones_archivo
    await supabase
      .from('versiones_archivo')
      .insert({
        archivo_id: node.id,
        numero_version: 1,
        contenido_snapshot: initialContent,
        modificado_por: userId,
        resumen_cambio: 'Creación inicial del documento'
      });

    // 5. Guardar el archivo .tex en Supabase Storage
    await storageService.syncNodeSource(node, initialContent);

    return res.status(201).json({
      message: 'Documento creado exitosamente',
      document: {
        id: node.id,
        projectId: project.id,
        name: node.nombre,
        content: node.contenido_actual,
        sizeBytes: node.tamano_bytes,
        createdAt: node.creado_en,
        updatedAt: node.actualizado_en
      }
    });

  } catch (error) {
    next(error);
  }
};

exports.listProjectTree = async (req, res, next) => {
  try {
    const access = await resolveProjectAccess(req.params.projectId, req.user.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    let query = supabase.from('nodos')
      .select('id, proyecto_id, padre_id, nombre, tipo_nodo, tipo_archivo, contenido_actual, tamano_bytes, creado_en, actualizado_en, storage_path, orden')
      .eq('proyecto_id', access.project.id).order('orden', { ascending: true }).order('nombre', { ascending: true });
    let { data: nodes, error } = await query;
    if (isMissingOrderColumn(error)) {
      ({ data: nodes, error } = await supabase.from('nodos')
        .select('id, proyecto_id, padre_id, nombre, tipo_nodo, contenido_actual, tamano_bytes, creado_en, actualizado_en, storage_path')
        .eq('proyecto_id', access.project.id).order('nombre', { ascending: true }));
    }
    if (error) throw error;
    return res.json({ project: { id: access.project.id, name: access.project.nombre }, role: access.role, nodes: nodes || [] });
  } catch (error) {
    next(error);
  }
};

exports.createProjectNode = async (req, res, next) => {
  try {
    const { name, nodeType = 'archivo', parentId = null, content = '', dataBase64, mimeType } = req.body;
    const access = await resolveProjectAccess(req.params.projectId, req.user.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!canEdit(access.role)) return res.status(403).json({ error: 'No tienes permisos para modificar este proyecto' });
    const cleanName = String(name || '').trim();
    if (!isValidNodeName(cleanName)) {
      return res.status(400).json({ error: 'El nombre del archivo o carpeta no es válido (no uses / \\ : * ? " < > | ni los nombres "." o "..")' });
    }
    if (!['archivo', 'carpeta'].includes(nodeType)) return res.status(400).json({ error: 'Tipo de nodo inválido' });
    if (await findNameConflict(access.project.id, parentId, cleanName)) {
      return res.status(409).json({ error: `Ya existe un archivo o carpeta llamado "${cleanName}" en esta ubicación` });
    }
    let parentPath = '';
    if (parentId) {
      const { data: parent } = await supabase.from('nodos').select('id, proyecto_id, tipo_nodo, padre_id, nombre')
        .eq('id', parentId).maybeSingle();
      if (!parent || parent.proyecto_id !== access.project.id || parent.tipo_nodo !== 'carpeta') {
        return res.status(400).json({ error: 'La carpeta de destino no es válida' });
      }
      const allNodes = (await supabase.from('nodos').select('id, padre_id, nombre').eq('proyecto_id', access.project.id)).data || [];
      const byId = new Map(allNodes.map(node => [node.id, node]));
      let current = parent;
      const parts = [];
      while (current) {
        parts.unshift(current.nombre);
        current = byId.get(current.padre_id);
      }
      parentPath = parts.join('/');
    }
    const fileType = nodeType === 'archivo' ? getFileType(cleanName) : null;
    const isText = nodeType === 'archivo' && isTextFile(cleanName);
    const buffer = dataBase64 ? Buffer.from(dataBase64, 'base64') : Buffer.from(typeof content === 'string' ? content : '', 'utf8');
    // Archivos de texto (.tex, .bib, .csv, .sty...) se guardan también en contenido_actual para editarlos y compilarlos;
    // los binarios (imágenes, PDFs...) viven solo en Storage para no corromperlos.
    const textContent = isText ? buffer.toString('utf8').replace(/^﻿/, '') : null;
    const storagePath = nodeType === 'archivo'
      ? storageService.getNestedFilePath(access.project.id, parentPath ? `${parentPath}/${cleanName}` : cleanName)
      : null;
    const { data: node, error } = await supabase.from('nodos').insert({
      proyecto_id: access.project.id, padre_id: parentId, nombre: cleanName, tipo_nodo: nodeType,
      tipo_archivo: fileType, contenido_actual: textContent, storage_path: storagePath,
      tamano_bytes: nodeType === 'archivo' ? buffer.length : null, creado_por: req.user.id
    }).select('*').single();
    if (error) throw error;
    if (nodeType === 'archivo') {
      await storageService.uploadBinary(storagePath, buffer, isText ? 'text/plain; charset=utf-8' : (mimeType || getMimeType(cleanName)));
    }
    return res.status(201).json({ node });
  } catch (error) {
    next(error);
  }
};

exports.updateProjectNode = async (req, res, next) => {
  try {
    const access = await resolveProjectAccess(req.params.projectId, req.user.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!canEdit(access.role)) return res.status(403).json({ error: 'No tienes permisos para modificar este proyecto' });
    const { data: node, error: nodeError } = await supabase.from('nodos').select('*')
      .eq('id', req.params.nodeId).eq('proyecto_id', access.project.id).maybeSingle();
    if (nodeError) throw nodeError;
    if (!node) return res.status(404).json({ error: 'Archivo o carpeta no encontrado' });
    const name = String(req.body.name || '').trim();
    if (!isValidNodeName(name)) return res.status(400).json({ error: 'El nombre no es válido' });
    let finalName = name;
    if (node.tipo_nodo === 'archivo') {
      const originalExtension = path.extname(node.nombre);
      const requestedExtension = path.extname(name);
      if (originalExtension && requestedExtension && originalExtension.toLowerCase() !== requestedExtension.toLowerCase()) {
        return res.status(400).json({ error: 'La extensión del archivo no se puede cambiar' });
      }
      if (originalExtension && !requestedExtension) finalName = `${name}${originalExtension}`;
    }
    if (await findNameConflict(access.project.id, node.padre_id, finalName, node.id)) {
      return res.status(409).json({ error: `Ya existe un archivo o carpeta llamado "${finalName}" en esta ubicación` });
    }
    const { error } = await supabase.from('nodos').update({
      nombre: finalName, actualizado_en: new Date().toISOString()
    }).eq('id', node.id);
    if (error) throw error;
    await syncSubtreeStorage(access.project.id, node.id);
    const { data: updated, error: updatedError } = await supabase.from('nodos').select('*').eq('id', node.id).single();
    if (updatedError) throw updatedError;
    return res.json({ node: updated });
  } catch (error) {
    next(error);
  }
};

exports.moveProjectNode = async (req, res, next) => {
  try {
    const access = await resolveProjectAccess(req.params.projectId, req.user.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!canEdit(access.role)) return res.status(403).json({ error: 'No tienes permisos para modificar este proyecto' });
    const parentId = req.body.parentId || null;
    const requestedOrder = Number.isInteger(req.body.order) ? req.body.order : 0;
    const { data: node, error: nodeError } = await supabase.from('nodos').select('*')
      .eq('id', req.params.nodeId).eq('proyecto_id', access.project.id).maybeSingle();
    if (nodeError) throw nodeError;
    if (!node) return res.status(404).json({ error: 'Archivo o carpeta no encontrado' });
    let { data: allNodes, error: allNodesError } = await supabase.from('nodos')
      .select('id, padre_id, nombre, tipo_nodo, storage_path, orden').eq('proyecto_id', access.project.id);
    const supportsOrder = !isMissingOrderColumn(allNodesError);
    if (!supportsOrder) {
      ({ data: allNodes, error: allNodesError } = await supabase.from('nodos')
        .select('id, padre_id, nombre, tipo_nodo, storage_path').eq('proyecto_id', access.project.id));
    }
    if (allNodesError) throw allNodesError;
    const nodesById = new Map((allNodes || []).map(item => [item.id, item]));
    if (parentId) {
      const parent = nodesById.get(parentId);
      if (!parent || parent.tipo_nodo !== 'carpeta') return res.status(400).json({ error: 'La carpeta de destino no es válida' });
    }
    let ancestor = parentId;
    while (ancestor) {
      if (ancestor === node.id) return res.status(400).json({ error: 'No puedes mover una carpeta dentro de sí misma' });
      ancestor = nodesById.get(ancestor)?.padre_id || null;
    }
    if (node.padre_id !== parentId && await findNameConflict(access.project.id, parentId, node.nombre, node.id)) {
      return res.status(409).json({ error: `Ya existe un archivo o carpeta llamado "${node.nombre}" en la carpeta de destino` });
    }
    let siblingsQuery = supabase.from('nodos').select(supportsOrder ? 'id, orden' : 'id')
      .eq('proyecto_id', access.project.id).eq('padre_id', parentId).neq('id', node.id);
    if (supportsOrder) siblingsQuery = siblingsQuery.order('orden', { ascending: true });
    else siblingsQuery = siblingsQuery.order('nombre', { ascending: true });
    const { data: siblings } = await siblingsQuery;
    const boundedOrder = Math.max(0, Math.min(requestedOrder, (siblings || []).length));
    if (supportsOrder) {
      for (let index = 0; index < (siblings || []).length; index += 1) {
        const sibling = siblings[index];
        const order = index >= boundedOrder ? index + 1 : index;
        const { error } = await supabase.from('nodos').update({ orden: order }).eq('id', sibling.id);
        if (error) throw error;
      }
    }
    const moveUpdates = {
      padre_id: parentId,
      actualizado_en: new Date().toISOString()
    };
    if (supportsOrder) moveUpdates.orden = boundedOrder;
    const { error: moveError } = await supabase.from('nodos').update(moveUpdates).eq('id', node.id);
    if (moveError) throw moveError;
    // Mover también el archivo (o los de la carpeta) en Storage a la nueva ruta
    if (node.padre_id !== parentId) await syncSubtreeStorage(access.project.id, node.id);
    const { data: moved, error: movedError } = await supabase.from('nodos').select('*').eq('id', node.id).single();
    if (movedError) throw movedError;
    return res.json({ node: moved });
  } catch (error) {
    next(error);
  }
};

exports.deleteProjectNode = async (req, res, next) => {
  try {
    const access = await resolveProjectAccess(req.params.projectId, req.user.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    if (!canEdit(access.role)) return res.status(403).json({ error: 'No tienes permisos para modificar este proyecto' });
    const { data: allNodes, error: nodesError } = await supabase.from('nodos').select('id, padre_id, storage_path')
      .eq('proyecto_id', access.project.id);
    if (nodesError) throw nodesError;
    const ids = new Set([req.params.nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      (allNodes || []).forEach(node => {
        if (ids.has(node.padre_id) && !ids.has(node.id)) {
          ids.add(node.id);
          changed = true;
        }
      });
    }
    const storagePaths = (allNodes || []).filter(node => ids.has(node.id) && node.storage_path).map(node => node.storage_path);
    await storageService.removeFiles(storagePaths);
    const nodeIds = Array.from(ids);

    // These tables reference nodos without ON DELETE CASCADE. Remove their
    // records first so deleting the tree cannot leave a partial state.
    for (const table of ['compilaciones', 'versiones_archivo', 'estados_autoguardado', 'permisos_archivo', 'sesiones_edicion']) {
      const column = table === 'compilaciones' ? 'archivo_principal_id' : table === 'permisos_archivo' ? 'nodo_id' : 'archivo_id';
      const { error } = await supabase.from(table).delete().in(column, nodeIds);
      if (error) throw error;
    }

    const { data: comments, error: commentsError } = await supabase
      .from('comentarios')
      .select('id, archivo_id, comentario_padre_id')
      .in('archivo_id', nodeIds);
    if (commentsError) throw commentsError;
    const commentIds = new Set((comments || []).map(comment => comment.id));
    const commentsToDelete = (comments || []).sort((left, right) => {
      const depth = (comment) => {
        let value = 0;
        let current = comment;
        while (current?.comentario_padre_id && commentIds.has(current.comentario_padre_id)) {
          value += 1;
          current = comments.find(item => item.id === current.comentario_padre_id);
        }
        return value;
      };
      return depth(right) - depth(left);
    });
    for (const comment of commentsToDelete) {
      const { error } = await supabase.from('comentarios').delete().eq('id', comment.id);
      if (error) throw error;
    }

    const nodesById = new Map((allNodes || []).map(node => [node.id, node]));
    const deletionOrder = Array.from(ids).sort((left, right) => {
      let leftDepth = 0;
      let rightDepth = 0;
      let current = nodesById.get(left);
      while (current?.padre_id) {
        leftDepth += 1;
        current = nodesById.get(current.padre_id);
      }
      current = nodesById.get(right);
      while (current?.padre_id) {
        rightDepth += 1;
        current = nodesById.get(current.padre_id);
      }
      return rightDepth - leftDepth;
    });
    for (const nodeId of deletionOrder) {
      const { error } = await supabase.from('nodos').delete().eq('id', nodeId).eq('proyecto_id', access.project.id);
      if (error) throw error;
    }
    return res.json({ message: 'Elemento eliminado correctamente' });
  } catch (error) {
    next(error);
  }
};

exports.downloadProjectNode = async (req, res, next) => {
  try {
    const access = await resolveProjectAccess(req.params.projectId, req.user.id);
    if (access.error) return res.status(access.status).json({ error: access.error });
    const { data: node, error } = await supabase.from('nodos').select('nombre, tipo_nodo, storage_path, contenido_actual')
      .eq('id', req.params.nodeId).eq('proyecto_id', access.project.id).maybeSingle();
    if (error) throw error;
    if (!node || node.tipo_nodo !== 'archivo') return res.status(404).json({ error: 'Archivo no encontrado' });
    const buffer = node.storage_path ? await storageService.downloadFile(node.storage_path) : Buffer.from(node.contenido_actual || '', 'utf8');
    if (!buffer) return res.status(404).json({ error: 'El archivo no está disponible' });
    const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(node.nombre)}"`);
    res.setHeader('Content-Type', getMimeType(node.nombre));
    return res.send(buffer);
  } catch (error) {
    next(error);
  }
};

/**
 * LISTAR DOCUMENTOS
 * GET /api/documents
 */
exports.listDocuments = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // 1. Obtener proyectos propios
    const { data: ownedProjects, error: ownedErr } = await supabase
      .from('proyectos')
      .select('id, nombre, descripcion, esta_archivado, creado_en, actualizado_en')
      .eq('propietario_id', userId)
      .eq('esta_archivado', false);

    if (ownedErr) throw ownedErr;

    // 2. Obtener proyectos compartidos
    const { data: sharedMemberships, error: sharedErr } = await supabase
      .from('miembros_proyecto')
      .select('proyecto_id, rol, proyectos(id, nombre, descripcion, esta_archivado, creado_en, actualizado_en)')
      .eq('usuario_id', userId);

    if (sharedErr) throw sharedErr;

    const projectMap = new Map();
    (ownedProjects || []).forEach(p => projectMap.set(p.id, { ...p, role: 'propietario' }));
    (sharedMemberships || []).forEach(m => {
      if (m.proyectos && !m.proyectos.esta_archivado && !projectMap.has(m.proyectos.id)) {
        projectMap.set(m.proyectos.id, { ...m.proyectos, role: m.rol });
      }
    });

    const projectIds = Array.from(projectMap.keys());
    if (projectIds.length === 0) {
      return res.json({ documents: [] });
    }

    // 3. Obtener nodos principales .tex de estos proyectos
    const { data: nodes, error: nodesErr } = await supabase
      .from('nodos')
      .select('id, proyecto_id, nombre, tamano_bytes, creado_en, actualizado_en')
      .in('proyecto_id', projectIds)
      .eq('tipo_nodo', 'archivo')
      .eq('tipo_archivo', 'tex')
      .is('padre_id', null)
      .order('actualizado_en', { ascending: false });

    if (nodesErr) throw nodesErr;

    // 4. Obtener última compilación de cada nodo
    const nodeIds = (nodes || []).map(n => n.id);
    let latestCompilations = new Map();

    if (nodeIds.length > 0) {
      const { data: comps } = await supabase
        .from('compilaciones')
        .select('id, archivo_principal_id, estado, iniciado_en, finalizado_en')
        .in('archivo_principal_id', nodeIds)
        .order('iniciado_en', { ascending: false });

      (comps || []).forEach(c => {
        if (!latestCompilations.has(c.archivo_principal_id)) {
          latestCompilations.set(c.archivo_principal_id, c);
        }
      });
    }

    const documents = (nodes || []).map(node => {
      const proj = projectMap.get(node.proyecto_id) || {};
      const comp = latestCompilations.get(node.id);

      return {
        id: node.id,
        projectId: node.proyecto_id,
        projectName: proj.nombre || '',
        name: node.nombre,
        sizeBytes: node.tamano_bytes,
        role: proj.role || 'invitado',
        createdAt: node.creado_en,
        updatedAt: node.actualizado_en || node.creado_en,
        lastCompilation: comp ? {
          id: comp.id,
          status: comp.estado,
          startedAt: comp.iniciado_en,
          finishedAt: comp.finalizado_en
        } : null
      };
    });

    return res.json({ documents });

  } catch (error) {
    next(error);
  }
};

/**
 * OBTENER DOCUMENTO POR ID
 * GET /api/documents/:id
 */
exports.getDocumentById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const access = await resolveDocumentAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { node, project, role } = access;

    // Obtener buffer de autoguardado no confirmado si existe
    const { data: autoSaveRecord } = await supabase
      .from('estados_autoguardado')
      .select('buffer_contenido, guardado_en, esta_sincronizado')
      .eq('archivo_id', node.id)
      .eq('usuario_id', userId)
      .maybeSingle();

    // Última compilación del proyecto y última exitosa (para mantener el PDF disponible aún si la última falló)
    const { lastCompilation, lastSuccessfulCompilation } = await getProjectCompilations(project.id);

    return res.json({
      document: {
        id: node.id,
        projectId: project.id,
        projectName: project.nombre,
        name: node.nombre,
        content: isTextFile(node.nombre) ? node.contenido_actual : null,
        fileType: node.tipo_archivo,
        isText: isTextFile(node.nombre),
        sizeBytes: node.tamano_bytes,
        role,
        createdAt: node.creado_en,
        updatedAt: node.actualizado_en,
        autoSave: autoSaveRecord ? {
          hasUnsavedBuffer: autoSaveRecord.buffer_contenido !== node.contenido_actual,
          bufferContent: autoSaveRecord.buffer_contenido,
          savedAt: autoSaveRecord.guardado_en
        } : null,
        lastCompilation: lastCompilation ? {
          id: lastCompilation.id,
          status: lastCompilation.estado,
          hasPdf: !!lastSuccessfulCompilation,
          pdfUrl: lastSuccessfulCompilation ? `/api/documents/${node.id}/pdf` : null,
          finishedAt: lastCompilation.finalizado_en
        } : null
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * ACTUALIZAR DOCUMENTO (Guardado manual o Autoguardado Ctrl+S)
 * PUT /api/documents/:id
 */
exports.updateDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, content, isAutoSave = false, summary } = req.body;
    const userId = req.user.id;

    const access = await resolveDocumentAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { node, project, role } = access;

    if (role === 'invitado' || role === 'revisor') {
      return res.status(403).json({ error: 'No tienes permisos de edición en este documento' });
    }

    // Guardar texto sobre un binario (imagen, PDF...) lo dejaría corrupto en Storage
    if (typeof content === 'string' && !isTextFile(node.nombre)) {
      return res.status(400).json({ error: 'Este archivo es binario y no se puede editar como texto' });
    }

    const updates = {
      actualizado_en: new Date().toISOString()
    };

    if (name && typeof name === 'string') {
      const cleanName = name.trim();
      if (!isValidNodeName(cleanName)) return res.status(400).json({ error: 'El nombre no es válido' });
      // Conservar la extensión original si el nuevo nombre no trae una
      const originalExtension = path.extname(node.nombre);
      updates.nombre = path.extname(cleanName) || !originalExtension ? cleanName : `${cleanName}${originalExtension}`;
    }

    const hasNewContent = typeof content === 'string';
    if (hasNewContent) {
      updates.contenido_actual = content;
      updates.tamano_bytes = Buffer.byteLength(content, 'utf8');
    }

    // 1. Actualizar nodo principal
    const { data: updatedNode, error: updateError } = await supabase
      .from('nodos')
      .update(updates)
      .eq('id', node.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    // Mantener sincronizada la copia del archivo en Supabase Storage (contenido y nombre)
    if (hasNewContent || updates.nombre) {
      await storageService.syncNodeSource(updatedNode, updatedNode.contenido_actual);
    }

    // 2. Gestionar autoguardado vs versión confirmada
    if (hasNewContent) {
      if (isAutoSave) {
        // Actualizar o crear registro en estados_autoguardado
        const { data: existingAutoSave } = await supabase
          .from('estados_autoguardado')
          .select('id')
          .eq('archivo_id', node.id)
          .eq('usuario_id', userId)
          .maybeSingle();

        if (existingAutoSave) {
          await supabase
            .from('estados_autoguardado')
            .update({
              buffer_contenido: content,
              guardado_en: new Date().toISOString(),
              esta_sincronizado: true
            })
            .eq('id', existingAutoSave.id);
        } else {
          await supabase
            .from('estados_autoguardado')
            .insert({
              archivo_id: node.id,
              usuario_id: userId,
              buffer_contenido: content,
              guardado_en: new Date().toISOString(),
              esta_sincronizado: true
            });
        }
      } else {
        // Guardado manual (Ctrl+S explícito o botón Guardar): crear snapshot en versiones_archivo
        const { data: lastVersion } = await supabase
          .from('versiones_archivo')
          .select('numero_version')
          .eq('archivo_id', node.id)
          .order('numero_version', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextVersion = (lastVersion?.numero_version || 0) + 1;

        await supabase
          .from('versiones_archivo')
          .insert({
            archivo_id: node.id,
            numero_version: nextVersion,
            contenido_snapshot: content,
            modificado_por: userId,
            resumen_cambio: summary || `Versión ${nextVersion} (guardado manual)`
          });
      }
    }

    return res.json({
      message: isAutoSave ? 'Autoguardado exitoso' : 'Documento guardado exitosamente',
      document: {
        id: updatedNode.id,
        name: updatedNode.nombre,
        sizeBytes: updatedNode.tamano_bytes,
        updatedAt: updatedNode.actualizado_en,
        isAutoSave
      }
    });

  } catch (error) {
    next(error);
  }
};

/**
 * ELIMINAR DOCUMENTO
 * DELETE /api/documents/:id
 */
exports.deleteDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const access = await resolveDocumentAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { project, role } = access;

    if (role !== 'propietario') {
      return res.status(403).json({ error: 'Solo el propietario puede eliminar este documento' });
    }

    // Marcar como archivado o eliminar proyecto (lo que cascada nodos)
    const { error: deleteError } = await supabase
      .from('proyectos')
      .update({ esta_archivado: true })
      .eq('id', project.id);

    if (deleteError) throw deleteError;

    return res.json({
      message: 'Documento eliminado exitosamente'
    });

  } catch (error) {
    next(error);
  }
};

/**
 * COMPILAR DOCUMENTO A PDF
 * POST /api/documents/:id/compile
 */
exports.compileDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    const access = await resolveDocumentAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { node, project } = access;

    // El contenido enviado es el del archivo abierto en el editor (solo aplica a archivos de texto)
    const hasNewContent = typeof content === 'string' && isTextFile(node.nombre);

    if (hasNewContent && content !== node.contenido_actual) {
      await supabase
        .from('nodos')
        .update({
          contenido_actual: content,
          tamano_bytes: Buffer.byteLength(content, 'utf8'),
          actualizado_en: new Date().toISOString()
        })
        .eq('id', node.id);

      await storageService.syncNodeSource(node, content);
    }

    // Todos los archivos del proyecto: se compilan juntos para que \input, \include,
    // \includegraphics, \bibliography, \addbibresource, etc. encuentren sus archivos
    const { data: projectNodes, error: nodesError } = await supabase
      .from('nodos')
      .select('id, padre_id, nombre, tipo_nodo, tipo_archivo, contenido_actual, storage_path, creado_en')
      .eq('proyecto_id', project.id);

    if (nodesError) throw nodesError;

    const mainNode = selectMainNode(projectNodes || [], node, hasNewContent ? content : undefined);
    if (!mainNode) {
      return res.status(400).json({ error: 'El proyecto no tiene ningún archivo .tex para compilar' });
    }

    const overrides = new Map(hasNewContent ? [[node.id, content]] : []);
    const projectFiles = await getProjectFilesForCompilation(projectNodes || [], overrides);
    const mainFilePath = buildRelativePaths(projectNodes || []).get(mainNode.id);

    const compilationId = crypto.randomUUID();

    // Registrar inicio de la compilación en base de datos
    await supabase
      .from('compilaciones')
      .insert({
        id: compilationId,
        proyecto_id: project.id,
        archivo_principal_id: mainNode.id,
        estado: 'en_proceso',
        solicitado_por: userId,
        iniciado_en: new Date().toISOString()
      });

    // Ejecutar compilación segura
    const result = await latexService.compileProject(projectFiles, mainFilePath, { compilationId });

    // Actualizar registro en base de datos
    const compilationStatus = result.success ? 'exitosa' : 'error';
    await supabase
      .from('compilaciones')
      .update({
        estado: compilationStatus,
        log_salida: result.log,
        pdf_output_path: result.pdfPath ? path.basename(result.pdfPath) : null,
        finalizado_en: new Date().toISOString()
      })
      .eq('id', compilationId);

    // Guardar el PDF generado en Supabase Storage (el archivo local sigue siendo la copia rápida)
    if (result.success && result.pdfPath) {
      try {
        await storageService.uploadPdf(mainNode, result.pdfPath);
      } catch (err) {
        console.warn('Advertencia al subir el PDF a Storage:', err.message);
      }
    }

    const pdfUrl = result.success ? `/api/documents/${node.id}/pdf` : null;

    // Si la compilación falla, verificar si hay un PDF previo válido disponible para el frontend
    let previousPdfUrl = null;
    if (!result.success) {
      const { lastSuccessfulCompilation: previousValid } = await getProjectCompilations(project.id);

      if (previousValid && previousValid.pdf_output_path) {
        previousPdfUrl = `/api/documents/${node.id}/pdf`;
      }
    }

    return res.status(result.success ? 200 : 422).json({
      success: result.success,
      documentId: node.id,
      mainDocument: { id: mainNode.id, name: mainNode.nombre, path: mainFilePath },
      compilationId,
      pdfUrl,
      previousPdfUrl,
      errors: result.errors,
      warnings: result.warnings,
      compilationTime: result.compilationTime,
      log: result.log
    });

  } catch (error) {
    next(error);
  }
};

/**
 * OBTENER O DESCARGAR PDF COMPILADO
 * GET /api/documents/:id/pdf
 */
exports.getPdf = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isDownload = req.query.download === 'true';

    const access = await resolveDocumentAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { node, project } = access;

    // Buscar la última compilación exitosa del proyecto
    const { lastSuccessfulCompilation: compilation } = await getProjectCompilations(project.id);

    if (!compilation || !compilation.pdf_output_path) {
      return res.status(404).json({
        error: 'No hay ningún PDF compilado disponible para este documento. Ejecuta la compilación primero.'
      });
    }

    const pdfPath = latexService.getCompiledPdfPath(compilation.id);
    const hasLocalPdf = !!pdfPath && fs.existsSync(pdfPath);

    // El PDF lleva el nombre del archivo principal que se compiló (puede no ser el archivo abierto)
    let mainNode = node;
    if (compilation.archivo_principal_id && compilation.archivo_principal_id !== node.id) {
      const { data: compiledNode } = await supabase
        .from('nodos')
        .select('id, proyecto_id, nombre')
        .eq('id', compilation.archivo_principal_id)
        .maybeSingle();
      if (compiledNode) mainNode = compiledNode;
    }

    // Si el PDF local ya no existe (otro servidor, disco limpiado), recuperarlo de Supabase Storage
    const storedPdf = hasLocalPdf
      ? null
      : await storageService.downloadFile(storageService.getPdfPath(mainNode));

    if (!hasLocalPdf && !storedPdf) {
      return res.status(404).json({
        error: 'El archivo PDF generado ya no se encuentra en el almacenamiento. Por favor compila de nuevo.'
      });
    }

    const baseName = mainNode.nombre.replace(/\.[^.]+$/, '');
    const disposition = isDownload ? 'attachment' : 'inline';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(baseName)}.pdf"`);

    if (storedPdf) {
      return res.send(storedPdf);
    }

    const readStream = fs.createReadStream(pdfPath);
    readStream.pipe(res);

  } catch (error) {
    next(error);
  }
};

/**
 * OBTENER O DESCARGAR CÓDIGO FUENTE .TEX
 * GET /api/documents/:id/source
 */
exports.getSource = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isDownload = req.query.download === 'true';

    const access = await resolveDocumentAndAccess(id, userId);
    if (access.error) {
      return res.status(access.status).json({ error: access.error });
    }

    const { node } = access;

    if (isDownload) {
      res.setHeader('Content-Type', getMimeType(node.nombre));
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(node.nombre)}"`);
      return res.send(node.contenido_actual || '');
    }

    return res.json({
      documentId: node.id,
      fileName: node.nombre,
      content: node.contenido_actual || '',
      sizeBytes: node.tamano_bytes,
      updatedAt: node.actualizado_en
    });

  } catch (error) {
    next(error);
  }
};
