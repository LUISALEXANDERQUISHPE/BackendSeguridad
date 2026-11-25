const { WebSocketServer } = require('ws');
const supabase = require('../config/supabase');
const config = require('../config');
const storageService = require('../services/storageService');
const projectRepository = require('../repositories/projectRepository');
const logger = require('../utils/logger');
const { isValidUuid } = require('../utils/validators');
const { isTextFile } = require('../utils/fileTypes');
const { PROJECT_LIMITS, PROJECT_ROLES } = require('../constants/projectConstants');
const { can, PROJECT_ACTIONS } = require('../constants/permissions');
const { CollabRoom } = require('./collabRoom');
const userNotifier = require('./userNotifier');
const { accessEvents, ACCESS_CHANGED } = require('./accessEvents');

const COLLAB_PATH = '/api/collab';
// Tiempo máximo para que el cliente se identifique después de conectarse
const JOIN_TIMEOUT_MS = 5000;
// Intervalo para detectar y cerrar conexiones muertas
const HEARTBEAT_MS = 30000;
// Un mensaje nunca debería superar el tamaño máximo de un archivo (más el margen de base64)
const MAX_PAYLOAD_BYTES = Math.ceil(PROJECT_LIMITS.MAX_CONTENT_BYTES * 1.5);

/** Códigos de cierre propios (rango 4000-4999 reservado para aplicaciones). */
const CLOSE_CODES = Object.freeze({
  INVALID_MESSAGE: 4400,
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  TIMEOUT: 4408,
  SERVER_ERROR: 4500
});

class CollabAccessError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Verifica el token de Supabase y devuelve el usuario. */
async function authenticate(token) {
  if (typeof token !== 'string' || !token) {
    throw new CollabAccessError('Token no proporcionado', CLOSE_CODES.UNAUTHORIZED);
  }
  const { data: { user } = {}, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    throw new CollabAccessError('Token inválido o expirado', CLOSE_CODES.UNAUTHORIZED);
  }
  return user;
}

/**
 * Verifica el token de Supabase y que el usuario pertenezca al proyecto del archivo.
 * @returns {Promise<{ user: object, node: object, role: string }>}
 */
async function authorize(token, documentId) {
  if (!isValidUuid(documentId)) {
    throw new CollabAccessError('Identificador de documento inválido', CLOSE_CODES.INVALID_MESSAGE);
  }
  const user = await authenticate(token);

  const { data: node, error: nodeError } = await supabase
    .from('nodos')
    .select('*')
    .eq('id', documentId)
    .eq('tipo_nodo', 'archivo')
    .maybeSingle();
  if (nodeError) throw nodeError;
  if (!node || !isTextFile(node.nombre)) {
    throw new CollabAccessError('Documento no encontrado', CLOSE_CODES.NOT_FOUND);
  }

  const project = await projectRepository.findById(node.proyecto_id);
  if (!project) throw new CollabAccessError('Proyecto no encontrado', CLOSE_CODES.NOT_FOUND);

  const role = project.propietario_id === user.id
    ? PROJECT_ROLES.OWNER
    : await projectRepository.findMemberRole(project.id, user.id);
  if (!role) {
    throw new CollabAccessError('No tienes permisos para acceder a este documento', CLOSE_CODES.FORBIDDEN);
  }

  return { user, node, role };
}

/** Nombre visible del colaborador (perfil de la aplicación o, en su defecto, el correo). */
async function resolveDisplayName(user) {
  const { data } = await supabase.from('usuarios').select('nombre_completo').eq('id', user.id).maybeSingle();
  return (data?.nombre_completo || user.user_metadata?.full_name || user.email || 'Colaborador').slice(0, 80);
}

/** Guarda el contenido del archivo en la base de datos y su copia en Supabase Storage. */
async function persistNodeContent(nodeId, content) {
  const savedAt = new Date().toISOString();
  const { data: updatedNode, error } = await supabase
    .from('nodos')
    .update({
      contenido_actual: content,
      tamano_bytes: Buffer.byteLength(content, 'utf8'),
      actualizado_en: savedAt
    })
    .eq('id', nodeId)
    .select('*')
    .single();
  if (error) throw error;

  await storageService.syncNodeSource(updatedNode, content);
  return { savedAt };
}

