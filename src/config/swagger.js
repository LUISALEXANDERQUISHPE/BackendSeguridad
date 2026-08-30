const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const config = require('./index');

// Configuración básica de Swagger
const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API de Seguridad - Backend',
      version: '1.0.0',
      description: 'Documentación de los endpoints del backend para el proyecto de Seguridad.',
      contact: {
        name: 'Soporte de Desarrollo'
      }
    },
    servers: [
      {
        url: `http://localhost:${config.port}`,
        description: 'Servidor Local de Desarrollo'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Introduce tu token JWT en el formato: Bearer <token>'
        }
      }
    }
  },
  // Rutas donde se buscarán los comentarios de JSDoc para generar la documentación
  apis: ['./src/routes/*.js', './src/routes/**/*.js']
};

const swaggerSpec = swaggerJSDoc(options);

const setupSwagger = (app) => {
  // Servir la interfaz gráfica de Swagger en /api-docs
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  
  console.log(`📝 Documentación de Swagger disponible en: http://localhost:${config.port}/api-docs`);
};

module.exports = setupSwagger;

