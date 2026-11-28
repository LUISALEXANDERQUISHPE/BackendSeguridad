require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config');
const routes = require('./routes');
const { templateService } = require('./container');
const logger = require('./utils/logger');
const errorHandler = require('./middlewares/error');
const setupSwagger = require('./config/swagger');
const { attachCollabServer, COLLAB_PATH } = require('./realtime/collabServer');
const { createSecureTunnel } = require('./middlewares/secureTunnel');
const { getSecurity } = require('./security');

const app = express();
const PORT = config.port;

// Detrás de un proxy inverso (Caddy en producción), req.ip toma la IP real de X-Forwarded-For
app.set('trust proxy', config.trustProxy);

// Middlewares de seguridad y utilidades
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({ origin: config.corsOrigin, credentials: true }));

// Canal cifrado (ChaCha20): descifra cada petición antes de las rutas y cifra su respuesta.
// Va antes de express.json porque el cuerpo real viene dentro de la trama cifrada.
app.use(createSecureTunnel({
  getSessionStore: () => getSecurity().sessionStore,
  maxBytes: config.security.tunnelMaxBytes,
  required: config.security.transportRequired
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enlazar las rutas bajo el prefijo /api
app.use('/api', routes);

// Configurar documentación interactiva con Swagger
setupSwagger(app);

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    message: 'API del backend activa e inicializada.',
    docs: '/api-docs'
  });
});

// Middleware de manejo de errores global (debe ir al final)
app.use(errorHandler);

// Iniciar el servidor
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Servidor de seguridad corriendo correctamente!`);
  console.log(`📡 Local:   http://localhost:${PORT}`);
  console.log(`🤝 Colaboración en tiempo real: ws://localhost:${PORT}${COLLAB_PATH}`);
  console.log(`🌱 Ambiente: ${config.nodeEnv}\n`);
});

// HU-16: registrar en la base las plantillas del sistema. Si la base no responde, el catálogo
// se sigue sirviendo desde la carpeta "templates" y solo se registra la advertencia.
templateService.syncCatalog().catch(error => {
  logger.warn('No se pudieron sincronizar las plantillas en la base de datos:', error.message);
});

// Edición colaborativa en tiempo real (WebSocket sobre el mismo servidor HTTP)
const collab = attachCollabServer(server);

// Al detener el servidor, guardar los documentos que se estaban editando
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await collab.close().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

