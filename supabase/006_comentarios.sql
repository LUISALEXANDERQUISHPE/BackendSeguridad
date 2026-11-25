-- ============================================================
-- HU-25: Comentarios en hilos sobre fragmentos del documento (como en Overleaf)
-- Completa la tabla "comentarios" del esquema inicial.
--
-- Ejecutar en Supabase: SQL Editor -> New query -> Run (una sola ejecución)
-- ============================================================

-- Texto que estaba seleccionado al comentar: si el documento cambia, el comentario se
-- vuelve a ubicar buscando este texto cerca de su posición original
alter table comentarios add column if not exists texto_citado text;

-- Edición del propio comentario
alter table comentarios add column if not exists actualizado_en timestamptz;

-- Quién y cuándo marcó el hilo como resuelto (trazabilidad)
alter table comentarios add column if not exists resuelto_por uuid references usuarios(id);
alter table comentarios add column if not exists resuelto_en timestamptz;

-- Una selección válida: inicio <= fin y nunca negativa
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comentarios_seleccion_valida') then
    alter table comentarios
      add constraint comentarios_seleccion_valida
      check (seleccion_inicio is null or (seleccion_inicio >= 0 and seleccion_fin >= seleccion_inicio));
  end if;
end $$;

-- Listar los comentarios de un archivo en orden
create index if not exists idx_comentarios_archivo_creado on comentarios (archivo_id, creado_en);

comment on column comentarios.texto_citado is
  'HU-25: Fragmento seleccionado al comentar (máx. 500 caracteres), usado para reubicar el comentario si el texto se mueve';
comment on column comentarios.actualizado_en is 'HU-25: Última edición del comentario por su autor';
comment on column comentarios.resuelto_por is 'HU-25: Usuario que marcó el hilo como resuelto';
comment on column comentarios.resuelto_en is 'HU-25: Fecha en que se marcó el hilo como resuelto';
