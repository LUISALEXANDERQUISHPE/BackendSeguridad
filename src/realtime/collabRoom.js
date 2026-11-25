const Y = require('yjs');

// Nombre del Y.Text compartido dentro de cada Y.Doc (debe coincidir con el frontend)
const TEXT_KEY = 'content';

// Colores asignados a los colaboradores para sus cursores y avatares
const COLLABORATOR_COLORS = Object.freeze([
  '#e8590c', '#2f9e44', '#1971c2', '#c2255c', '#7048e8', '#0c8599', '#e67700', '#5c940d'
]);

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64');
const fromBase64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));

/**
 * Sala de edición colaborativa de un archivo de texto.
 *
 * Mantiene en memoria un documento Yjs (CRDT) con el contenido del archivo: cada cliente envía
 * sus cambios como "updates" de Yjs, la sala los fusiona sin conflictos y los reenvía al resto.
 * El contenido se persiste con "persist" tras un periodo sin cambios y al cerrarse la sala.
 *
 * @param {object} options
 * @param {string} options.documentId Nodo (archivo) que se edita
 * @param {string} options.initialContent Contenido guardado en la base de datos
 * @param {(content: string) => Promise<{ savedAt: string }>} options.persist Guarda el contenido
 * @param {number} [options.persistDelayMs] Espera tras el último cambio antes de guardar
 * @param {number} [options.maxContentBytes] Tamaño máximo permitido del archivo
 * @param {{ warn: Function }} [options.logger]
 */
class CollabRoom {
  constructor({ documentId, initialContent, persist, persistDelayMs = 2000, maxContentBytes = 2 * 1024 * 1024, logger = console }) {
    this.documentId = documentId;
    this.persistFn = persist;
    this.persistDelayMs = persistDelayMs;
    this.maxContentBytes = maxContentBytes;
    this.logger = logger;

    this.doc = new Y.Doc();
    this.text = this.doc.getText(TEXT_KEY);
    this.text.insert(0, initialContent || '');
    this.lastPersisted = this.text.toString();

    /** @type {Map<object, { clientId: number, userId: string, name: string, color: string, canEdit: boolean, cursor: object|null }>} */
    this.clients = new Map();
    this.nextClientId = 1;
    this.persistTimer = null;
    this.persisting = Promise.resolve();

    // Reenviar a los demás clientes cada cambio aplicado (el origen es la conexión que lo envió)
    this.doc.on('update', (update, origin) => {
      this.broadcast({ type: 'update', update: toBase64(update) }, origin);
      this.schedulePersist();
    });
  }

  get size() {
    return this.clients.size;
  }

  /** Lista pública de colaboradores conectados (sin datos sensibles). */
  presence() {
    return [...this.clients.values()].map(({ clientId, userId, name, color, canEdit, cursor }) => ({
      clientId, userId, name, color, canEdit, cursor
    }));
  }

  /**
   * Agrega una conexión a la sala y le envía el estado completo del documento.
   * @param {{ send: (data: string) => void }} socket
   * @param {{ userId: string, name: string, canEdit: boolean }} user
   */
  join(socket, { userId, name, canEdit }) {
    const usedColors = new Set([...this.clients.values()].map((client) => client.color));
    const color = COLLABORATOR_COLORS.find((candidate) => !usedColors.has(candidate))
      || COLLABORATOR_COLORS[this.nextClientId % COLLABORATOR_COLORS.length];

    const client = { clientId: this.nextClientId++, userId, name, color, canEdit, cursor: null };
    this.clients.set(socket, client);

    this.send(socket, {
      type: 'init',
      clientId: client.clientId,
      canEdit,
      state: toBase64(Y.encodeStateAsUpdate(this.doc)),
      users: this.presence()
    });
    this.broadcast({ type: 'presence', users: this.presence() }, socket);
    return client;
  }

