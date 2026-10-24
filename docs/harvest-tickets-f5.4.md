# Harvest F5.4: RegistroCosecha y consumo único productivo

Este documento describe el cierre de F5.4. La integración posterior de caché y reservas offline está implementada en [F5.5](harvest-tickets-f5.5.md).

`RegistrarCosecha` confirma un código de ticket mediante el nuevo modelo Harvest. La confirmación remota de `REGISTRAR_JABA` ya usa este caso, sin cambiar el tipo persistido, su payload, IndexedDB v4 ni la UI/proyección local. La estrategia offline completa corresponde a F5.5.

## Caso de aplicación y recorrido

`crearRegistrarCosecha` recibe código, campaña, operador, sesión, identificador de registro, fecha/hora y `operacionId`. No recibe un trabajador como fuente de atribución. Valida el contexto requerido y delega la operación indivisible al puerto `RepositorioTicketsHarvest.registrarCosecha`. Devuelve instancias de dominio reconstruidas: catálogo, lote, ticket utilizado y registro.

```text
REGISTRAR_JABA { dniOperador, campaniaId, sesionId,
                codigoTicket, lecturaId, fechaHora }
   + operacion.id estable
→ backend.registrarLecturaJaba (alias conservado)
→ RegistrarCosecha
→ harvest_registrar_cosecha
→ resolver ticket y lote / obtener asignación
→ validar sesión / insertar registro que consume el ticket
→ guardar recibo / confirmar transacción
```

`lecturaId` pasa a ser el identificador propuesto de `RegistroCosecha` para esta confirmación. El comando tiene todos los datos necesarios y no requiere transformar la cola. El backend exige campaña y UUID de operación explícitos. No consulta un catálogo anterior para decidir, no deduce el cosechador del DTO local y no utiliza un RPC legacy como fallback.

La composición `crearTicketsHarvest` también publica `registrarCosecha`. El dominio conserva independencia de SDK, infraestructura y APIs del navegador. `RegistroCosecha` puede conservar referencias inmutables a sesión y operación; la reconstrucción de estados prototipo de F5.1/F5.2 sigue admitiendo su ausencia.

## Persistencia y consumo

La migración `202610140300_harvest_registrar_cosecha.sql` amplía únicamente `harvest_registros_cosecha` con `sesion_id`, `operacion_id` y fecha de registro del servidor `creado_en`. La sesión referencia la sesión operativa existente; la operación referencia su contexto autorizado y tiene índice único. El índice `harvest_registro_ticket_unico` aplica `UNIQUE(codigo_ticket)`: el código es la identidad primaria del agregado `Ticket`, por lo que equivale a la unicidad por `ticket_id`.

El RPC inserta un registro con código, lote, campaña, trabajador y clave de asignación obtenidos desde la asignación del lote. Las FK compuestas de F5.2 impiden atribuciones incompatibles. La sesión operativa apunta al lote físico existente; este es distinto del `LoteDeTickets`, y ambos deben pertenecer a la misma campaña.

**El consumo se representa por la existencia del registro único.** No hay un flag de utilización independiente que pueda separarse del registro. Sin registro, el ticket está disponible; con registro, está utilizado. El mapper reconstruye este estado a través de `Ticket.registrarCosecha`. Insertar el registro es simultáneamente crear la cosecha y consumir el ticket, dentro de la transacción que también guarda el recibo. Un fallo de inserción o de recibo revierte registro, consumo y contexto operativo juntos. No existe un endpoint de borrado o reapertura de consumo.

No se inventan sesión, operación ni fecha de creación para estados prototipo anteriores: las columnas permiten ausencia de contexto en esas filas; el RPC productivo siempre exige el contexto completo y una fecha de servidor. No se insertan ni convierten filas desde `lecturas_jaba`.

## Autorización e idempotencia

Identity/Campaign siguen usando `autorizar_operador_campania` y `fijar_campania_operacion`. La sesión debe existir, estar activa para un registro nuevo, pertenecer a la campaña y haber sido iniciada por el operador. La función de sesión, propiedad de Harvest, bloquea su fila frente a un cierre concurrente. La aptitud del jabero se delega al contrato SQL de Workforce `workforce_validar_jabero_campania`, introducido en `202610140250_workforce_jabero_campania.sql`, con la política vigente de rol/trabajador activos en esa campaña. Harvest no define roles ni copia autorización diaria.

