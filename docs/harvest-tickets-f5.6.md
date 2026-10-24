# Harvest F5.6: cutover por campaña y reportes

Implementación local. Las migraciones nuevas **no se han desplegado remotamente**. Los tests de PGlite verifican comportamiento SQL, no concurrencia entre conexiones PostgreSQL. F5.6 no está validada en producción: siguen pendientes [PostgreSQL real y PDA en staging](prueba-concurrencia-harvest-f5.6.md).

## Activación explícita

`202610140600_harvest_cutover.sql` introduce `harvest_cutovers`: una fila por campaña con `version = 1`, `activado_en` y `activado_por`. Aplicar la migración no activa campañas. La activación administrativa utiliza:

```sql
select public.admin_activar_harvest_campania(:campania_id, 1);
```

El RPC requiere una identidad autenticada y el contrato existente `autorizar_integracion_gestion_maestros`, limitado a la campaña solicitada. Restablece el contexto de autorización al terminar. No duplica permisos de Identity/Campaign. La primera activación exige campaña activa; repetirla devuelve la misma política. La API no permite mover la fecha, cambiar versión, desactivar ni borrar el corte. Tampoco permite TRUNCATE. Una versión futura requiere una evolución explícita del contrato.

La frontera es **admisión transaccional del servidor**, no `fecha_hora` enviada por el cliente. El corte toma un bloqueo exclusivo sobre la fila de campaña. Los escritores toman un bloqueo compartido: las escrituras legacy ya admitidas terminan antes del corte; las posteriores se rechazan, aunque envíen una fecha anterior. La activación también cambia la tupla de campaña (`updated_at`) para que escritores con snapshots antiguos en REPEATABLE READ/SERIALIZABLE fallen por serialización y deban reintentar. Esto debe comprobarse en PostgreSQL real.

## Fuentes disjuntas y conservación histórica

Antes del corte los nuevos hechos productivos se escriben en `lecturas_jaba`. Al confirmar el corte, ese conjunto queda congelado para la campaña. Desde entonces las nuevas cosechas se escriben exclusivamente en `harvest_registros_cosecha`.

Los triggers protegen INSERT, UPDATE y DELETE en `lecturas_jaba` y `asignaciones_ticket`, incluyendo RPC antiguos y DML directo con permisos de escritura. Las relaciones lectura/asignación/sesión deben pertenecer a la misma campaña. No hay escrituras legacy retroactivas. Repetir una operación ya admitida devuelve su recibo, sin insertar filas. Un pendiente legacy que nunca llegó al servidor queda rechazado para revisión; no se cambia automáticamente su significado.

Los nuevos `RegistroCosecha` llevan `version_produccion`, con FK compuesta a la política de su campaña. El trigger fija esa versión y `creado_en` en el servidor; exige sesión y operación. Los registros productivos son inmutables. Se conservan la transacción de consumo, unicidad del ticket, trabajador derivado de la asignación e idempotencia de F5.4. Reutilizar el UUID de un hecho de la otra fuente se rechaza.

No se convierten lecturas históricas ni se deduplican por código: las repeticiones legacy son hechos distintos. Las filas Harvest de fases piloto anteriores a F5.6 conservan `version_produccion = NULL`: sus tickets siguen consumidos pero esos registros no se vuelven producción reportable. Antes de activar una campaña se debe revisar cualquier producción piloto real; esta fase no inventa una migración inequívoca. El ACK de un recibo Harvest antiguo añade su versión autoritativa a la respuesta, conservando el recibo guardado y sus identidades originales.

## Proyecciones de reportes

`202610140610_harvest_proyecciones.sql` publica internamente `harvest_produccion_reportable`. Combina con UNION ALL:

- hechos legacy congelados, identificados por su UUID y trabajador;
- registros Harvest con versión correspondiente al corte y fecha de admisión servidor desde su activación.

No filtra fuentes por la fecha del evento. Una cosecha offline admitida después del corte puede aparecer en un día anterior al corte sin duplicarse. No usa la presencia de tickets o registros para decidir el modelo.

Resumen, ranking, producción diaria y producción por lote consultan la misma proyección. El trabajador se unifica por UUID. El lote del reporte es el **lote físico de la sesión**, con su variedad, distinto de `LoteDeTickets`. Se conservan fechas, zonas horarias, filtros de ranking y comparación administrativa con el período anterior. Los RPC por campaña mantienen autorización y aislamiento; los administrativos conservan el acceso existente a campañas cerradas. La vista y sus helpers no tienen acceso público directo.

