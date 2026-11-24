-- ============================================================
-- HU-23: Control de versiones e historial
-- Garantiza que cada archivo tenga números de versión únicos (1, 2, 3...),
-- incluso si dos usuarios guardan al mismo tiempo.
-- Ejecutar en Supabase: SQL Editor -> New query -> Run
-- ============================================================

-- 1. Renumerar posibles duplicados creados antes de esta restricción (conserva el orden cronológico)
with ordenadas as (
  select id,
         row_number() over (partition by archivo_id order by numero_version, creado_en, id) as nuevo_numero
  from versiones_archivo
)
update versiones_archivo as v
set numero_version = o.nuevo_numero
from ordenadas as o
where v.id = o.id
  and v.numero_version <> o.nuevo_numero;

-- 2. Restricción de unicidad (también crea el índice usado para listar el historial)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'versiones_archivo_archivo_numero_key'
  ) then
    alter table versiones_archivo
      add constraint versiones_archivo_archivo_numero_key unique (archivo_id, numero_version);
  end if;
end $$;

comment on constraint versiones_archivo_archivo_numero_key on versiones_archivo is
  'HU-23: un número de versión no puede repetirse dentro del mismo archivo';
