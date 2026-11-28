-- ============================================================
-- HU-16: Plantillas LaTeX del sistema
-- ============================================================
-- Los archivos de cada plantilla viven en la carpeta "templates" del backend (versionada en Git).
-- Esta tabla es el catálogo: el backend lo sincroniza automáticamente al arrancar
-- (no hace falta insertar filas a mano).
--
-- Las plantillas del sistema son la BASE de la que se copian los proyectos: nunca se eliminan.
-- Usar una plantilla crea un proyecto nuevo e independiente (copia); la base no cambia.
--
-- Ejecutar en Supabase: SQL Editor -> New query -> Run
-- ============================================================

alter table plantillas add column if not exists es_sistema boolean not null default false;
alter table plantillas add column if not exists actualizado_en timestamptz default now();

comment on column plantillas.es_sistema is
  'true para las plantillas base del sistema (carpeta templates del backend): no se pueden eliminar';
comment on column plantillas.actualizado_en is
  'Última vez que el backend sincronizó los datos de la plantilla desde su template.json';

-- Las plantillas base no se pueden borrar, ni desde la aplicación ni desde el SQL Editor.
create or replace function impedir_borrar_plantillas_sistema()
returns trigger
language plpgsql
as $$
begin
  if old.es_sistema then
    raise exception 'La plantilla "%" es del sistema y no se puede eliminar', old.nombre
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_plantillas_sistema_no_borrar on plantillas;
create trigger trg_plantillas_sistema_no_borrar
  before delete on plantillas
  for each row execute function impedir_borrar_plantillas_sistema();

-- Si se borra un proyecto creado desde una plantilla, la plantilla sigue intacta
-- (la relación ya es proyectos.plantilla_id -> plantillas.id, sin cascada hacia la plantilla).
create index if not exists idx_plantillas_categoria on plantillas(categoria);
