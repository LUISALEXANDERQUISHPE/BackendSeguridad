-- ============================================================
-- HU-25: Compartición y gestión de permisos
-- Agrega el rol "lector" (solo lectura, como el "Viewer" de Overleaf).
-- Roles visibles en la aplicación: propietario, editor, lector.
-- "revisor" e "invitado" quedan en el enum por compatibilidad, pero ya no se asignan.
--
-- Ejecutar en Supabase: SQL Editor -> New query -> Run
-- IMPORTANTE: ejecutar el PASO 1 y luego el PASO 2 en dos ejecuciones separadas.
-- Postgres no permite usar un valor nuevo de un enum en la misma transacción que lo crea.
-- ============================================================

-- ---------- PASO 1 (ejecutar solo) ----------
alter type rol_proyecto add value if not exists 'lector';


-- ---------- PASO 2 (ejecutar después del paso 1) ----------
-- Los "invitado" existentes pasan a "lector" (mismos permisos: solo lectura)
update miembros_proyecto set rol = 'lector' where rol = 'invitado';
update invitaciones set rol = 'lector' where rol = 'invitado';

-- Un colaborador sin rol explícito entra con el mínimo privilegio
alter table miembros_proyecto alter column rol set default 'lector';

comment on column miembros_proyecto.rol is
  'HU-25: Rol del usuario en el proyecto: propietario, editor o lector (revisor/invitado son heredados y no se asignan)';
