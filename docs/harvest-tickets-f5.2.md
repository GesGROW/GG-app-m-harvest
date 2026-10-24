# Harvest: generación y persistencia en F5.2

Este documento describe F5.2. [F5.3](harvest-tickets-f5.3.md) conecta la asignación operativa por lote al comando PDA conservado, sin sustituir la lectura de jabas.

La generación y consulta del modelo de F5.1 tienen casos de aplicación, un puerto específico y persistencia SQL real. La composición es independiente del PDA: `bootstrap`, los siete casos productivos, la cola, IndexedDB v4, sesiones y lecturas repetidas siguen con el modelo legacy. No se cambian Google Sheets ni Apps Script, ni se migran filas históricas.

## Casos y contratos

`crearGenerarLotesDeTickets` recibe `repositorioTickets`, `generadorCodigoTicket` y `generarIdLote`. Su caso `generarLotesDeTickets({ campaniaId, cantidadTickets, tamanioLote })` exige cantidades enteras positivas, genera identidades, divide por el tamaño indicado y conserva un último lote menor si hace falta. Devuelve agregados y un catálogo después de confirmar la persistencia. No entrega un éxito parcial.

Por ejemplo, 40/10 genera 4 lotes de 10; 11/4 genera lotes de 4, 4 y 3. Una falla del generador o un duplicado dentro de la solicitud se detecta antes del guardado. No se reintentan ni reemplazan códigos silenciosamente.

El puerto `RepositorioTicketsHarvest` publica solamente:

- `guardarLotesConTickets({ campaniaId, lotes, tickets })`: crea toda la generación atómicamente; recibe agregados, sin filas SQL.
- `resolverCatalogoPorCodigo({ campaniaId, codigoTicket })`: devuelve un `CatalogoDeTickets` con el ticket solicitado y su lote completo como agregado. No carga los demás tickets del lote o de la campaña.

`crearResolverCatalogoDeTickets` valida el alcance y delega la consulta puntual. `CatalogoDeTickets` mantiene su API de F5.1; puede trabajar con el subconjunto recuperado. Su validación en memoria complementa la unicidad global de PostgreSQL.

`GeneradorCodigoTicket.generar({ campaniaId, loteId, indice })` admite una implementación síncrona o asíncrona. El adapter provisional `crearGeneradorCodigoTicketAleatorio` entrega UUID opacos desde una fuente inyectable; no impone prefijos, significado de campaña, longitud ni un formato comercial al dominio. Las identidades de lote también se inyectan, y para el esquema actual deben ser UUID. El texto del código sigue siendo reemplazable. La unicidad se define sobre códigos normalizados y sensibles a mayúsculas dentro del nuevo modelo, sin alterar los tickets legacy.

## Esquema y atomicidad

La migración `backend/supabase/migrations/202610140100_harvest_tickets.sql` añade:

| Tabla                       | Identidad y responsabilidad                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `harvest_lotes_tickets`     | UUID del lote, campaña obligatoria y fecha de creación.                                        |
| `harvest_tickets`           | Código como clave primaria global y referencia compuesta a lote/campaña.                       |
| `harvest_asignaciones_lote` | Una asignación por lote, trabajador y clave de operación.                                      |
| `harvest_registros_cosecha` | Un registro por ticket y referencia a la asignación exacta que determina trabajador y campaña. |

Los estados disponible/asignado y disponible/utilizado se derivan de la ausencia/presencia de asignación y registro; no hay columnas de estado duplicadas. Las FK compuestas impiden referencias cruzadas entre campañas y atribuciones que no coincidan con la asignación. El índice por lote permite recuperar sus tickets en fases posteriores; la clave primaria del código permite resolver un único ticket.

`harvest_crear_lotes_tickets` recibe una sola solicitud con todos los lotes y sus códigos, e inserta todo dentro de la transacción del RPC. Si falla cualquier lote o ticket, incluso uno del último lote, la excepción revierte toda la solicitud. No usa `ON CONFLICT DO NOTHING`, guardados por ticket ni comprobaciones previas como autoridad. La clave primaria `harvest_tickets_codigo_unico` decide los conflictos de códigos, también entre campañas y solicitudes concurrentes. Los conflictos se traducen a `TicketDuplicado` o `LoteDeTicketsDuplicado`.