Los DTO actuales conservan `total_jabas` y `ultima_lectura`; no son nombres del dominio nuevo. Las cachés de reportes se renuevan mediante los RPC existentes, sin fusionar otra vez fuentes en JavaScript. No se modifican archivos de Google Sheets ni Apps Script.

## PDA, caché y comandos anteriores

El snapshot autorizado añade `cutover` y `versionProduccion` según [el contrato actualizado](harvest-cache-f5.5.md). `cutover: null` significa campaña legacy; una política válida significa Harvest. Un snapshot anterior que omite el campo requiere renovar caché antes de crear nuevas operaciones en la composición actual. No se infiere la política por contenido ni por reloj del PDA. Una política confirmada sobrevive snapshots tardíos que omiten el corte o traen null; una política diferente se rechaza atómicamente.

Application elige el flujo por esa política. Antes del corte conserva asignación por código y lecturas repetidas, marcando explícitamente la intención `modelo: LEGACY`. Después reserva `LoteDeTickets` y crea solicitudes de `RegistroCosecha`, con las invariantes offline de F5.5. Los writers locales legacy revisan la política en su misma transacción, protegiendo también el intervalo entre selección del caso de uso y escritura.

Se mantienen **ASIGNAR_TICKET y REGISTRAR_JABA**. No se añaden tipos nuevos ni se eleva IndexedDB: continúa v5. Los metadatos de modelo están fuera del payload y no modifican UUID ni comandos pendientes. El adapter sigue resolviendo comandos v4 sin modelo por recibo primero; sin recibo, usa el corte explícito y el namespace conocido. Los códigos ambiguos se rechazan para revisión. Las intenciones legacy explícitas nunca se reinterpretan como Harvest.

Un dispositivo que solo conoce una política legacy antigua puede seguir generando intenciones offline hasta reconectarse; no puede conocer un corte remoto desconectado. El servidor las rechaza si no fueron admitidas antes. Es necesario renovar la caché y coordinar la activación operativa con los dispositivos.

Al recibir el corte, las lecturas legacy pendientes dejan de contar hasta resolver su recibo. Un ACK legacy anterior restaura el conteo; un rechazo conserva intención y error, invalida producción y bloquea dependientes. Un rechazo por retirada del modelo impide reintentos automáticos tanto del padre como de sus dependientes. Un ACK o snapshot que identifica un consumo piloto mantiene el ticket utilizado y excluye su proyección local del conteo. Las reservas Harvest continúan separadas del snapshot y se reconcilian atómicamente.

El factory nuevo se llama `crearSolicitarRegistroCosecha`; `crearSolicitarConsumoHarvest` queda como alias transicional. `lecturas` local, `lecturaId`, nombres de métodos UI y campos DTO se mantienen como adaptaciones de compatibilidad. `RegistroCosecha` y las reglas del nuevo dominio no dependen de filas legacy ni de IndexedDB.

## Retirada futura y validación

Se mantienen tablas, datos, stores, aliases, factories legacy, wrappers de RPC y el adapter de comandos antiguos. Podrán retirarse **solo después de demostrar**:

1. Que no existen clientes antiguos, integraciones escritoras ni PDA con versiones almacenadas del service worker anterior.
2. Que no hay operaciones pendientes o en error de esos clientes, incluyendo dispositivos sin conectar; que respuestas perdidas pueden resolverse durante el período de retención de recibos.
3. Que todas las campañas destinadas al nuevo modelo tienen una política revisada y las pruebas de PostgreSQL/staging están aprobadas.
4. Que consumidores de reportes ya aceptan los contratos semánticos que sustituyan aliases actuales.

Entonces podrá sustituirse el transporte por `ASIGNAR_LOTE_TICKETS`/`REGISTRAR_COSECHA`, retirar factories escritoras legacy y reducir wrappers/aliases. No debe borrarse el histórico: su fuente de consulta seguirá siendo necesaria mientras se reporten campañas con producción legacy. Archivar o eliminar datos exige otra decisión explícita, ajena a F5.6.

La suite local cubre la frontera anterior/posterior, campaña sin corte y ya migrada, reportes cruzando el corte, ausencia de doble conteo, aislamiento, permisos, rollback, inmutabilidad, pendientes antiguos, ACK piloto, política monotónica, transición de PDA y rechazos/dependientes. Se mantienen las pruebas de arquitectura y atomicidad offline de fases anteriores. La concurrencia real y el comportamiento físico del PDA siguen pendientes, no sustituidos por PGlite/fake-indexeddb.
