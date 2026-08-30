# Backend - Proyecto de Seguridad

Este es el proyecto base para el backend de tu materia de Seguridad, configurado con Node.js y Express.

## Características incluidas
- **Express**: Framework web rápido y minimalista.
- **Cors**: Middleware para habilitar CORS (Cross-Origin Resource Sharing).
- **Helmet**: Ayuda a proteger tu aplicación Express configurando varias cabeceras HTTP (¡Excelente para la seguridad!).
- **Dotenv**: Carga variables de entorno desde un archivo `.env`.
- **Node --watch**: Utiliza la característica integrada de recarga automática en desarrollo de Node.js (Node 18+).

## Requisitos
- Node.js instalado (versión 18 o superior recomendada).

## Instalación

1. Clona o descarga este repositorio (o si ya estás en el directorio):
   ```bash
   npm install
   ```

2. Configura las variables de entorno en el archivo `.env`:
   ```env
   PORT=5000
   NODE_ENV=development
   ```

## Ejecución

### Modo Desarrollo (con recarga automática al guardar archivos)
```bash
npm run dev
```

### Modo Producción
```bash
npm start
```

El servidor estará corriendo en: [http://localhost:5000](http://localhost:5000)