Las cuatro tablas tienen RLS y carecen de acceso directo para `anon` y `authenticated`. Los dos RPC tienen `search_path` fijo y solo `authenticated` puede ejecutarlos. Reutilizan la autorización administrativa existente de integración con gestión de maestros y alcance de campaña; no conceden permisos nuevos a cuentas. Generar requiere campaña activa; consultar permite leer una campaña cerrada autorizada. Esta fase no incorpora autorización del operador PDA a los nuevos RPC.

Las tablas de asignación y registro preparan la persistencia de todos los estados de F5.1. **No se publican todavía escrituras de asignación ni cosecha**; pertenecen a F5.3. Las pruebas cargan esos estados mediante SQL privilegiado para verificar su reconstrucción y constraints.

## Adapters y reconstrucción

`crearRepositorioTicketsHarvestSupabase` implementa el puerto usando los RPC `harvest_crear_lotes_tickets` y `harvest_resolver_ticket`. El mapper `harvestTicketsMapper.js` concentra los formatos de transporte: agrupa tickets por referencia al lote, valida campaña/estado de creación y reconstruye lote, asignación, ticket y registro por las transiciones de dominio. Rechaza filas incompatibles con `ErrorPersistenciaTickets`; Application y Domain nunca reciben las filas.

`harvest_resolver_ticket` obtiene únicamente el ticket del código y campaña indicados, el lote y las posibles asignación y cosecha. Una coincidencia en otra campaña no revela sus datos. El mapper construye instancias nuevas: se conservan la asignación idempotente y el rechazo del ticket utilizado después de volver a consultar.

La composición optativa `pwa/src/infrastructure/supabase/crearTicketsHarvest.js` conecta casos, repositorio y generador sin modificar el arranque del PDA:

```js
import { crearTicketsHarvest } from '../src/infrastructure/supabase/crearTicketsHarvest.js'

// Cliente autenticado e integración ya autorizada para esta campaña.
const harvest = crearTicketsHarvest({ supabase })
const generacion = await harvest.generarLotesDeTickets({
  campaniaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cantidadTickets: 40,
  tamanioLote: 10
})
const catalogo = await harvest.resolverCatalogoDeTickets({
  campaniaId: generacion.lotes[0].campaniaId,
  codigoTicket: generacion.tickets[0].codigo
})
```

La migración requiere el esquema y la autorización por campaña de las migraciones anteriores, incluida `202610110500_sheets_por_campania.sql`. Se añade y prueba localmente; no se despliega automáticamente a una instancia remota.

## Validación y preparación para F5.3

Las pruebas de aplicación verifican partición, cantidades, parámetros, contratos intercambiables, confirmación y fallos. Las de adapters verifican transporte, ocultación de filas y reconstrucción de todos los estados. Las pruebas PGlite ejecutan la migración y los RPC reales: comprueban rollback completo, restricciones, aislamiento, permisos y dos solicitudes concurrentes con los mismos códigos. PGlite serializa las sentencias dentro de su instancia; esta prueba cubre solicitudes simultáneas y rechazo por constraint, sin simular dos sesiones PostgreSQL con MVCC. La autoridad de unicidad en producción es el índice de PostgreSQL.

F5.3 deberá introducir operaciones transaccionales de asignación de lote y uso de ticket, claves estables para reintentos y protección ante concurrencia, autorización y errores del operador PDA, y su integración con UI/cola/offline según el alcance de esa fase. Mutar un catálogo recuperado todavía solo cambia sus instancias en memoria; esta API no guarda asignaciones ni cosechas. También deberá definir la transición entre los contratos legacy y nuevos y la política de impresión/representación comercial del código. Los cambios futuros de IndexedDB, sincronización y datos históricos requieren su propio plan explícito.