  /** Conexiones abiertas de un usuario en esta sala (puede tener varias pestañas). */
  socketsOf(userId) {
    return [...this.clients.entries()].filter(([, client]) => client.userId === userId).map(([socket]) => socket);
  }

  /**
   * Cambia en caliente el permiso de edición de un usuario (ej. el propietario lo pasó de editor a lector).
   * Sus cambios posteriores se rechazan de inmediato, sin esperar a que vuelva a conectarse.
   * @returns {number} Conexiones afectadas
   */
  setUserAccess(userId, canEdit) {
    const sockets = this.socketsOf(userId);
    for (const socket of sockets) {
      this.clients.get(socket).canEdit = canEdit;
      this.send(socket, { type: 'access', canEdit });
    }
    if (sockets.length > 0) this.broadcast({ type: 'presence', users: this.presence() });
    return sockets.length;
  }

  /** Quita la conexión y avisa al resto. */
  leave(socket) {
    if (!this.clients.delete(socket)) return;
    this.broadcast({ type: 'presence', users: this.presence() });
  }

  /**
   * Procesa un mensaje recibido de un cliente ya unido a la sala.
   * @param {object} socket
   * @param {{ type: string, update?: string, cursor?: object|null }} message
   */
  handleMessage(socket, message) {
    const client = this.clients.get(socket);
    if (!client || !message || typeof message !== 'object') return;

    if (message.type === 'update' && typeof message.update === 'string') {
      if (!client.canEdit) {
        this.send(socket, { type: 'error', message: 'No tienes permisos de edición en este documento' });
        return;
      }
      Y.applyUpdate(this.doc, fromBase64(message.update), socket);
      return;
    }

    if (message.type === 'cursor') {
      client.cursor = isValidCursor(message.cursor) ? message.cursor : null;
      this.broadcast({ type: 'cursor', clientId: client.clientId, cursor: client.cursor }, socket);
    }
  }

  send(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      this.logger.warn('[collab] No se pudo enviar un mensaje:', error.message);
    }
  }

  broadcast(payload, exceptSocket = null) {
    const data = JSON.stringify(payload);
    for (const socket of this.clients.keys()) {
      if (socket === exceptSocket) continue;
      try {
        socket.send(data);
      } catch (error) {
        this.logger.warn('[collab] No se pudo reenviar un mensaje:', error.message);
      }
    }
  }

  schedulePersist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush();
    }, this.persistDelayMs);
  }

  /**
   * Guarda el contenido actual si cambió desde el último guardado.
   * Los guardados se encadenan para que nunca se escriban en desorden.
   */
  flush() {
    clearTimeout(this.persistTimer);
    this.persistTimer = null;

    this.persisting = this.persisting.then(async () => {
      const content = this.text.toString();
      if (content === this.lastPersisted) return;

      if (Buffer.byteLength(content, 'utf8') > this.maxContentBytes) {
        this.broadcast({ type: 'error', message: 'El archivo supera el tamaño máximo permitido y no se guardará' });
        return;
      }

      try {
        const { savedAt } = await this.persistFn(content);
        this.lastPersisted = content;
        this.broadcast({ type: 'saved', savedAt });
      } catch (error) {
        this.logger.warn(`[collab] Error al guardar el documento ${this.documentId}:`, error.message);
        this.broadcast({ type: 'save-error', message: 'No fue posible guardar los cambios' });
      }
    });
    return this.persisting;
  }

  /** Guarda los cambios pendientes y libera el documento. */
  async close() {
    await this.flush();
    this.doc.destroy();
  }
}

/** Un cursor es { anchor, head } con posiciones relativas de Yjs serializadas en JSON. */
function isValidCursor(cursor) {
  if (!cursor || typeof cursor !== 'object') return false;
  const isPosition = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  return isPosition(cursor.anchor) && isPosition(cursor.head) && JSON.stringify(cursor).length <= 1024;
}

module.exports = { CollabRoom, TEXT_KEY, toBase64, fromBase64 };