Los helpers internos no tienen acceso RPC público. El RPC operativo mantiene el acceso por DNI autorizado que ya utiliza el PDA (`anon`/`authenticated`) y no concede acceso directo a tablas. La autorización del operador se vuelve a comprobar incluso para un recibo ya confirmado.

El UUID de operación identifica el evento. Su huella incluye ticket, sesión, operador y campaña. Repetir el mismo UUID y contexto devuelve el resultado original persistido, sin reinvocar el consumo de dominio ni reemplazar ID/fecha originales por nuevas propuestas del cliente. Reutilizarlo para otro ticket, sesión, operador, campaña o tipo de comando se rechaza.

Un reintento válido puede recuperar el recibo después del cierre de la sesión, porque no crea una nueva cosecha. La sesión cerrada rechaza cualquier registro nuevo. Un recibo legacy carece del formato/identidad Harvest y no se reinterpreta como registro nuevo.

Con otro UUID, un ticket que ya tiene registro produce `TicketYaUtilizado`. El RPC bloquea el ticket con `FOR UPDATE`; las operaciones competidoras sobre el mismo código se serializan. La unicidad por ticket y por operación respalda la decisión aun para escritores que eludan el protocolo. Los rechazos de dominio y los errores temporales se traducen fuera de Application/Domain.

## Compatibilidad y límites actuales

La escritura local, los conteos, los DTO de cosechador, las sesiones en caché y la aceptación local de escaneos repetidos siguen siendo legacy. Dos escaneos con UUID distintos todavía pueden producir dos intenciones locales; el backend solo confirma una. La cola conserva su clasificación de pendientes/errores y bloqueo por campaña. **La vista local todavía puede contar una intención que el servidor rechazó**: F5.5 debe reconciliarla; esta fase no borra ni reescribe lecturas locales.

No se publica todavía una caché completa de tickets nuevos y sus lotes/asignaciones/consumos. El caso remoto se puede ejecutar con el contexto completo, pero la UI local actual sigue dependiendo de su proyección anterior. Una confirmación remota de asignación no hace que todos los tickets hermanos aparezcan automáticamente en la caché local de lectura.

Los RPC legacy permanecen disponibles para clientes anteriores y el histórico de `lecturas_jaba` conserva tickets repetidos. Este cliente ya no utiliza ese RPC para confirmar nuevos `REGISTRAR_JABA`; códigos exclusivamente legacy se rechazan como inexistentes en Harvest, sin creación o conversión implícita. Las operaciones antiguas pendientes necesitan una política explícita de transición en F5.5.

No se cambian reportes ni se mezclan registros Harvest con lecturas históricas. Las nuevas cosechas no pasan a los reportes legacy mediante doble escritura. Google Sheets y Apps Script permanecen iguales.

## Validación y siguiente fase

Las pruebas cubren atribución derivada, ausencia de lote asignado, códigos ausentes/ajenos, consumo único, repetición idempotente, cambios de contexto, sesión/operador inválidos, Workforce, rollback tardío, fallo de inserción, constraints y conservación del histórico. La prueba de cola simula una respuesta perdida después del commit y verifica que el mismo UUID solo tiene un registro; también verifica que la segunda intención local es rechazada sin migrar IndexedDB.

PGlite ejecuta los RPC y constraints, pero serializa sus sentencias. No prueba concurrencia MVCC entre conexiones. La [prueba pendiente con PostgreSQL real](prueba-concurrencia-harvest-f5.4.md) especifica dos conexiones, commit/rollback del ganador, mismo UUID y cierre concurrente de sesión.

F5.5 necesita publicar y persistir el [contrato de caché Harvest](harvest-cache-f5.5.md), reservar tickets localmente de forma atómica junto a la intención, reconstruir agregados desde esa caché y reconciliar confirmaciones/conflictos sin alterar el histórico. Debe definir la transición de comandos antiguos, manejo de nuevas cosechas en la UI y la migración local que corresponda. El backend sigue siendo la autoridad entre dispositivos.

Ambas migraciones nuevas se añaden y se prueban localmente. No se despliegan automáticamente a Supabase remoto; deben aplicarse antes de distribuir el cliente actualizado.
