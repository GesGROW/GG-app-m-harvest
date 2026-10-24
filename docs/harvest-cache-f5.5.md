# Contrato de caché requerido por F5.5

Contrato implementado en F5.5. `harvest_obtener_snapshot` publica una instantánea autorizada por campaña; el adapter Supabase valida su grafo y la incorpora como `cache.harvest` al refresco operativo. IndexedDB v5 la consume sin sobrescribir las reservas pendientes. Véase [implementación y reconciliación](harvest-tickets-f5.5.md).

F5.6 amplía este contrato de forma aditiva con la política de cutover y la versión productiva del registro. La versión de IndexedDB permanece en 5. Véase [cutover y reportes](harvest-tickets-f5.6.md); las migraciones siguen sin desplegarse remotamente.

## Snapshot de dominio

La publicación autoriza al operador mediante el contrato existente Identity/Campaign y obtiene todas las listas en un único SELECT, bajo la misma instantánea MVCC. Publica nombres de dominio, sin filas de PostgreSQL en Application/Domain. Ejemplo con identidades ilustrativas:

```json
{
  "versionContrato": 1,
  "tipo": "SNAPSHOT",
  "snapshotId": "snapshot-opaco",
  "campaniaId": "C",
  "operadorDni": "12345678",
  "obtenidoEn": "2026-10-14T12:00:00Z",
  "completo": true,
  "cutover": {
    "campaniaId": "C",
    "version": 1,
    "activadoEn": "2026-10-14T11:00:00Z"
  },
  "lotesDeTickets": [
    {
      "id": "LT",
      "campaniaId": "C",
      "estado": "ASIGNADO",
      "asignacionOperacionId": "ASIG"
    }
  ],
  "asignacionesDeLote": [
    { "loteId": "LT", "campaniaId": "C", "trabajadorId": "W", "operacionId": "ASIG" }
  ],
  "tickets": [
    {
      "codigo": "T1",
      "loteId": "LT",
      "campaniaId": "C",
      "estado": "DISPONIBLE",
      "registroId": null,
      "consumoOperacionId": null
    },
    {
      "codigo": "T2",
      "loteId": "LT",
      "campaniaId": "C",
      "estado": "UTILIZADO",
      "registroId": "R",
      "consumoOperacionId": "CONSUMO"
    }
  ],
  "codigosLegacy": [],
  "identidadesTrabajadores": [{ "id": "W", "dni": "87654321" }],
  "registrosCosecha": [
    {
      "id": "R",
      "codigoTicket": "T2",
      "loteId": "LT",
      "campaniaId": "C",
      "trabajadorId": "W",
      "asignacionOperacionId": "ASIG",
      "sesionId": "S",
      "operacionId": "CONSUMO",
      "fechaHora": "2026-10-14T11:59:00Z",
      "registradoEn": "2026-10-14T12:00:00Z",
      "versionProduccion": 1
    }
  ]
}
```

Los códigos son identidades globales, recortados y sensibles a mayúsculas. Las identidades de lote, operación, registro, sesión y trabajador persistidos actualmente son UUID; el ejemplo no prescribe una convención comercial del código.

El estado `UTILIZADO` debe derivarse de la presencia de su registro. `registroId`/`consumoOperacionId` son referencias comprobables, no flags independientes que puedan contradecir el registro. El lote `ASIGNADO` requiere una asignación única; un lote disponible tiene referencia de asignación nula. La atribución del registro coincide con la asignación; las referencias siempre pertenecen a la campaña del snapshot.

`fechaHora` corresponde a la fecha del evento enviada al registrar; `registradoEn` viene de la fecha del servidor. Una fecha no sustituye a un cursor de cambios ordenado por commit. `snapshotId` identifica la instantánea, sin prometer que sea un número monotónico. Si hay paginación, todas las páginas deben pertenecer a la misma instantánea y señalar cuándo está completa. No se debe inferir un borrado de una página parcial. Un endpoint incremental, si se incorpora, necesita semántica adicional de cursor y bajas que F5.4 no implementa.

Los estados prototipo se publican como consumidos cuando existe su registro. `sesionId`, `operacionId` y `registradoEn` pueden ser nulos en esos estados; siguen bloqueando el consumo. No se inventan referencias ni se completan usando `lecturas_jaba`.

## Extensión F5.6: política y admisión productiva

`cutover: null` declara explícitamente LEGACY. El objeto `cutover` declara HARVEST para su campaña y versión 1, sin comparar el reloj local con `activadoEn`. Ausencia del campo significa política desconocida: el snapshot antiguo puede incorporarse para compatibilidad y reconciliación, pero la composición actual requiere renovar caché para crear nuevas operaciones. La política se guarda en `meta[harvest:<campania>]`; una confirmada no puede perderse por un snapshot tardío null/ausente ni cambiar a otro instante/versión.

