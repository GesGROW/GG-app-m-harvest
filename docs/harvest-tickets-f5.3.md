# Harvest F5.3: asignación operativa de lote

Este documento conserva el alcance original de F5.3. [F5.4](harvest-tickets-f5.4.md) añade confirmación de cosecha y consumo único; la proyección offline nueva sigue pendiente de F5.5.

La asignación confirmada del PDA usa ahora el modelo nuevo: escanear un código existente identifica su `LoteDeTickets` y asigna el agregado completo. El trabajador se referencia una vez en `harvest_asignaciones_lote`; los demás tickets se asocian por su `lote_id`. No se crean asignaciones individuales ni se consume ningún ticket.

## Recorrido productivo

La UI mantiene la selección/búsqueda de cosechador y el escaneo. Conserva `casosDeUso.asignarTicket`, la escritura atómica local de intención y su presentación actual. Mientras está sin conexión, esa intención es provisional: la caché de un código escaneado no contiene ni valida todo el catálogo y no decide la asignación del lote.

Al sincronizar, la secuencia es:

```text
UI → intención local ASIGNAR_TICKET
   → sync con operacion.id estable
   → backend.asignarTicket (alias compatible)
   → AsignarLoteDeTickets
   → RepositorioTicketsHarvest.asignarLoteDesdeTicket
   → harvest_asignar_lote_tickets
   → agregados reconstruidos / confirmación de cola
```

El payload sigue siendo `{ dniOperador, dniCosechador, codigoTicket, campaniaId }`. `operacionId` sigue en la identidad de la operación y se envía al sincronizar. No cambian versión 4, object stores, estados, partición por campaña ni políticas de reintento/descarte de IndexedDB. Un fallo temporal conserva la operación pendiente con el mismo UUID; un rechazo definitivo marca el código local con error y conserva el bloqueo de cola existente.

`crearAsignarLoteDeTickets` recibe código, cosechador o trabajador, campaña, operador y operación. No consulta un catálogo previamente para decidir ni recibe filas SQL. Pasa el contexto al puerto transaccional y devuelve `CatalogoDeTickets`, `LoteDeTickets`, `Ticket` y `AsignacionDeLote` reconstruidos. También está disponible en la composición `crearTicketsHarvest`.

No hay fallback al RPC de asignación por ticket, ni inferencia de campaña si falta contexto. Los tickets deben generarse con F5.2 y la migración nueva debe aplicarse antes de distribuir este cliente. Una intención antigua pendiente cuyo código no exista en `harvest_tickets` se rechaza; no se crea un lote implícito ni se migran asignaciones históricas.

## Autorización y decisión SQL

`202610140200_harvest_asignar_lote.sql` publica `harvest_asignar_lote_tickets` y añade `UNIQUE(operacion_id)` en asignaciones. Reutiliza:

- `autorizar_operador_campania`: contrato vigente de Identity/Campaign para autorización diaria, campaña activa y participación.
- `fijar_campania_operacion`: identidad de operación, operador, campaña y tipo de comando; bloquea la fila del UUID operativo.
- `obtener_o_registrar_cosechador_activo`: contrato de Workforce para trabajador activo y alta provisional. Recibe la campaña mediante el contexto que ya utiliza el helper vigente; el contexto se restaura.

Harvest no copia roles, políticas de identidad ni selección global de campaña. El RPC mantiene el contrato actual del PDA por DNI del operador y puede ejecutarse por `anon`/`authenticated`; la autorización se vuelve a comprobar en el servidor incluso al repetir una operación. Esto no concede acceso directo a las tablas ni altera los permisos administrativos de F5.2.

La transacción bloquea el ticket representativo con `FOR SHARE` y el lote con `FOR UPDATE`, valida la pertenencia de ambos a la campaña, comprueba el recibo idempotente y finalmente crea la asignación. El helper de trabajador, la fila de asignación, el contexto de operación y el recibo confirmado se confirman o revierten juntos. Un fallo tardío en el recibo no deja una asignación o un trabajador provisional huérfanos.

La huella de operación incluye campaña, operador, trabajador por DNI y lote. La misma operación puede reintentarse con el mismo código o con un ticket hermano: devuelve la misma asignación y un catálogo para el código solicitado. Cambiar trabajador, lote, campaña u operador reutilizando el UUID se rechaza.

Se conserva la regla de F5.1: **otra operación sobre un lote asignado produce `LoteYaAsignado`, incluso para el mismo trabajador**. El cliente debe reintentar la operación original, no fabricar un UUID para presentar el reintento como una asignación nueva.

La PK por lote impide dos asignaciones simultáneas y el índice único por operación impide confirmar dos lotes con el mismo UUID. Las FK compuestas de F5.2 protegen la pertenencia por campaña. El bloqueo y los constraints de PostgreSQL son la autoridad final; los chequeos locales solo evitan duplicar la misma intención escaneada en la caché.

Los adapters traducen los rechazos a `TicketNoEncontrado`, `TicketSinLote`, `CampaniaTicketIncorrecta` o `LoteYaAsignado`. Los fallos de acceso/transporte conservan los errores neutrales y su clasificación temporal. Una migración ausente se informa como operación no disponible, sin probar el RPC legacy.

## Límites y F5.4

No se modifican `REGISTRAR_JABA`, sesiones, lecturas repetidas, reportes, Google Sheets, Apps Script ni el `RegistroCosecha` productivo. Los RPC y tablas legacy siguen disponibles para sus funciones anteriores. Esta fase no escribe `asignaciones_ticket` ni proyecta todos los tickets nuevos a la caché de lecturas legacy.

Por ello, **un ticket recién asignado mediante Harvest todavía no tiene una asignación legacy para el RPC de lectura actual**. No se considera implementada la cosecha de esos tickets. Las lecturas históricas siguen con sus reglas previas; la adaptación de la lectura y su caché pertenece a F5.4. Una proyección local del código escaneado puede permitir guardar una intención legacy de lectura, pero no hace que el servidor legacy acepte ese nuevo ticket.

F5.4 debe sustituir el registro operativo por el nuevo consumo único, resolver el trabajador desde la asignación del lote, persistir `RegistroCosecha` y el consumo en una transacción, definir los reintentos del registro y adaptar la información de tickets disponible para lectura en PDA/offline. También debe resolver explícitamente la convivencia de lecturas históricas repetidas y comandos legacy con el modelo nuevo. No se anticipan aquí cambios de reportes, formato de cola, esquema local ni migración de datos.

## Pruebas

Las pruebas de aplicación y transporte verifican contexto, reconstrucción, errores y ausencia de fallback. Las pruebas SQL ejecutan la autorización y los helpers reales junto al RPC nuevo, comprueban todos los conflictos, rollback provocado después de insertar la asignación y constraints. La prueba de recorrido completo usa IndexedDB v4 y simula una respuesta perdida después del commit SQL: la cola reintenta el mismo UUID y solo existe una asignación.

PGlite serializa las sentencias en una instancia. Sus solicitudes competidoras verifican exclusividad y manejo de conflictos, **no demuestran concurrencia entre conexiones PostgreSQL**. La prueba pendiente con sesiones independientes está descrita en [prueba-concurrencia-harvest-f5.3.md](prueba-concurrencia-harvest-f5.3.md).

La migración se añade y se prueba localmente; no se aplica automáticamente a Supabase remoto.
