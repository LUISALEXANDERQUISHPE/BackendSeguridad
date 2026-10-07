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
   CORS_ORIGIN=http://localhost:5173
   SUPABASE_URL=https://tu-proyecto.supabase.co
   SUPABASE_SECRET_KEY=tu-secret-key
   AUTH_EMAIL_DOMAIN=secureleaf.local
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
Documentación interactiva Swagger: [http://localhost:5000/api-docs](http://localhost:5000/api-docs)

### Autenticación
La autenticación usa `/api/auth/register`, `/api/auth/login` y `/api/auth/profile`. El registro acepta el correo real del usuario; Supabase Auth administra la contraseña y el backend guarda el perfil en `usuarios`.

### Endpoints del Editor LaTeX (`/api/documents`)
Todas las rutas de documentos requieren el encabezado `Authorization: Bearer <token>`:

- **`POST /api/documents`**: Crear nuevo documento/proyecto LaTeX.
- **`GET /api/documents`**: Listar todos los documentos accesibles del usuario.
- **`GET /api/documents/:id`**: Obtener detalles, contenido LaTeX y estado de compilación.
- **`PUT /api/documents/:id`**: Guardar código LaTeX (guardado manual con snapshot o autoguardado Ctrl+S con `isAutoSave: true`).
- **`DELETE /api/documents/:id`**: Eliminar documento.
- **`POST /api/documents/:id/compile`**: Compilar el código a PDF en un entorno aislado con `pdflatex`. Extrae errores con número de línea y advertencias.
- **`GET /api/documents/:id/pdf`**: Visualizar el PDF generado (inline) o descargar (`?download=true`).
- **`GET /api/documents/:id/source`**: Descargar el código fuente `.tex` original (`?download=true`).

### Endpoints de Gestión de Proyectos (`/api/projects`)
Todas las rutas de proyectos requieren el encabezado `Authorization: Bearer <token>`:

- **`GET /api/projects`**: Listar proyectos propios y compartidos (`?archived=true` para los archivados).
- **`POST /api/projects`**: Crear un proyecto con su archivo principal `.tex`.
- **`GET /api/projects/:id`**: Obtener los detalles de un proyecto.
- **`PUT /api/projects/:id`**: Modificar nombre o descripción (solo propietario).
- **`POST /api/projects/:id/duplicate`**: Duplicar el proyecto con todos sus archivos.
- **`POST /api/projects/:id/archive`**: Archivar el proyecto (solo propietario).
- **`POST /api/projects/:id/restore`**: Restaurar un proyecto archivado (solo propietario).
- **`DELETE /api/projects/:id`**: Eliminar el proyecto de forma permanente (solo propietario).

Para abrir un proyecto en el editor se usa `GET /api/documents/:id` con el `documentId` devuelto por estos endpoints.

### Almacenamiento en Supabase Storage
Los archivos de cada proyecto se guardan en el bucket indicado por `SUPABASE_STORAGE_BUCKET` (por defecto `DocumentosSecureLeaf`), dentro de una carpeta por proyecto:

- `proyectos/<proyecto_id>/<nombre>.tex`: código fuente con el mismo nombre que tiene en el sistema, se actualiza al crear, guardar, autoguardar, compilar y renombrar. Su ruta queda en `nodos.storage_path`.
- `proyectos/<proyecto_id>/<nombre>.pdf`: último PDF compilado con éxito. Se usa como respaldo cuando el PDF local de `storage/compilations` ya no existe.

Los nombres se guardan sin tildes ni caracteres especiales (se reemplazan por `_`) porque Storage no los admite en las rutas.

Al duplicar un proyecto se crean archivos propios para la copia y al eliminarlo se borra su carpeta. El backend accede con `SUPABASE_SECRET_KEY`, por lo que el bucket puede (y debería) ser privado.

Los puntos reservados para cifrado están en `src/utils/crypto.js`: `encrypt(data)` debe invocarse antes de guardar un campo sensible de aplicación y `decrypt(data)` después de leerlo. No cifres contraseñas: Supabase Auth las almacena y verifica de forma segura.


