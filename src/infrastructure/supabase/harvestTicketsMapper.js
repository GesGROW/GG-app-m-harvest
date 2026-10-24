import {
  CatalogoDeTickets,
  ErrorPersistenciaTickets,
  LoteDeTickets,
  Ticket
} from '@gesgrow/core/contexts/harvest/index.js'

export function serializarGeneracionTickets({ campaniaId, lotes, tickets }) {
  new CatalogoDeTickets({ lotes, tickets })
  const porLote = new Map(lotes.map((lote) => [lote.id, []]))
  for (const ticket of tickets) {
    if (ticket.estado !== 'DISPONIBLE')
      throw new ErrorPersistenciaTickets(
        'La generación no puede guardar tickets utilizados.'
      )
    porLote.get(ticket.loteId).push(ticket.codigo)
  }
  return lotes.map((lote) => {
    const codigos = porLote.get(lote.id)
    if (
      lote.campaniaId !== campaniaId ||
      lote.estado !== 'DISPONIBLE' ||
      !codigos.length
    )
      throw new ErrorPersistenciaTickets(
        'La generación requiere lotes disponibles con tickets de la misma campaña.'
      )
    return { id: lote.id, tickets: codigos }
  })
}

// Reconstitución por las mismas transiciones de dominio; no abre campos privados.
// Los estados persistidos incompatibles se rechazan en la frontera del adapter.
export function reconstituirCatalogoTicket(fila, { campaniaId, codigoTicket }) {
  try {
    if (
      fila.lote.campania_id !== campaniaId ||
      fila.ticket.codigo !== codigoTicket ||
      fila.ticket.lote_id !== fila.lote.id ||
      fila.ticket.campania_id !== campaniaId
    )
      throw new Error('Referencias incompatibles')
    const owner = fila.lote.tenant_id
    for (const recurso of [fila.ticket, fila.asignacion, fila.registro].filter(
      Boolean
    )) {
      if (owner !== undefined && recurso.tenant_id !== owner)
        throw new Error('Referencias cross-tenant')
    }
    const lote = new LoteDeTickets({
      id: fila.lote.id,
      campaniaId: fila.lote.campania_id,
      ...(owner !== undefined ? { tenantId: owner } : {})
    })
    const ticket = new Ticket({
      codigo: fila.ticket.codigo,
      loteId: fila.ticket.lote_id
    })
    if (fila.asignacion) {
      if (
        fila.asignacion.lote_id !== lote.id ||
        fila.asignacion.campania_id !== campaniaId
      )
        throw new Error('Asignación incompatible')
      lote.asignar({
        trabajadorId: fila.asignacion.trabajador_id,
        operacionId: fila.asignacion.operacion_id
      })
    }
    if (fila.registro) {
      const registro = fila.registro
      if (
        registro.codigo_ticket !== ticket.codigo ||
        registro.lote_id !== lote.id ||
        registro.campania_id !== campaniaId ||
        registro.trabajador_id !== lote.obtenerAsignacion().trabajadorId ||
        registro.asignacion_operacion_id !== lote.asignacion.operacionId
      )
        throw new Error('Registro incompatible')
      ticket.registrarCosecha({
        id: registro.id,
        lote,
        fechaHora: registro.fecha_hora,
        sesionId: registro.sesion_id,
        operacionId: registro.operacion_id,
        versionProduccion: registro.version_produccion
      })
    }
    return new CatalogoDeTickets({ lotes: [lote], tickets: [ticket] })
  } catch {
    throw new ErrorPersistenciaTickets(
      'El estado persistido del ticket no respeta el modelo Harvest.'
    )
  }
}
