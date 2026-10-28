import {
  obtenerColaCompleta,
  marcarOperacionSincronizada,
  marcarOperacionTemporal,
  marcarJabero,
  limpiarOperacionesSincronizadas,
  confirmarOperacionHarvest,
  rechazarOperacionHarvest,
  guardarSnapshotHarvest
} from './db.js'
import { ejecutarCola } from './cola.js'
import { mensajeErrorTickets } from '../shared/mensajesTickets.js'

import { backend } from '@gesgrow/core/backend/backend.js'

let sincronizando = false

export async function sincronizarPendientes() {
  if (sincronizando) {
    return
  }

  if (!navigator.onLine) {
    return
  }

  sincronizando = true

  try {
    const operaciones = await obtenerColaCompleta()

    await ejecutarCola(
      operaciones,
      procesarOperacion,
      async (operacion, resultado) => {
        if (resultado?.omitida) return
        if (['ASIGNAR_TICKET', 'REGISTRAR_JABA'].includes(operacion.tipo)) {
          await confirmarOperacionHarvest(operacion, resultado)
          return
        }
        if (operacion.tipo === 'REGISTRAR_JABERO') {
          await marcarJabero(
            operacion.payload.dniTrabajador,
            'SINCRONIZADO',
            operacion.id,
            operacion.payload.campaniaId
          )
        }
        await marcarOperacionSincronizada(operacion.id)
      },
      async (operacion, error, temporal) => {
        if (temporal) {
          await marcarOperacionTemporal(operacion.id, error.message)
          return
        }
        error.message = mensajeErrorTickets(error, operacion.payload.codigoTicket)
        await rechazarOperacionHarvest(operacion, error)
        if (
          [
            'LoteYaAsignado',
            'TicketYaUtilizado',
            'TicketNoEncontrado',
            'EscrituraLegacyRetirada',
            'CampaniaSinCutover'
          ].includes(error.name) &&
          operacion.payload.campaniaId
        ) {
          try {
            await guardarSnapshotHarvest(
              await backend.obtenerSnapshotHarvest(
                operacion.payload.dniOperador,
                operacion.payload.campaniaId
              )
            )
          } catch {
            /* La intención/error y el bloqueo conservan el estado incierto hasta actualizar. */
          }
        }
        if (operacion.tipo === 'REGISTRAR_JABERO') {
          await marcarJabero(
            operacion.payload.dniTrabajador,
            'ERROR',
            operacion.id,
            operacion.payload.campaniaId
          )
        }
      }
    )
    await limpiarOperacionesSincronizadas()
  } finally {
    sincronizando = false
  }
}

async function procesarOperacion(operacion) {
  const actuales = await obtenerColaCompleta()
  const actual = actuales.find((o) => o.id === operacion.id)
  if (!actual || actual.estado === 'SINCRONIZADA') return { omitida: true }
  if (actual?.estado === 'ERROR' && actual.rechazoHarvest) return { omitida: true }
  if (actual?.estado !== 'PENDIENTE')
    throw new Error('La intención ya no está pendiente.')
  operacion = actual
  if (operacion.dependencias?.length) {
    for (const id of operacion.dependencias)
      if (actuales.find((o) => o.id === id)?.estado !== 'SINCRONIZADA')
        throw new Error(`Dependencia ${id} no confirmada.`)
  }
  const compatibilidadV4 = operacion.origenVersion !== 5
  switch (operacion.tipo) {
    case 'ASIGNAR_TICKET':
      return backend.asignarTicket({
        ...operacion.payload,
        operacionId: operacion.id,
        ...(operacion.modelo === 'LEGACY' ? { modeloSolicitado: 'LEGACY' } : {}),
        compatibilidadV4
      })

    case 'REGISTRAR_JABERO':
      return backend.registrarJabero({
        ...operacion.payload,
        operacionId: operacion.id
      })

    case 'INICIAR_SESION':
      return backend.iniciarSesionLectura(operacion.payload)

    case 'REGISTRAR_JABA':
      return backend.registrarLecturaJaba({
        dniOperador: operacion.payload.dniOperador,
        campaniaId: operacion.payload.campaniaId,
        sesionId: operacion.payload.sesionId,
        codigoTicket: operacion.payload.codigoTicket,
        lecturaId: operacion.payload.lecturaId,
        fechaHora: operacion.payload.fechaHora,
        operacionId: operacion.id,
        ...(operacion.modelo === 'LEGACY' ? { modeloSolicitado: 'LEGACY' } : {}),
        compatibilidadV4
      })

    case 'CERRAR_SESION':
      return backend.cerrarSesionLectura({
        campaniaId: operacion.payload.campaniaId,
        dniOperador: operacion.payload.dniOperador,
        sesionId: operacion.payload.sesionId,
        operacionId: operacion.id
      })

    default:
      throw new Error(`Tipo de operación no soportado: ${operacion.tipo}`)
  }
}