/**
 * Registro de salas activas (una por archivo abierto). Las salas se crean al unirse el primer
 * colaborador y se cierran (guardando los cambios) cuando se va el último.
 */
function createRoomRegistry() {
  /** @type {Map<string, Promise<CollabRoom>>} */
  const rooms = new Map();
  /** @type {Map<string, Promise<void>>} Salas cerrándose: se espera su guardado antes de recrearlas */
  const closing = new Map();
  /** @type {Map<string, string>} archivo -> proyecto, para aplicar cambios de acceso por proyecto */
  const projectOfRoom = new Map();

  async function acquire(node) {
    await closing.get(node.id);

    if (!rooms.has(node.id)) {
      projectOfRoom.set(node.id, node.proyecto_id);
      const roomPromise = (async () => {
        // Releer el contenido: pudo cambiar mientras la sala anterior se cerraba
        const { data, error } = await supabase.from('nodos').select('contenido_actual').eq('id', node.id).single();
        if (error) throw error;
        return new CollabRoom({
          documentId: node.id,
          initialContent: data.contenido_actual || '',
          persist: (content) => persistNodeContent(node.id, content),
          maxContentBytes: PROJECT_LIMITS.MAX_CONTENT_BYTES,
          logger
        });
      })();
      rooms.set(node.id, roomPromise);
      roomPromise.catch(() => rooms.delete(node.id));
    }

    return rooms.get(node.id);
  }

  function release(room, socket) {
    room.leave(socket);
    if (room.size > 0 || closing.has(room.documentId)) return;

    rooms.delete(room.documentId);
    projectOfRoom.delete(room.documentId);
    const done = room.close()
      .catch((error) => logger.warn('[collab] Error al cerrar la sala:', error.message))
      .finally(() => closing.delete(room.documentId));
    closing.set(room.documentId, done);
  }

  async function closeAll() {
    const all = await Promise.allSettled([...rooms.values()]);
    rooms.clear();
    await Promise.allSettled(all.filter((r) => r.status === 'fulfilled').map((r) => r.value.close()));
    await Promise.allSettled([...closing.values()]);
  }

  /**
   * Aplica en caliente un cambio de rol (o la pérdida del acceso) a las salas abiertas del proyecto.
   * @param {{ projectId: string, userId: string, role: string|null }} change
   */
  async function applyAccessChange({ projectId, userId, role }) {
    const roomIds = [...projectOfRoom].filter(([, project]) => project === projectId).map(([documentId]) => documentId);
    for (const documentId of roomIds) {
      const room = await rooms.get(documentId)?.catch(() => null);
      if (!room) continue;
      if (!can(role, PROJECT_ACTIONS.VIEW)) {
        // Sin acceso: se cierran sus conexiones (el cierre libera la sala si queda vacía)
        for (const socket of room.socketsOf(userId)) {
          socket.close(CLOSE_CODES.FORBIDDEN, 'Ya no tienes acceso a este proyecto');
        }
      } else {
        room.setUserAccess(userId, can(role, PROJECT_ACTIONS.EDIT_CONTENT));
      }
    }
  }

  return { acquire, release, closeAll, applyAccessChange };
}

/**
 * Habilita la edición colaborativa en tiempo real sobre el servidor HTTP existente.
 *
 * Protocolo (mensajes JSON). El primer mensaje decide el tipo de conexión:
 *  - { type: 'subscribe', token }: avisos del usuario (ej. 'project-shared' al compartirle un proyecto).
 *  - Cliente -> servidor: { type: 'join', documentId, token } para editar un archivo,
 *    { type: 'update', update } (cambio Yjs en base64), { type: 'cursor', cursor }.
 *  - Servidor -> cliente: init, update, presence, cursor, saved, save-error, error.
 *
 * El token viaja en el primer mensaje y no en la URL para que no quede registrado en logs de proxies.
 *
 * @param {import('http').Server} httpServer
 */
