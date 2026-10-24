# Harvest F5.5: caché, reservas offline y reconciliación

Este documento describe F5.5. [F5.6](harvest-tickets-f5.6.md) introduce después la selección explícita de modelo por campaña, la retirada de escrituras legacy y las proyecciones comunes de reportes; mantiene IndexedDB v5 y los comandos anteriores.

El PDA compone por defecto los nuevos casos `crearSolicitarAsignacionHarvest` y `crearSolicitarConsumoHarvest` mediante el puerto `HarvestLocal`. Seleccionar/buscar cosechador y escanear sigue siendo el flujo operativo. La asignación local se presenta como reserva pendiente. Registrar una lectura reserva el consumo; el trabajador se deriva del lote efectivo, sin recibirlo como dato confiable del cliente.

## IndexedDB v5

La actualización de `scc` v4 a v5 es aditiva. No borra ni reconstruye stores existentes y no reescribe sus filas durante la migración. Conserva `meta`, `operadores`, `trabajadores`, `lotes`, `tickets`, `cola`, `sesiones` y `lecturas`, incluidas las operaciones pendientes/error, autorizaciones y cachés de todas las campañas. Las migraciones anteriores siguen ejecutándose para bases más antiguas.

| Store nuevo           | Clave                        | Contenido                                               |
| --------------------- | ---------------------------- | ------------------------------------------------------- |
| `harvestTickets`      | `[campaniaId, codigo]`       | Identidad y referencia al lote del snapshot             |
| `harvestLotes`        | `[campaniaId, id]`           | Lotes de tickets del snapshot                           |
| `harvestAsignaciones` | `[campaniaId, loteId]`       | Asignaciones confirmadas                                |
| `harvestRegistros`    | `[campaniaId, codigoTicket]` | Registros confirmados; su existencia representa consumo |
| `harvestReservas`     | `operacionId`                | Intenciones de asignación/consumo y su resolución       |

Todos tienen índice `campania`. Las reservas tienen además `recurso` sobre `[campaniaId, tipo, recurso]`: el recurso es el lote para asignación y el código para consumo. `meta[harvest:<campania>]` conserva el snapshot completo conocido y los enlaces UUID↔DNI de Workforce. Los stores de lotes físicos y tickets legacy mantienen su significado anterior.

La cola añade metadatos **fuera del payload**: `modelo: HARVEST`, `origenVersion: 5` y `dependencias`. Las reservas pueden estar `ACTIVA`, `CONFIRMADA`, `RECHAZADA` o `BLOQUEADA`; la compatibilidad explícita puede resolver una intención v4 como `COMPATIBILIDAD_LEGACY`. El UUID, el payload y los nombres de los comandos se conservan.

## Estado efectivo y escritura atómica

Para resolver un código se consulta el ticket, su lote, la asignación/registro confirmados y las reservas de ambos recursos. Una reserva solo está activa si su comando continúa `PENDIENTE`. Se reconstruyen instancias de dominio nuevas y se aplican las reservas sobre ese estado, sin modificar los hechos del servidor:

```text
hechos confirmados + reservas activas = estado efectivo del PDA
```

Una reserva de asignación resuelve el trabajador de todos los tickets hermanos. Un trabajador provisional usa una referencia local explícita `DNI:<dni>` hasta obtener el UUID confirmado; no se presenta como identidad del servidor. El enlace confirmado se mantiene aunque llegue una respuesta de caché anterior al ACK.

La asignación comprueba la autorización vigente de Identity, la campaña asignada de Campaign Management y el estado efectivo del lote. Obtiene el cosechador mediante el contrato público de Workforce y escribe provisional, reserva y `ASIGNAR_TICKET` en una transacción IndexedDB.

El consumo comprueba autorización, campaña, sesión activa del operador y dependencias pendientes de sesión/jabero. Resuelve el lote y su trabajador efectivo, rechaza consumo confirmado o reservado, y escribe lectura provisional, reserva y `REGISTRAR_JABA` en una transacción. Un aborto revierte también el UUID/orden generado en `meta` y todas las escrituras de la cola. Las transacciones compartidas serializan dos reservas locales del mismo recurso, también desde conexiones distintas a la misma base.

Application accede únicamente a puertos. El adapter `infrastructure/indexeddb/harvestAdapter.js` delega las transacciones en `offline/harvest.js`; Domain no importa IndexedDB, infraestructura, puertos técnicos ni DOM. Los casos anteriores permanecen disponibles para caracterización/compatibilidad mediante una composición explícita `legacy: true`; bootstrap utiliza la composición nueva.

## Publicación y renovación

La migración `202610140400_harvest_snapshot.sql` publica `harvest_obtener_snapshot`, autorizado por los contratos existentes. Un SELECT produce el grafo completo de la campaña bajo una misma instantánea MVCC. El helper interno `workforce_identidades_campania` publica el vínculo UUID↔DNI y no está habilitado para llamadas directas de `anon`/`authenticated`. No crea roles ni duplica decisiones de autorización.

El adapter Supabase consume el [contrato de caché](harvest-cache-f5.5.md) y lo incorpora al refresco operativo. La escritura de las cachés anteriores y del grafo Harvest es atómica: un snapshot inválido aborta todo el refresco. No elimina reservas ni sobreescribe intenciones. Los hechos confirmados son monotónicos porque no existe un API de borrado/reasignación/reapertura: un snapshot iniciado antes de un ACK no vuelve a disponer un ticket consumido. Un ACK incorpora únicamente su grafo de operación; no cambia el identificador de la última instantánea completa.

