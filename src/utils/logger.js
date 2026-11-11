/**
 * Punto único de registro de eventos del servidor.
 * Permite reemplazar la salida (archivo, servicio externo, etc.) sin tocar la lógica de negocio.
 */
const logger = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};

module.exports = logger;
