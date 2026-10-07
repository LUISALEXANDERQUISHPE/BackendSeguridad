const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const supabase = require('../config/supabase');
const latexService = require('../services/latexService');
const storageService = require('../services/storageService');

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

    // Obtener la última compilación (estado actual de compilación)
    const { data: lastCompilation } = await supabase
      .from('compilaciones')
      .select('id, estado, pdf_output_path, iniciado_en, finalizado_en')
      .eq('archivo_principal_id', node.id)
      .order('iniciado_en', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Obtener la última compilación exitosa (para mantener el PDF disponible aún si la última falló)
    const { data: lastSuccessfulCompilation } = await supabase
      .from('compilaciones')
      .select('id, pdf_output_path, finalizado_en')
      .eq('archivo_principal_id', node.id)
      .eq('estado', 'exitosa')
      .not('pdf_output_path', 'is', null)
      .order('iniciado_en', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.json({
      document: {
        id: node.id,
        projectId: project.id,
        projectName: project.nombre,
        name: node.nombre,
        content: node.contenido_actual,
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

    const updates = {
      actualizado_en: new Date().toISOString()
    };

    if (name && typeof name === 'string') {
      const cleanName = name.trim();
      updates.nombre = cleanName.toLowerCase().endsWith('.tex') ? cleanName : `${cleanName}.tex`;
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

    // Si se envía código nuevo en el body, usarlo para compilar y actualizar el nodo
    const codeToCompile = typeof content === 'string' ? content : node.contenido_actual;

    if (typeof content === 'string' && content !== node.contenido_actual) {
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

    const compilationId = crypto.randomUUID();

    // Registrar inicio de la compilación en base de datos
    await supabase
      .from('compilaciones')
      .insert({
        id: compilationId,
        proyecto_id: project.id,
        archivo_principal_id: node.id,
        estado: 'en_proceso',
        solicitado_por: userId,
        iniciado_en: new Date().toISOString()
      });

    // Ejecutar compilación segura
    const result = await latexService.compileLatex(codeToCompile, { compilationId });

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
        await storageService.uploadPdf(node, result.pdfPath);
      } catch (err) {
        console.warn('Advertencia al subir el PDF a Storage:', err.message);
      }
    }

    const pdfUrl = result.success ? `/api/documents/${node.id}/pdf` : null;

    // Si la compilación falla, verificar si hay un PDF previo válido disponible para el frontend
    let previousPdfUrl = null;
    if (!result.success) {
      const { data: previousValid } = await supabase
        .from('compilaciones')
        .select('id, pdf_output_path')
        .eq('archivo_principal_id', node.id)
        .eq('estado', 'exitosa')
        .not('pdf_output_path', 'is', null)
        .order('iniciado_en', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (previousValid && previousValid.pdf_output_path) {
        previousPdfUrl = `/api/documents/${node.id}/pdf`;
      }
    }

    return res.status(result.success ? 200 : 422).json({
      success: result.success,
      documentId: node.id,
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

    const { node } = access;

    // Buscar la última compilación exitosa
    const { data: compilation, error: compErr } = await supabase
      .from('compilaciones')
      .select('id, pdf_output_path, finalizado_en')
      .eq('archivo_principal_id', node.id)
      .eq('estado', 'exitosa')
      .not('pdf_output_path', 'is', null)
      .order('iniciado_en', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (compErr) throw compErr;

    if (!compilation || !compilation.pdf_output_path) {
      return res.status(404).json({
        error: 'No hay ningún PDF compilado disponible para este documento. Ejecuta la compilación primero.'
      });
    }

    const pdfPath = latexService.getCompiledPdfPath(compilation.id);
    const hasLocalPdf = !!pdfPath && fs.existsSync(pdfPath);

    // Si el PDF local ya no existe (otro servidor, disco limpiado), recuperarlo de Supabase Storage
    const storedPdf = hasLocalPdf
      ? null
      : await storageService.downloadFile(storageService.getPdfPath(node));

    if (!hasLocalPdf && !storedPdf) {
      return res.status(404).json({
        error: 'El archivo PDF generado ya no se encuentra en el almacenamiento. Por favor compila de nuevo.'
      });
    }

    const baseName = node.nombre.replace(/\.tex$/i, '');
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
      res.setHeader('Content-Type', 'application/x-tex; charset=utf-8');
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

