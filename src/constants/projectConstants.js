/**
 * Constantes del módulo de gestión de proyectos (HU-17).
 * Centralizarlas evita "magic strings" repetidos en controladores, servicios y repositorios.
 */
const PROJECT_LIMITS = Object.freeze({
  MAX_NAME_LENGTH: 120,
  MAX_DESCRIPTION_LENGTH: 500,
  MAX_CONTENT_BYTES: 2 * 1024 * 1024,
  COPY_SUFFIX: ' (copia)'
});

const PROJECT_ROLES = Object.freeze({
  OWNER: 'propietario',
  EDITOR: 'editor',
  REVIEWER: 'revisor',
  GUEST: 'invitado'
});

const NODE_TYPES = Object.freeze({
  FILE: 'archivo',
  FOLDER: 'carpeta'
});

const FILE_TYPES = Object.freeze({
  TEX: 'tex'
});

const TEX_EXTENSION = '.tex';

module.exports = {
  PROJECT_LIMITS,
  PROJECT_ROLES,
  NODE_TYPES,
  FILE_TYPES,
  TEX_EXTENSION
};
