# Prueba pendiente de consumo con dos conexiones PostgreSQL

Ejecutar posteriormente en una base de pruebas PostgreSQL real con todas las migraciones de Harvest, incluida `202610140300_harvest_registrar_cosecha.sql` y su contrato Workforce `202610140250_workforce_jabero_campania.sql`. Esta prueba no se considera ejecutada por PGlite.

Preparar un ticket nuevo de un lote asignado, un operador autorizado y una sesión activa de esa campaña iniciada por el operador, con jabero vigente. Usar fixtures nuevos y UUID exclusivos para cada variante, sin datos productivos. En dos terminales `psql` independientes definir los mismos valores reales de `campania`, `operador`, `sesion` y `ticket`, y UUID distintos `registro_a`, `registro_b`, `op_a`, `op_b`:

```sql
\set campania 'UUID-CAMPANIA'
\set operador 'DNI-OPERADOR'
\set sesion 'UUID-SESION-ACTIVA'
\set ticket 'CODIGO-TICKET-DISPONIBLE'
\set registro_a 'UUID-REGISTRO-A'
\set registro_b 'UUID-REGISTRO-B'
\set op_a 'UUID-OPERACION-A'
\set op_b 'UUID-OPERACION-B'
```

## Dos operaciones distintas para el mismo ticket

En conexión A:

```sql
set application_name = 'harvest-consumo-A';
begin isolation level read committed;
select public.harvest_registrar_cosecha(
  :'campania'::uuid, :'operador'::varchar, :'sesion'::uuid,
  :'ticket'::text, :'registro_a'::uuid, '2026-10-14T12:00:00Z'::text, :'op_a'::uuid
);
-- Dejar la transacción abierta: el registro solo es visible para A.
```

En conexión B, antes del commit de A:

```sql
set application_name = 'harvest-consumo-B';
begin isolation level read committed;
select public.harvest_registrar_cosecha(
  :'campania'::uuid, :'operador'::varchar, :'sesion'::uuid,
  :'ticket'::text, :'registro_b'::uuid, '2026-10-14T12:00:01Z'::text, :'op_b'::uuid
);
-- Debe esperar el bloqueo FOR UPDATE del ticket.
```

Una conexión observadora con permisos adecuados debe verificar la espera:

```sql
select application_name, wait_event_type, wait_event, pg_blocking_pids(pid)
from pg_stat_activity
where application_name in ('harvest-consumo-A', 'harvest-consumo-B');
```

Confirmar A con `commit;`. B debe despertar y recibir `harvest_ticket_ya_utilizado`; ejecutar `rollback;` en B. Comprobar mediante SQL privilegiado:

```sql
select id, codigo_ticket, trabajador_id, operacion_id, sesion_id
from public.harvest_registros_cosecha where codigo_ticket = :'ticket';
-- Exactamente una fila: ID/op de A y trabajador de la asignación del lote.
select count(*) from public.operaciones_pda_procesadas where id = :'op_b'::uuid;
select count(*) from public.operaciones_pda_campania where id = :'op_b'::uuid;
-- Ambos conteos de B deben ser 0.
```

Reconstruir/consultar el ticket: debe estar utilizado con el registro de A. No debe existir escritura nueva en `lecturas_jaba`.

## Variantes obligatorias

1. **A revierte:** repetir con otro ticket; A hace `rollback` mientras B espera. B debe registrar y confirmar. No deben quedar registro ni recibos de A.
2. **Mismo UUID:** ambas conexiones usan `op_a` y el mismo contexto/ticket, incluso con distinto ID/fecha propuestos. B espera el recibo/identidad de operación. Después del commit de A, devuelve exactamente el registro original de A. Deben existir un registro y un recibo.
3. **Tickets independientes del mismo lote:** con UUID distintos, A deja abierto su consumo y B registra un ticket hermano. B debe poder confirmar sin esperar un bloqueo exclusivo del lote de tickets.
4. **Cierre concurrente:** A registra un ticket y deja abierta la transacción. B intenta cerrar esa sesión por su RPC normal y debe esperar el bloqueo compartido de sesión. Tras confirmar A, el cierre puede confirmar. El mismo UUID de A sigue recuperando su recibo; un nuevo registro en la sesión cerrada se rechaza.
5. **Cierre gana primero:** B cierra la sesión y deja la transacción abierta; A intenta registrar un ticket disponible. Tras el commit del cierre, A debe rechazar la sesión y no consumir el ticket.
6. **Defensa por constraint:** dos conexiones privilegiadas intentan insertar directamente registros del mismo código, con identidades de registro distintas. Confirmar la primera; la segunda debe fallar con SQLSTATE `23505` y constraint `harvest_registro_ticket_unico`. Esto verifica la unicidad aun sin utilizar el protocolo RPC de bloqueos.
7. **Fallo tardío:** en fixtures de prueba, provocar un fallo de inserción del recibo después de crear el registro. El ticket debe permanecer disponible, sin registro ni contexto/recibo de operación; un reintento válido puede confirmar.

Para la variante de SQL directo, los registros deben respetar las FK de asignación y el contexto completo. No desactivar los constraints que se están probando. Registrar versión de PostgreSQL, aislamiento, resultados, bloqueos observados y filas finales. El criterio de aprobación es un único registro/consumo confirmado por ticket, idempotencia por UUID y ausencia de cambios parciales.
