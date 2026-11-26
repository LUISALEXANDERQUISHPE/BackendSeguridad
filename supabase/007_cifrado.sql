-- ============================================================
-- Cifrado de datos guardados (Huffman + AES-256-CTR con la llave de cada proyecto)
-- ============================================================
-- Cada proyecto tiene su propia llave AES-256. Se guarda aquí SOLO cifrada con la llave
-- maestra del servidor (CRYPTO_MASTER_KEY del .env del backend), que nunca está en la base.
-- Después de ejecutar este archivo, cifrar los datos existentes con:
--   node scripts/encryptExistingData.js --dry-run   (solo cuenta lo que falta)
--   node scripts/encryptExistingData.js             (cifra y verifica)

alter table proyectos add column if not exists llave_cifrada text;

comment on column proyectos.llave_cifrada is
  'Llave AES-256 propia del proyecto, cifrada con la llave maestra del servidor (formato SLK1, base64). Nunca se envía al navegador. Borrar el proyecto borra su llave y deja ilegibles sus datos.';

-- Columnas que ahora guardan "slenc1:<proyecto>:<base64>" (Huffman + AES-256-CTR + HMAC-SHA256)
comment on column proyectos.descripcion is 'Descripción del proyecto, cifrada con la llave del proyecto';
comment on column nodos.contenido_actual is 'Texto vigente del archivo (código LaTeX), cifrado con la llave del proyecto';
comment on column versiones_archivo.contenido_snapshot is 'Copia completa del archivo en esta versión, cifrada con la llave del proyecto';
comment on column versiones_archivo.resumen_cambio is 'Descripción breve del cambio, cifrada con la llave del proyecto';
comment on column estados_autoguardado.buffer_contenido is 'Contenido autoguardado, cifrado con la llave del proyecto';
comment on column compilaciones.log_salida is 'Registro de la compilación, cifrado con la llave del proyecto';
comment on column comentarios.contenido is 'Texto del comentario, cifrado con la llave del proyecto';
comment on column comentarios.texto_citado is 'Fragmento comentado, cifrado con la llave del proyecto';