function attachCollabServer(httpServer) {
  const registry = createRoomRegistry();
  const allowedOrigins = new Set(String(config.corsOrigin).split(',').map((origin) => origin.trim()));

  const wss = new WebSocketServer({
    server: httpServer,
    path: COLLAB_PATH,
    maxPayload: MAX_PAYLOAD_BYTES,
    // Evita que otra página web abra conexiones usando la sesión del usuario (CSWSH)
    verifyClient: ({ origin }) => !origin || allowedOrigins.has(origin)
  });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    let room = null;
    let joining = false;
    let subscribedUserId = null;

    const joinTimer = setTimeout(() => {
      if (!room && !subscribedUserId) socket.close(CLOSE_CODES.TIMEOUT, 'Tiempo de espera agotado');
    }, JOIN_TIMEOUT_MS);

    socket.on('message', async (raw, isBinary) => {
      let message;
      try {
        if (isBinary) throw new Error('binario');
        message = JSON.parse(raw.toString());
      } catch {
        socket.close(CLOSE_CODES.INVALID_MESSAGE, 'Mensaje inválido');
        return;
      }

      // Conexión de notificaciones: el cliente no envía nada más después de suscribirse
      if (subscribedUserId) return;

      if (room) {
        try {
          room.handleMessage(socket, message);
        } catch (error) {
          logger.warn('[collab] Cambio rechazado:', error.message);
          socket.close(CLOSE_CODES.INVALID_MESSAGE, 'Cambio inválido');
        }
        return;
      }

      if (joining) return;
      if (message?.type !== 'join' && message?.type !== 'subscribe') {
        socket.close(CLOSE_CODES.INVALID_MESSAGE, 'Se esperaba el mensaje join o subscribe');
        return;
      }

      joining = true;
      try {
        if (message.type === 'subscribe') {
          const user = await authenticate(message.token);
          if (socket.readyState !== socket.OPEN) return;
          clearTimeout(joinTimer);
          subscribedUserId = user.id;
          userNotifier.subscribe(user.id, socket);
          socket.send(JSON.stringify({ type: 'subscribed' }));
          return;
        }

        const { user, node, role } = await authorize(message.token, message.documentId);
        const name = await resolveDisplayName(user);
        const acquired = await registry.acquire(node);
        if (socket.readyState !== socket.OPEN) {
          // El cliente se fue mientras se preparaba la sala: liberarla si quedó vacía
          registry.release(acquired, socket);
          return;
        }

        clearTimeout(joinTimer);
        room = acquired;
        room.join(socket, { userId: user.id, name, canEdit: can(role, PROJECT_ACTIONS.EDIT_CONTENT) });
      } catch (error) {
        clearTimeout(joinTimer);
        if (error instanceof CollabAccessError) {
          socket.close(error.code, error.message);
        } else {
          logger.error('[collab] Error al unirse a la sala:', error.message);
          socket.close(CLOSE_CODES.SERVER_ERROR, 'Error interno');
        }
      }
    });

    socket.on('close', () => {
      clearTimeout(joinTimer);
      if (room) registry.release(room, socket);
      if (subscribedUserId) userNotifier.unsubscribe(subscribedUserId, socket);
      room = null;
      subscribedUserId = null;
    });

    socket.on('error', (error) => logger.warn('[collab] Error de conexión:', error.message));
  });

  // Ping periódico: las conexiones que no responden se cierran y liberan su sala
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));

  // HU-25: cambios de rol y accesos revocados se aplican a las conexiones abiertas
  const onAccessChanged = (change) => {
    registry.applyAccessChange(change)
      .catch((error) => logger.warn('[collab] No se pudo aplicar el cambio de acceso:', error.message));
  };
  accessEvents.on(ACCESS_CHANGED, onAccessChanged);

  return {
    wss,
    async close() {
      accessEvents.off(ACCESS_CHANGED, onAccessChanged);
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.close(1001, 'Servidor detenido');
      await registry.closeAll();
      wss.close();
    }
  };
}

module.exports = { attachCollabServer, COLLAB_PATH };
