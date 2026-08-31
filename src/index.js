require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config');
const routes = require('./routes');
const errorHandler = require('./middlewares/error');
const setupSwagger = require('./config/swagger');

const app = express();
const PORT = config.port;

// Middlewares de seguridad y utilidades
app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.listen(PORT, () => {
  console.log(`\n🚀 Servidor de seguridad corriendo correctamente!`);
  console.log(`📡 Local:   http://localhost:${PORT}`);
  console.log(`🌱 Ambiente: ${config.nodeEnv}\n`);
});

