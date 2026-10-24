# Harvest: modelo de tickets en F5.1

Este documento describe el alcance original de F5.1. [F5.2](harvest-tickets-f5.2.md) añade generación, persistencia y reconstrucción sin sustituir los flujos legacy.

El nuevo modelo se publica desde `shared/src/contexts/harvest/index.js`. Todavía no se conecta a la composición productiva. Las pruebas unitarias importan exclusivamente el dominio y las herramientas de pruebas de Node.

## Modelos y reglas

- **LoteDeTickets** es el agregado que protege la asignación. Tiene identidad y referencia obligatoria e inmutable a una campaña, nace disponible y conserva una única `AsignacionDeLote`. No contiene tickets ni representa un lote físico.
- **Ticket** es un agregado independiente. Su código es su identidad y tiene una referencia obligatoria e inmutable a un solo lote. Protege su transición de disponible a utilizado y conserva como máximo un `RegistroCosecha`.
- **AsignacionDeLote** es un modelo inmutable con lote, trabajador y clave de operación. Repetir la misma clave y trabajador dentro del mismo lote devuelve la asignación original, incluso escaneando otro ticket del lote. Una clave diferente o un trabajador diferente produce `LoteYaAsignado`; no hay reasignación en esta subfase.
- **RegistroCosecha** es el resultado inmutable del uso de un ticket. Incluye identificador, código, lote, campaña, fecha/hora y atribución a la asignación. El trabajador y la clave de asignación se obtienen de `AsignacionDeLote`, nunca de un trabajador enviado al registrar.

`CatalogoDeTickets` es un servicio de dominio que recibe ambos conjuntos de agregados independientes. Rechaza códigos repetidos, identidades de lote repetidas y referencias a lotes ausentes. Los identificadores se recortan y son sensibles a mayúsculas. La unicidad del código abarca el conjunto recibido, incluso entre campañas. No es un repositorio ni una caché técnica.

El catálogo identifica el agregado completo de lote desde cualquier ticket, asigna ese lote y coordina el registro sobre el agregado ticket. El uso de un ticket no consume los otros tickets del lote. Para registrar se exige el lote correcto y asignado; cualquier segundo registro del mismo ticket produce `TicketYaUtilizado`, incluso si repite el identificador de registro. Una operación rechazada conserva el estado anterior.

Los errores explícitos incluyen `LoteYaAsignado`, `TicketYaUtilizado`, `TicketSinLote`, `LoteSinAsignar`, `TicketDuplicado`, `TicketNoEncontrado`, `LoteDeTicketsDuplicado` y `DatoDeTicketsInvalido`, derivados de `ErrorDominioTickets`.

Los identificadores de operación/registro y la fecha/hora son entradas del llamador. El dominio no genera UUID ni consulta reloj, red, APIs del navegador, puertos técnicos o infraestructura. No se agregaron casos de aplicación porque la coordinación de estas reglas se expresa con el catálogo de dominio.

## Ejemplo aislado

```js
import {
  CatalogoDeTickets,
  LoteDeTickets,
  Ticket
} from '../shared/src/contexts/harvest/index.js'

const lote = new LoteDeTickets({ id: 'LT-1', campaniaId: 'C-1' })
const catalogo = new CatalogoDeTickets({
  lotes: [lote],
  tickets: [
    new Ticket({ codigo: 'T-1', loteId: lote.id }),
    new Ticket({ codigo: 'T-2', loteId: lote.id })
  ]
})
catalogo.asignarLoteDesdeTicket({
  codigoTicket: 'T-1',
  trabajadorId: 'TRABAJADOR-1',
  operacionId: 'OP-1'
})
const registro = catalogo.registrarCosechaDesdeTicket({
  codigoTicket: 'T-2',
  id: 'RC-1',
  fechaHora: '2026-10-14T12:00:00.000Z'
})
// registro.trabajadorId === 'TRABAJADOR-1'
```

## Compatibilidad y siguiente fase

`crearAsignarTicket`, `asignarTicket`, `crearRegistrarLecturaJaba`, `registrarLecturaJaba`, sesiones, consultas, reportes, validaciones legacy, UI y composición siguen usando los DTO y comportamientos anteriores. En particular, la lectura legacy sigue aceptando tickets repetidos y atribuyendo el cosechador desde el ticket cacheado. No se convierte un DTO histórico en un ticket nuevo ni se inventa su lote.

La cola sigue persistiendo `ASIGNAR_TICKET` y `REGISTRAR_JABA`. IndexedDB conserva esquema y versión 4. Los adapters, Supabase, Google Sheets y Apps Script no se modifican; no hay migración histórica.

F5.2 deberá definir el abastecimiento de lotes de tickets y sus códigos, y conectar escaneo/asignación/registro mediante casos de aplicación y repositorios de agregados. También deberá definir reconstrucción del estado persistido, claves estables para reintentos y traducción con los contratos legacy. Los límites de código único, asignación única y uso único deberán garantizarse transaccionalmente en la persistencia y ante concurrencia entre dispositivos; F5.1 los protege dentro de las instancias y el conjunto entregados al dominio. Cualquier cambio de esquema, protocolo o tratamiento histórico deberá tener un plan explícito en la fase correspondiente.
