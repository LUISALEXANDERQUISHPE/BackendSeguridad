-- Ejecutar en proyectos existentes para habilitar el orden persistente del File Tree.
alter table nodos
  add column if not exists orden integer not null default 0;

update nodos as hijo
set orden = posiciones.posicion
from (
  select id, row_number() over (partition by proyecto_id, padre_id order by nombre, creado_en, id) - 1 as posicion
  from nodos
) as posiciones
where hijo.id = posiciones.id;
