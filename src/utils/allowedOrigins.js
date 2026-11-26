/**
 * Construye el verificador de orígenes permitidos a partir de una lista separada por comas.
 * Admite comodines en el host, p. ej. "https://*.devtunnels.ms" para el reenvío de puertos de VS Code.
 *
 * @param {string} originsList Ej. "http://localhost:5173,https://*.devtunnels.ms"
 * @returns {(origin: string) => boolean}
 */
function createOriginMatcher(originsList) {
  const patterns = String(originsList || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .map((origin) => {
      const escaped = origin.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+(?:\\.[a-z0-9-]+)*');
      return new RegExp(`^${escaped}$`, 'i');
    });

  return (origin) => patterns.some((pattern) => pattern.test(origin));
}

module.exports = { createOriginMatcher };
