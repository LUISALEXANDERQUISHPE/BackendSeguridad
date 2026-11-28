/**
 * Columnas que guardan contenido del usuario y por eso se cifran (Huffman + AES con la llave del proyecto).
 *
 * "project" indica cómo saber a qué proyecto pertenece una fila (para elegir su llave):
 *   self   -> la fila ES el proyecto (su id)
 *   column -> la fila tiene la columna proyecto_id
 *   file   -> la fila apunta a un archivo (nodos) y el proyecto es el de ese archivo
 *
 * Los metadatos (ids, nombres, fechas, roles, correos) quedan en claro porque la base de datos
 * los necesita para buscar, ordenar, validar duplicados y aplicar permisos.
 */
const SENSITIVE_TABLES = Object.freeze({
  proyectos: { columns: ['descripcion'], project: { self: true } },
  nodos: { columns: ['contenido_actual'], project: { column: 'proyecto_id' } },
  compilaciones: { columns: ['log_salida'], project: { column: 'proyecto_id' } },
  versiones_archivo: { columns: ['contenido_snapshot', 'resumen_cambio'], project: { file: 'archivo_id' } },
  estados_autoguardado: { columns: ['buffer_contenido'], project: { file: 'archivo_id' } },
  comentarios: { columns: ['contenido', 'texto_citado'], project: { file: 'archivo_id' } }
});

/** Columna con la llave del proyecto (cifrada con la maestra). Nunca sale del servidor. */
const PROJECT_KEY_COLUMN = 'llave_cifrada';

function sensitiveColumnsOf(table) {
  return SENSITIVE_TABLES[table]?.columns ?? [];
}

module.exports = { SENSITIVE_TABLES, PROJECT_KEY_COLUMN, sensitiveColumnsOf };
