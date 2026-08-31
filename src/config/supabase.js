const { createClient } = require('@supabase/supabase-js');
const config = require('./index');

if (!config.supabaseUrl || !config.supabaseSecretKey) {
  throw new Error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY en el archivo .env');
}

module.exports = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});