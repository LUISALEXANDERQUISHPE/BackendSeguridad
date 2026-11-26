const { createClient } = require('@supabase/supabase-js');
const config = require('./index');
const { createSecureDatabaseClient } = require('../security/database/secureDatabaseClient');

if (!config.supabaseUrl || !config.supabaseSecretKey) {
  throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en el archivo .env');
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
};

/** Cliente directo, SIN cifrado. Solo para la capa de seguridad (llaves) y la migración de datos. */
const rawClient = createClient(config.supabaseUrl, config.supabaseSecretKey, clientOptions);

/**
 * Cliente nuevo y desechable para iniciar sesión con correo y contraseña.
 *
 * signInWithPassword guarda la sesión del usuario en el cliente que lo ejecuta: si se usara el
 * cliente compartido, a partir de ese momento TODO el backend haría sus consultas como ese
 * usuario (y no con la clave de servicio), mezclando identidades entre peticiones.
 */
const createAuthClient = () => createClient(config.supabaseUrl, config.supabaseSecretKey, clientOptions);

/**
 * Cliente que usa todo el backend: cifra al guardar y descifra al leer las columnas con
 * contenido de los usuarios (ver src/security/database/sensitiveColumns.js).
 */
module.exports = createSecureDatabaseClient(
  rawClient,
  () => require('../security').getSecurity(),
  { raw: rawClient, createAuthClient }
);
