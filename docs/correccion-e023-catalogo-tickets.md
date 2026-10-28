# E023: tickets generados después del ingreso al PDA

Diagnóstico de producción, 28 de octubre de 2026 (hora de Lima):

- Última descarga del catálogo registrada desde la PWA: 14:45:17.
- Generación de lotes C000055–C000057: 14:48:33, 30 tickets.
- Generación de lotes C000058–C000060: 14:51:23, 30 tickets.
- Ambas impresiones confirmadas. El snapshot del servidor contiene los 125
  tickets de la campaña, incluidos los 60 de las dos últimas generaciones.

La reserva busca primero en IndexedDB. Si el catálogo se descargó antes de
generar los tickets, `TicketNoEncontrado` se producía antes de intentar
sincronizar; el servidor nunca recibía la asignación.

La aplicación ahora renueva el snapshot al detectar ese error con conexión y
reintenta una sola vez, tanto para asignar como para registrar cosecha. Las
operaciones conocidas siguen resolviéndose localmente, sin una consulta remota
por cada escaneo. Los escaneos concurrentes comparten la descarga por campaña
y operador. Se validan campaña y empresa antes de guardar el snapshot.

Sin conexión, un ticket ausente se identifica como no descargado y no se
encola. Los tickets conocidos mantienen el funcionamiento offline. Una caída
de red o un código realmente inexistente no crea asignaciones provisionales.

La descarga conserva reservas y lecturas pendientes, y el reintento vuelve a
pasar por las validaciones y la transacción local: no permite dividir un lote
ni usar uno asignado por otro equipo.

Validación: 498 pruebas de la PWA, incluidas nueve regresiones de E023
(generación posterior al ingreso, pendientes conservados, ausencia real,
offline, asignación ajena, fallo de red, aislamiento, lectura y concurrencia).
No se modificaron los lotes ni los datos productivos para esta corrección.
