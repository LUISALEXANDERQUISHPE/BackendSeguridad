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

La autenticación usa `/api/auth/register`, `/api/auth/login` y `/api/auth/profile`. El registro acepta el correo real del usuario, incluyendo Gmail; Supabase Auth administra la contraseña y el backend guarda el perfil en `profiles`. Ejecuta `supabase/001_profiles.sql` desde el SQL Editor de Supabase antes de iniciar el backend.

Para usar Gmail con contraseña, no necesitas activar un proveedor externo: envía `email: "persona@gmail.com"` al registro/login. Para el botón OAuth de Google, activa Google en Supabase Authentication > Providers y configura las URLs de redirección; ese flujo se incorporará después en el frontend.

Los puntos reservados para cifrado están en `src/utils/crypto.js`: `encrypt(data)` debe invocarse antes de guardar un campo sensible de aplicación y `decrypt(data)` después de leerlo. No cifres contraseñas: Supabase Auth las almacena y verifica de forma segura.

