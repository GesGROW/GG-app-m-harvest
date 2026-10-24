import { esErrorTemporal } from './errores.js'

export function obtenerOperacionesDependientes(operacion, operaciones) {
  if (!operacion) return []

  return operaciones.filter((posterior) => {
    if ((posterior.payload.campaniaId ?? '') !== (operacion.payload.campaniaId ?? ''))
      return false
    if (posterior.dependencias?.includes(operacion.id)) return true
    if (posterior.id === operacion.id || posterior.creado_en <= operacion.creado_en) {
      return false
    }
    if ((posterior.payload.campaniaId ?? '') !== (operacion.payload.campaniaId ?? ''))
      return false

    if (operacion.tipo === 'ASIGNAR_TICKET') {
      return (
        posterior.tipo === 'REGISTRAR_JABA' &&
        operacion.payload.codigoTicket != null &&
        posterior.payload.codigoTicket === operacion.payload.codigoTicket
      )
    }

    if (operacion.tipo === 'REGISTRAR_JABERO') {
      return (
        posterior.tipo === 'INICIAR_SESION' &&
        operacion.payload.dniTrabajador != null &&
        posterior.payload.dniJabero === operacion.payload.dniTrabajador
      )
    }

    if (operacion.tipo === 'INICIAR_SESION') {
      return (
        ['REGISTRAR_JABA', 'CERRAR_SESION'].includes(posterior.tipo) &&
        operacion.payload.sesionId != null &&
        posterior.payload.sesionId === operacion.payload.sesionId
      )
    }

    return false
  })
}

export function evaluarDescarteOperacion(operacion, operaciones) {
  const dependientes = obtenerOperacionesDependientes(operacion, operaciones).length

  return {
    permitido:
      operacion?.estado === 'ERROR' &&
      ['ASIGNAR_TICKET', 'REGISTRAR_JABERO'].includes(operacion.tipo) &&
      dependientes === 0,
    dependientes
  }
}

export async function ejecutarCola(operaciones, procesar, alSincronizar, alFallar) {
  const ordenadas = [...operaciones].sort((a, b) =>
    a.creado_en.localeCompare(b.creado_en)
  )
  const bloqueadas = new Set()
  for (const operacion of ordenadas) {
    const campania = operacion.payload.campaniaId ?? ''
    if (bloqueadas.has(campania)) continue
    if (operacion.estado === 'SINCRONIZADA') continue
    // Un rechazo Harvest ya reconciliado conserva su auditoría, pero no es
    // trabajo enviable ni impide sincronizar intenciones independientes.
    if (operacion.estado === 'ERROR' && operacion.rechazoHarvest === true) continue
    if (operacion.estado !== 'PENDIENTE') {
      bloqueadas.add(campania)
      continue
    }
    let resultado
    try {
      resultado = await procesar(operacion)
    } catch (error) {
      await alFallar(operacion, error, esErrorTemporal(error))
      bloqueadas.add(campania)
      continue
    }
    await alSincronizar(operacion, resultado)
  }
}
