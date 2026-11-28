/**
 * Presencia a nivel de proyecto (como los avatares junto a "Compartir" en Overleaf):
 * quién tiene abierto algún archivo del proyecto, aunque cada uno esté en un archivo distinto.
 */

// Mismos tonos que los cursores del editor
const PRESENCE_COLORS = Object.freeze([
  '#e8590c', '#2f9e44', '#1971c2', '#c2255c', '#7048e8', '#0c8599', '#e67700', '#5c940d'
]);

/** Color estable para cada usuario: es el mismo en todos los archivos y para todos los que lo ven. */
function userColor(userId) {
  let hash = 0;
  for (const char of String(userId)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
}

/**
 * Une los conectados de todas las salas (archivos) de un proyecto, una vez por usuario.
 * Si alguien tiene abiertos varios archivos, se informa el primero.
 *
 * @param {Array<{ documentId: string, documentName: string, clients: Array<{ userId: string, name: string, canEdit: boolean }> }>} rooms
 * @returns {Array<{ userId: string, name: string, color: string, canEdit: boolean, documentId: string, documentName: string }>}
 */
function buildProjectPresence(rooms) {
  const users = new Map();
  for (const { documentId, documentName, clients } of rooms) {
    for (const client of clients) {
      if (users.has(client.userId)) continue;
      users.set(client.userId, {
        userId: client.userId,
        name: client.name,
        color: userColor(client.userId),
        canEdit: Boolean(client.canEdit),
        documentId,
        documentName
      });
    }
  }
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

module.exports = { buildProjectPresence, userColor };
