const { createClient } = require('@supabase/supabase-js');
const config = require('./index');

if (!config.supabaseUrl || !config.supabaseSecretKey) {
  throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en el archivo .env');
}

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
};

module.exports = createClient(config.supabaseUrl, config.supabaseSecretKey, clientOptions);

/**
 * Cliente nuevo y desechable para iniciar sesión con correo y contraseña.
 *
 * signInWithPassword guarda la sesión del usuario en el cliente que lo ejecuta: si se usara el
 * cliente compartido, a partir de ese momento TODO el backend haría sus consultas como ese
 * usuario (y no con la clave de servicio), mezclando identidades entre peticiones.
 */
module.exports.createAuthClient = () => createClient(config.supabaseUrl, config.supabaseSecretKey, clientOptions);