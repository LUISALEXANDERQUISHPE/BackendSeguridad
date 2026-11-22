/**
 * Constantes del control de versiones e historial (HU-23).
 */
const VERSION_LIMITS = Object.freeze({
  MAX_SUMMARY_LENGTH: 200,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  /** Tamaño máximo (en líneas) que se compara, para no bloquear el servidor con archivos enormes. */
  MAX_DIFF_LINES: 20000,
  /** Reintentos si dos guardados simultáneos intentan usar el mismo número de versión. */
  MAX_NUMBER_RETRIES: 3
});

/** Referencia al contenido vigente del archivo al comparar ("versión actual"). */
const CURRENT_VERSION = 'current';

/** Código de PostgreSQL para violación de una restricción de unicidad. */
const PG_UNIQUE_VIOLATION = '23505';

module.exports = {
  VERSION_LIMITS,
  CURRENT_VERSION,
  PG_UNIQUE_VIOLATION
};
