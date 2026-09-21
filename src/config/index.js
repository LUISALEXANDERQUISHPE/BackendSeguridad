// Configuración centralizada de la API
module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  latexEngine: process.env.LATEX_ENGINE || 'pdflatex',
  latexTimeoutMs: parseInt(process.env.LATEX_TIMEOUT_MS, 10) || 30000,
  storagePath: process.env.STORAGE_PATH || require('path').join(__dirname, '../../storage')
};