`versionProduccion: 1` indica un registro admitido después del corte. `null` indica consumo piloto anterior, excluido de producción pero todavía bloqueante para el ticket. Ausencia indica un protocolo anterior que requiere enriquecimiento desde servidor. La versión conocida no puede alterarse ni desaparecer al fusionar un ACK antiguo. Un snapshot que identifica un piloto corrige también su proyección local previamente confirmada.

Las lecturas legacy pendientes se marcan `revision_corte: true`, `valida: false` al conocer el corte, sin cambiar su comando. Solo su recibo servidor puede demostrar admisión anterior: el ACK restaura validez; el rechazo conserva auditoría y bloquea dependientes. No se convierte una lectura a RegistroCosecha usando código/fecha. Los comandos v4 sin modelo conservan el adapter por recibo y namespace; los creados por el flujo legacy actual declaran `modelo: LEGACY` fuera del payload.

## Cobertura e integración local

F5.5 descarga toda la campaña autorizada, sin paginación ni cursor incremental. Una ausencia local impide operar sin conexión; no demuestra inexistencia global. La vigencia offline utiliza la autorización diaria de Identity y las campañas de Campaign Management. Las sesiones actuales mantienen su identidad y pertenecen a una campaña y un operador.

`codigosLegacy` es un inventario de códigos asignados en el namespace anterior, utilizado únicamente para decidir qué intenciones v4 pueden reservar recursos Harvest. No contiene ni convierte lecturas históricas. Un código presente en ambos modelos es ambiguo para una operación v4 sin recibo: el servidor la rechaza para revisión.

`identidadesTrabajadores` es la proyección mínima UUID↔DNI publicada por el contrato SQL de Workforce. Completa el vínculo que falta en las cachés legacy basadas en DNI. No contiene autorización ni crea roles. El nombre y la aptitud siguen viniendo de Workforce; el trabajador del registro procede de la asignación del lote.

La instantánea y todas sus referencias se incorporan atómicamente por campaña, separadas de los lotes físicos de las sesiones. La validación reconstruye los agregados y comprueba campaña, referencias, asignación y consumo. Los hechos confirmados se fusionan: como no existen endpoints de borrado, reasignación ni reapertura, un snapshot antiguo no puede borrar una asignación o consumo confirmado por un ACK. El identificador del último snapshot completo se conserva al incorporar un ACK de operación.

Al escanear se reconstruyen `Ticket`, `LoteDeTickets` y `AsignacionDeLote` consultando el código y las referencias indexadas. No se carga la campaña completa para resolver un código. Las reservas activas se superponen a los hechos confirmados para construir el estado efectivo; las estructuras de servidor permanecen separadas. `CONSUMO_PENDIENTE` impide el segundo escaneo, sin declarar `UTILIZADO` confirmado. Reserva, comando y lectura provisional se escriben en una única transacción.

El comando conserva identidades estables: `operacionId`, `registroId`, código, campaña, operador, sesión y fecha. Un reintento conserva el UUID original y admite que el servidor devuelva el ID/fecha originalmente confirmados. No se genera una operación nueva para resolver una respuesta perdida.

Un ACK incorpora los hechos, cambia la reserva a `CONFIRMADA` y sincroniza el comando y la lectura en una transacción. La reserva confirmada se conserva como recibo local, pero deja de superponerse. Un rechazo preserva la intención/error, invalida la reserva y excluye la lectura del conteo. El rechazo de la asignación bloquea también los consumos de sus tickets hermanos. Ante conflicto de dominio se solicita un snapshot autoritativo; si falla, el recurso queda bloqueado hasta conocer su estado, sin inventar asignación ni consumo.

Los comandos conservan `ASIGNAR_TICKET` y `REGISTRAR_JABA`, sus payloads y UUID. Las nuevas intenciones añaden metadatos fuera del payload (`modelo`, `origenVersion`, `dependencias`). Los comandos v4 conservan su recibo original; el servidor declara explícitamente si pertenecen a Harvest o al modelo legacy. No se usa un error de red o un RPC ausente como motivo para cambiar de modelo.

Ninguna caché elimina conflictos entre dispositivos desconectados. PostgreSQL conserva la autoridad final de asignación y consumo único. La prueba con dos conexiones reales sigue pendiente en [el protocolo F5.4](prueba-concurrencia-harvest-f5.4.md); PGlite no demuestra esa concurrencia.
