# Despliegue de SecureLeaf en Azure for Students

Guía paso a paso para publicar el frontend y el backend en una máquina virtual de Azure,
**sin tarjeta de crédito**, con HTTPS y siempre encendida.

## Arquitectura

```
Navegador ──HTTPS──► Caddy (contenedor "web", puertos 80/443)
                       ├── /           → app React compilada (SeguridadFrontend)
                       └── /api/*      → backend Node (contenedor "backend", puerto interno 5000)
                            └── /api/collab  WebSocket de colaboración en tiempo real
backend ──► Supabase (base de datos, Auth y Storage)
backend ──► TeX Live (pdflatex, bibtex, biber, makeindex) dentro del mismo contenedor
```

- Frontend y API comparten dominio: no hace falta CORS y la CSP `'self'` funciona igual que en desarrollo.
- Caddy obtiene y renueva solo el certificado HTTPS (Let's Encrypt).
- El backend no está expuesto a internet; solo Caddy puede hablar con él.
- Las compilaciones LaTeX se hacen en memoria (`tmpfs`), sin copias del documento en disco.

### Archivos de despliegue

| Repositorio | Archivo | Para qué sirve |
|---|---|---|
| BackendSeguridad | `Dockerfile` | Imagen Node 24 + TeX Live |
| BackendSeguridad | `docker-compose.yml` | Levanta backend + Caddy |
| SeguridadFrontend | `Dockerfile` | Compila la app con Vite y la sirve con Caddy |
| SeguridadFrontend | `deploy/Caddyfile` | HTTPS, proxy `/api` y cabeceras de seguridad |

### Variables de entorno: un solo `.env` por repositorio

Cada repo usa **un único `.env`** para local y producción. Dentro, cada variable indica su valor
con etiquetas: `[LOCAL]`, `[PRODUCCIÓN]` o `[AMBOS]` (mismo valor en los dos casos).
El `.env.example` es la misma estructura sin valores secretos (es lo único que se sube a GitHub).

- **Backend**: al desplegar solo cambian `DOMAIN`, `NODE_ENV`,
  `SECURE_DIAGNOSTICS_ENABLED` y, opcionalmente, `LATEX_TIMEOUT_MS`.
- **Frontend**: todas las variables son iguales en local y producción; se copia tal cual.

---

## 0. Antes de empezar

1. Los cambios de `feature/despliegue` deben estar en `main` en **ambos** repositorios
   (`feature/despliegue` → PR a `develop` → PR a `main`). El servidor siempre usa `main`.
2. Ten tus `.env` de ambos repos en tu PC: se copian al servidor en el paso 7.
   > ⚠️ Usa **la misma `CRYPTO_MASTER_KEY`** que en desarrollo si la base de datos ya tiene datos cifrados.
   > Con otra llave no podrás descifrarlos.

### (Opcional) Probar en tu PC antes de subir

Con Docker Desktop, y los dos repos uno al lado del otro:

Los `.env` de ambos repos ya sirven tal cual (`DOMAIN=localhost`):

```powershell
cd BackendSeguridad
docker compose up --build
```

Abre <https://localhost> (acepta la advertencia del certificado local). Para detener: `Ctrl+C` y `docker compose down`.
Los puertos 80 y 443 de tu PC deben estar libres.

---

## 1. Activar Azure for Students

1. Entra a <https://azure.microsoft.com/free/students> → **Activar ahora**.
2. Inicia sesión con tu **correo institucional** y verifica que eres estudiante. No pide tarjeta.
3. Recibes **USD 100 de crédito** (12 meses, renovable mientras seas estudiante). Cuando se acaba,
   los recursos se detienen: **nunca te cobran**.

## 2. Crear la máquina virtual

En <https://portal.azure.com> → **Máquinas virtuales** → **Crear** → **Máquina virtual de Azure**.

**Pestaña Básico**

| Campo | Valor |
|---|---|
| Suscripción | Azure for Students |
| Grupo de recursos | Crear nuevo: `secureleaf-rg` |
| Nombre | `secureleaf-vm` |
| Región | Una cercana. Si al crear sale un error de *policy*, prueba otra (East US, Brazil South…) |
| Imagen | **Ubuntu Server 24.04 LTS - x64 Gen2** |
| Tamaño | **B1s** (1 vCPU, 1 GB, incluida en los servicios gratuitos). Si las compilaciones van lentas, luego cambia a **B1ms** (2 GB) o **B2s** (4 GB) |
| Tipo de autenticación | Clave pública SSH |
| Usuario | `azureuser` |
| Origen de clave | Generar nuevo par de claves → nombre `secureleaf-key` |
| Puertos de entrada públicos | Permitir: **SSH (22), HTTP (80), HTTPS (443)** |

**Pestaña Discos**: disco del SO **SSD Premium, 64 GiB** (incluido en los servicios gratuitos).
La imagen con TeX Live ocupa ~3 GB; el disco por defecto de 30 GB también alcanza.

**Pestaña Administración**: verifica que **Apagado automático** esté **desactivado**
(si está activo, la app se apaga todas las noches).

**Revisar y crear** → **Crear** → descarga la clave **`secureleaf-key.pem`** y guárdala
(no se puede volver a descargar).

## 3. Dominio gratuito con HTTPS

Azure da un subdominio gratis, válido para Let's Encrypt:

1. Abre la VM → en **Información general**, clic en la **Dirección IP pública**.
2. **Configuración** → **Etiqueta de nombre DNS**: `secureleaf` (o el que esté libre) → **Guardar**.
3. Tu dominio será algo como **`secureleaf.eastus.cloudapp.azure.com`** → ese es tu `DOMAIN`.
4. En la misma pantalla, asignación de IP: **Estática** (para que no cambie al reiniciar).

> ¿Dominio propio? (ej. el `.me`/`.tech` del GitHub Student Pack): crea un registro **A**
> apuntando a la IP pública de la VM y usa ese dominio como `DOMAIN`.

## 4. Conectarte por SSH

En PowerShell de tu PC:

```powershell
# Solo la primera vez: restringir permisos de la clave (SSH la rechaza si otros usuarios pueden leerla)
icacls .\secureleaf-key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"

ssh -i .\secureleaf-key.pem azureuser@TU_DOMINIO
```

Todos los comandos siguientes se ejecutan **dentro de la VM**.

## 5. Preparar el servidor

```bash
# Actualizar el sistema
sudo apt update && sudo apt upgrade -y

# Memoria swap de 2 GB (imprescindible en B1s, que tiene 1 GB de RAM)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker + Docker Compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Cierra la sesión SSH (exit) y vuelve a entrar para usar docker sin sudo
```

Comprueba: `docker compose version`

## 6. Descargar el código (rama `main`)

```bash
mkdir -p ~/secureleaf && cd ~/secureleaf
git clone -b main https://github.com/LUISALEXANDERQUISHPE/BackendSeguridad.git
git clone -b main https://github.com/LUISALEXANDERQUISHPE/SeguridadFrontend.git
```

> Si los repos son **privados**, GitHub pedirá usuario y contraseña: usa tu usuario y un
> **Personal Access Token** (GitHub → Settings → Developer settings → Fine-grained tokens,
> con permiso de solo lectura *Contents* sobre los dos repos) en lugar de la contraseña.

Deben quedar uno al lado del otro: `~/secureleaf/BackendSeguridad` y `~/secureleaf/SeguridadFrontend`.

## 7. Configurar variables de entorno

Los `.env` no están en GitHub: cópialos **desde tu PC** al servidor. En PowerShell de tu PC,
desde la carpeta `Proyecto Copia Overleaf`:

```powershell
scp -i .\secureleaf-key.pem BackendSeguridad\.env  azureuser@TU_DOMINIO:~/secureleaf/BackendSeguridad/.env
scp -i .\secureleaf-key.pem SeguridadFrontend\.env azureuser@TU_DOMINIO:~/secureleaf/SeguridadFrontend/.env
```

(Ajusta la ruta de `secureleaf-key.pem` según dónde la guardaste.)

**Backend**: en la VM, cambia solo las variables marcadas con un valor distinto en `[PRODUCCIÓN]`:

```bash
cd ~/secureleaf/BackendSeguridad
nano .env
```

| Variable | Valor en producción |
|---|---|
| `DOMAIN` | tu dominio, ej. `secureleaf.eastus.cloudapp.azure.com` |
| `NODE_ENV` | `production` |
| `SECURE_DIAGNOSTICS_ENABLED` | `false` |
| `LATEX_TIMEOUT_MS` | `60000` (opcional, recomendado en B1s) |

Guarda con `Ctrl+O`, `Enter`, `Ctrl+X`. **No cambies** `CRYPTO_MASTER_KEY` ni las demás `[AMBOS]`.

```bash
chmod 600 .env   # solo tu usuario puede leer los secretos
```

**Frontend**: no hay que cambiar nada; el `.env` sirve igual en producción.

## 8. Configurar Supabase

En el panel de Supabase → **Authentication** → **URL Configuration**:

- **Site URL**: `https://<DOMAIN>`
- **Redirect URLs**: agrega `https://<DOMAIN>/**`

Sin esto, el inicio de sesión y los enlaces de los correos redirigen a `localhost`.

## 9. Levantar la aplicación

```bash
cd ~/secureleaf/BackendSeguridad
docker compose up -d --build
```

La primera vez tarda **10–20 minutos** en una B1s (descarga TeX Live y compila el frontend).
Las siguientes son mucho más rápidas gracias a la caché de Docker.

```bash
docker compose ps                 # ambos servicios deben estar "Up" (backend: "healthy")
docker compose logs -f web        # Caddy: debe decir "certificate obtained successfully"
docker compose logs -f backend    # backend
```

## 10. Verificar

1. `https://<DOMAIN>` muestra la app con candado HTTPS.
2. `https://<DOMAIN>/api/health` responde `{"status":"UP",...}`.
3. Inicia sesión, crea un proyecto **desde cada tipo de plantilla** y compílalo.
4. Abre el mismo documento en dos navegadores: la edición debe verse en tiempo real (WebSocket).

---

## Actualizar a una nueva versión

Después de hacer merge a `main` en GitHub:

```bash
cd ~/secureleaf/SeguridadFrontend && git pull
cd ~/secureleaf/BackendSeguridad && git pull
docker compose up -d --build
docker image prune -f             # borra imágenes viejas para no llenar el disco
```

Los usuarios conectados pierden la conexión unos segundos; el backend guarda los documentos
abiertos antes de reiniciarse.

## Comandos útiles

| Acción | Comando (en `~/secureleaf/BackendSeguridad`) |
|---|---|
| Estado | `docker compose ps` |
| Logs en vivo | `docker compose logs -f` |
| Reiniciar | `docker compose restart` |
| Detener todo | `docker compose down` |
| Uso de CPU/RAM | `docker stats` |
| Espacio en disco | `df -h` y `docker system df` |

Los contenedores tienen `restart: unless-stopped`: si la VM se reinicia, la app arranca sola.

## Costos y créditos

- Revisa el saldo en el portal: **Cost Management** → **Créditos de Azure**.
- B1s: las horas están incluidas en los servicios gratuitos de 12 meses; la IP pública estática
  consume ~USD 3–4/mes del crédito.
- Con B1ms o B2s el crédito dura menos (aprox. 6 o 3 meses).

## Supabase gratuito: pausa por inactividad

Los proyectos gratuitos de Supabase se **pausan tras 7 días sin actividad**. Con usuarios reales
no ocurre; si la app pasa semanas sin uso, entra al menos una vez por semana o reanuda el
proyecto desde el panel de Supabase.

## Solución de problemas

| Síntoma | Causa probable / solución |
|---|---|
| Caddy no obtiene el certificado | Puertos 80/443 cerrados (VM → **Redes** → reglas de entrada) o `DOMAIN` no apunta a la IP |
| `502 Bad Gateway` en `/api` | El backend no arrancó: `docker compose logs backend` (suele ser una variable del `.env`) |
| Login redirige a `localhost` | Falta el paso 8 (URL Configuration de Supabase) |
| No funciona la colaboración en tiempo real | Revisa en la consola del navegador la conexión a `wss://<DOMAIN>/api/collab` |
| `LaTeX Error: File 'xxx.sty' not found` | Falta un paquete de TeX Live: agrégalo a `TEXLIVE_PACKAGES` en el `Dockerfile` (busca en qué paquete Debian está en <https://packages.debian.org>) o usa `texlive-full` |
| La VM se queda sin memoria / compilaciones muy lentas | Verifica el swap (`free -h`) o cambia el tamaño de la VM (VM → **Tamaño**) |
| Error de *policy* al crear la VM | Región no permitida para Azure for Students: elige otra |
