// Configuración centralizada de la API
module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'DocumentosSecureLeaf',
  latexEngine: process.env.LATEX_ENGINE || 'pdflatex',
  latexTimeoutMs: parseInt(process.env.LATEX_TIMEOUT_MS, 10) || 30000,
  storagePath: process.env.STORAGE_PATH || require('path').join(__dirname, '../../storage'),

  // Cifrado propio (ver src/security). Los valores de Diffie-Hellman deben coincidir con el .env del frontend.
  security: {
    masterKeyHex: process.env.CRYPTO_MASTER_KEY,
    dhPrimeHex: process.env.DH_PRIME_HEX,
    dhGenerator: process.env.DH_GENERATOR || '2',
    sessionTtlMs: parseInt(process.env.SECURE_SESSION_TTL_MS, 10) || 60 * 60 * 1000,
    diagnosticsEnabled: process.env.SECURE_DIAGNOSTICS_ENABLED === 'true'
  }
};