## Reconciliación

El éxito confirma hechos, reserva, cola y lectura en una transacción. Se comprueban código, campaña, sesión y `operacionId` de la respuesta. Si el servidor devuelve el registro original de una operación ya realizada, la lectura mantiene su clave local y guarda `registro_confirmado_id`, trabajador y fecha del registro confirmado. Un reintento conserva el UUID original.

Un error temporal conserva `PENDIENTE` y la reserva, para reintentar la misma operación. Un rechazo permanente guarda `ERROR`, el mensaje y el recibo local; cambia la reserva a `RECHAZADA`. Sus dependientes pasan a `ERROR`/`BLOQUEADA`, incluidas las lecturas de tickets hermanos y las dependencias de sesión/jabero. No se envían como si la asignación hubiese sido válida.

Una lectura rechazada conserva su fila para auditoría con `valida: false`, `estado_sync: ERROR` y el motivo. `obtenerLecturasSesionCompletas` permite inspeccionarla. Los contadores, el total por cosechador y la última lectura válida excluyen tanto estas filas como las lecturas asociadas a comandos `ERROR`. La vista activa vuelve a consultar los conteos tras sincronizar, sin limpiar un escaneo en curso ni ocultar su error.

Un rechazo Harvest reconciliado lleva `rechazoHarvest: true`: permanece visible, pero los siguientes ciclos pueden enviar operaciones independientes. Sus dependientes permanecen bloqueadas. Los errores legacy conservan el bloqueo anterior por campaña. Reintentar es explícito, vuelve a autorizar, exige dependencias no rechazadas y valida que el recurso siga disponible; no reactiva silenciosamente los hijos.

Ante `LoteYaAsignado`, `TicketYaUtilizado` o `TicketNoEncontrado` se intenta refrescar la autoridad. Si no es posible, la reserva invalidada conserva `autoridadIncierta` y bloquea el recurso hasta conocer el estado positivo confirmado. No se inventa un registro para representar el rechazo. Un snapshot que revela otra operación ganadora invalida las reservas incompatibles y sus lecturas dependientes.

La limpieza de recibos sincronizados antiguos conserva aquellos referenciados por comandos pendientes/error y los inicios de sesiones activas. Las operaciones capturan su campaña; un ACK tardío tras cambiar de campaña escribe únicamente en la campaña original.

## Pendientes v4 e histórico

La migración no transforma comandos. Al incorporar caché o reservar, las intenciones v4 que resuelven inequívocamente tickets Harvest se superponen mediante reservas y dependencias, conservando ID y payload. Las repeticiones ya encoladas para un ticket nuevo se rechazan de manera auditable. Una intención con código desconocido/legacy/ambiguo no se transforma automáticamente.

La migración `202610140500_harvest_compatibilidad_v4.sql` introduce `harvest_asignar_v4` y `harvest_registrar_v4`. Consultan primero el recibo anterior y, si falta, el namespace del código; delegan al modelo correspondiente y devuelven `modelo: HARVEST|LEGACY` explícito. El delegado conserva su alcance, huella y bloqueo transaccional originales. Un código presente en ambos modelos sin recibo se rechaza para revisión. No hay fallback por fallo de red, autorización o esquema.

Los pendientes legacy siguen escribiendo únicamente en sus tablas anteriores y admitiendo lecturas repetidas. No se migra ni reinterpreta `lecturas_jaba`. Los comandos nuevos v5 siempre usan los casos Harvest de F5.3/F5.4. No se eliminan stores, tablas, comandos ni casos anteriores. Los reportes de servidor, Google Sheets y Apps Script no cambian ni mezclan fuentes.

## Validación y preparación de F5.6

Las pruebas cubren la migración real v4→v5 comparando todos los datos/claves/índices anteriores, reapertura de conexión, reservas simultáneas locales, consumo único y segundo escaneo, abortos tras escrituras nativas de IndexedDB, cache con pendientes/ACK tardío, confirmación/rechazo, dependencias de hermanos y sesión, conteos, autoridad incierta, campañas y comandos v4. Hay un recorrido Application→IndexedDB→cola→RPC real ejecutado en PGlite y pruebas de arquitectura que mantienen Application independiente de IndexedDB.

Las migraciones nuevas deben aplicarse en Supabase antes de desplegar esta PWA; esta implementación no las ejecuta en producción. Sigue pendiente la [prueba de concurrencia con PostgreSQL real](prueba-concurrencia-harvest-f5.4.md), incluyendo dos dispositivos desconectados que reconcilian el mismo recurso. PGlite no demuestra concurrencia entre conexiones PostgreSQL.

Para F5.6 quedan la presentación y gestión completa de conflictos/auditoría y la evolución explícita de consultas/reportes hacia las fuentes nuevas, según su alcance aprobado. El histórico legacy exige una política separada; no puede convertirse suponiendo uso único. La cobertura actual descarga campañas completas: paginación, cursor incremental y bajas requieren ampliar el contrato antes de incorporarlos. No se anticipa ninguna de esas migraciones en F5.5.
