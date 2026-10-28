import { TicketNoEncontrado } from '@gesgrow/core/contexts/harvest/index.js'
import { exigirMismoTenant } from '@gesgrow/core/contexts/platform/index.js'

// Una generación posterior al ingreso aún no está en IndexedDB. Renovar solo
// ante un fallo de catálogo; la reserva original abortó sin encolar comandos.
export function crearActualizacionCatalogoTickets({
  backend,
  harvestLocal,
  estaEnLinea
}) {
  const actualizaciones = new Map()
  async function actualizar(operador) {
    const campaniaId = operador.campania.id
    const clave = JSON.stringify([campaniaId, operador.dni])
    if (!actualizaciones.has(clave)) {
      const pendiente = Promise.resolve().then(async () => {
        const snapshot = await backend.obtenerSnapshotHarvest(operador.dni, campaniaId)
        if (snapshot?.campaniaId !== campaniaId)
          throw new Error('Los tickets recibidos no corresponden a esta campaña.')
        exigirMismoTenant(operador.campania, snapshot)
        await harvestLocal.guardarSnapshot(snapshot)
      })
      actualizaciones.set(clave, pendiente)
    }
    const pendiente = actualizaciones.get(clave)
    try {
      return await pendiente
    } finally {
      if (actualizaciones.get(clave) === pendiente) actualizaciones.delete(clave)
    }
  }
  return (operar) => async (solicitud) => {
    try {
      return await operar(solicitud)
    } catch (error) {
      if (!(error instanceof TicketNoEncontrado)) throw error
      if (!estaEnLinea()) {
        error.message =
          'Este ticket no está descargado en el PDA. Conéctate para actualizar los tickets de la campaña.'
        throw error
      }
      await actualizar(solicitud.operador)
      // Un solo reintento: si no existe en la campaña, conservar el rechazo.
      return operar(solicitud)
    }
  }
}
