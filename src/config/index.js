// Configuración centralizada de la API

/**
 * Valor de "trust proxy" de Express: número de saltos ("1"), true/false o lista de IPs/subredes.
 * Detrás de un proxy inverso permite que req.ip sea la IP real del cliente y no la del proxy.
 */
function parseTrustProxy(value) {
  const raw = (value || '').trim();
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

module.exports = {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // Proxys de confianza delante del backend (ej. "1" con Caddy/Nginx). Sin definir: ninguno.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'DocumentosSecureLeaf',
  latexEngine: process.env.LATEX_ENGINE || 'pdflatex',
  latexTimeoutMs: parseInt(process.env.LATEX_TIMEOUT_MS, 10) || 30000,

  // Cifrado propio (ver src/security). Los valores de Diffie-Hellman deben coincidir con el .env del frontend.
  security: {
    masterKeyHex: process.env.CRYPTO_MASTER_KEY,
    dhPrimeHex: process.env.DH_PRIME_HEX,
    dhGenerator: process.env.DH_GENERATOR || '2',
    sessionTtlMs: parseInt(process.env.SECURE_SESSION_TTL_MS, 10) || 60 * 60 * 1000,
    diagnosticsEnabled: process.env.SECURE_DIAGNOSTICS_ENABLED === 'true',
    // true: la API solo acepta peticiones por el túnel cifrado (excepto el acuerdo de llave y /health)
    transportRequired: process.env.SECURE_TRANSPORT_REQUIRED !== 'false',
    // Tamaño máximo de una petición cifrada (los archivos van en base64 dentro del JSON: 10 MB + margen)
    tunnelMaxBytes: parseInt(process.env.SECURE_TUNNEL_MAX_BYTES, 10) || 16 * 1024 * 1024
  }
};

