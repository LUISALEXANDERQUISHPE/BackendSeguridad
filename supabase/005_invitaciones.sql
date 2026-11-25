-- ============================================================
-- HU-25: Compartición y gestión de permisos — invitaciones pendientes
-- Flujo como Overleaf: el propietario invita con un rol, la invitación queda "pendiente"
-- y la persona solo entra al proyecto cuando la acepta (desde la app o con el enlace).
--
-- Ejecutar en Supabase: SQL Editor -> New query -> Run
-- IMPORTANTE: ejecutar el PASO 1 y luego el PASO 2 en dos ejecuciones separadas
-- (Postgres no permite usar un valor nuevo de un enum en la misma transacción).
-- ============================================================

-- ---------- PASO 1 (ejecutar solo) ----------
alter type estado_invitacion add value if not exists 'rechazada';


-- ---------- PASO 2 (ejecutar después del paso 1) ----------
-- Fecha en que la persona aceptó o rechazó la invitación
alter table invitaciones add column if not exists respondido_en timestamptz;

-- Correos siempre en minúsculas: la búsqueda por correo no depende de mayúsculas
update invitaciones set correo = lower(trim(correo)) where correo is not null and correo <> lower(trim(correo));

-- Las invitaciones pendientes viejas sin fecha de vencimiento se dan por expiradas
update invitaciones set estado = 'expirada' where estado = 'pendiente' and expira_en is null;

-- Una sola invitación pendiente por correo y proyecto (reinvitar renueva la existente)
create unique index if not exists idx_invitaciones_pendiente_unica
  on invitaciones (proyecto_id, correo)
  where estado = 'pendiente';

-- Bandeja de invitaciones de un usuario (busca por su correo)
create index if not exists idx_invitaciones_correo_estado on invitaciones (correo, estado);

comment on column invitaciones.token is
  'HU-25: Hash SHA-256 (hex) del token del enlace de invitación. El token en claro solo se muestra una vez al propietario y nunca se guarda.';
comment on column invitaciones.estado is
  'Estado: pendiente, aceptada, rechazada, revocada (por el propietario) o expirada';
comment on column invitaciones.respondido_en is
  'HU-25: Fecha en que el invitado aceptó o rechazó la invitación';
