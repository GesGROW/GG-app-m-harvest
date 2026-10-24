# Prueba pendiente de concurrencia con PostgreSQL real

Ejecutar en una base de pruebas con las migraciones previas y `202610140200_harvest_asignar_lote.sql` aplicadas. Se necesitan dos conexiones PostgreSQL distintas, con `READ COMMITTED` (el aislamiento habitual de los RPC), un operador autorizado para una campaña activa y dos DNI de trabajadores activos o provisionales. PGlite no sustituye esta prueba.

Usar dos terminales `psql` con conexiones independientes y UUID/códigos exclusivos de la prueba. En ambas definir:

```sql
\set campania 'UUID-DE-CAMPANIA-ACTIVA'
\set operador 'DNI-OPERADOR-AUTORIZADO'
\set trabajador_a 'DNI-TRABAJADOR-A'
\set trabajador_b 'DNI-TRABAJADOR-B'
\set op_a 'UUID-OPERACION-A'
\set op_b 'UUID-OPERACION-B'
```

Preparar mediante generación F5.2 o SQL privilegiado un lote disponible con al menos dos tickets. Definir en ambas terminales `lote`, `ticket_a` y `ticket_b` con sus valores reales. No usar datos productivos ni UUID ya utilizados por otros comandos.

## A confirma mientras B espera

En conexión A:

```sql
set application_name = 'harvest-f53-A';
begin isolation level read committed;
select public.harvest_asignar_lote_tickets(
  :'campania'::uuid, :'operador'::varchar, :'trabajador_a'::varchar,
  :'ticket_a'::text, :'op_a'::uuid
);
-- Dejar esta transacción abierta después de recibir el resultado.
```

En conexión B, antes de confirmar A:

```sql
set application_name = 'harvest-f53-B';
begin isolation level read committed;
select public.harvest_asignar_lote_tickets(
  :'campania'::uuid, :'operador'::varchar, :'trabajador_b'::varchar,
  :'ticket_b'::text, :'op_b'::uuid
);
-- Debe esperar el bloqueo del lote; no devolver una segunda asignación.
```

Un observador con permisos adecuados puede comprobar el bloqueo mientras A sigue abierta:

```sql
select application_name, wait_event_type, wait_event, pg_blocking_pids(pid)
from pg_stat_activity
where application_name in ('harvest-f53-A', 'harvest-f53-B');
```

Confirmar A con `commit;`. B debe despertar y recibir `harvest_lote_ya_asignado`. En B ejecutar `rollback;`. Después, con una conexión privilegiada:

```sql
select count(*) from public.harvest_asignaciones_lote where lote_id = :'lote'::uuid;
-- Exactamente 1; trabajador y operacion_id deben ser los de A.
select trabajador_id, operacion_id from public.harvest_asignaciones_lote
where lote_id = :'lote'::uuid;
select count(*) from public.operaciones_pda_procesadas where id = :'op_b'::uuid;
select count(*) from public.operaciones_pda_campania where id = :'op_b'::uuid;
-- Ambos conteos de B deben ser 0.
```

Comprobar que B tampoco dejó un trabajador/rol provisional nuevo si su DNI no existía antes. Reintentar A usando `ticket_b` y `op_a`: debe conservar exactamente la asignación de A, con un único recibo.

## Variantes obligatorias con fixtures nuevos

1. **A revierte:** repetir en un lote nuevo; A ejecuta `rollback` mientras B está esperando. B debe obtener la asignación y poder confirmar. No deben existir recibos ni alta provisional de A.
2. **Mismo UUID y trabajador:** ambas conexiones usan `op_a` y el trabajador A sobre tickets hermanos. B debe esperar el recibo/identidad de operación. Después del commit de A, B devuelve la misma asignación. Confirmar B y comprobar una fila de asignación y un recibo.
3. **Mismo trabajador, UUID distintos:** B usa trabajador A pero `op_b`. Tras confirmar A, B debe recibir `harvest_lote_ya_asignado`; no hay segunda asignación.
4. **UUID reutilizado con datos distintos:** usar el mismo UUID desde dos conexiones para trabajadores o lotes diferentes. Tras la primera confirmación, la segunda debe rechazar reutilización; no debe guardar otra asignación.
5. **Lotes independientes:** con UUID distintos, A deja abierta la asignación de un lote y B asigna otro lote a un trabajador ya existente diferente. B debe poder confirmar sin esperar el bloqueo del lote de A.
6. **Constraints con SQL privilegiado:** dos conexiones intentan insertar asignaciones del mismo lote, con UUID distintos, sin utilizar el RPC. Después de confirmar la primera, la segunda debe fallar con SQLSTATE `23505`. Repetir con lotes distintos y el mismo `operacion_id`: también debe fallar por el índice único. Esto verifica la defensa frente a escritores que eludan el protocolo de bloqueos.

Registrar versión de PostgreSQL, aislamiento, resultados, filas finales y bloqueos observados. El criterio de aprobación es una única asignación por lote, un solo recibo para un reintento válido y ningún cambio parcial del intento rechazado. Esta verificación está documentada para ejecución posterior; no se declara ejecutada por las pruebas locales.
