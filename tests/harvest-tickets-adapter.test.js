import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CatalogoDeTickets,
  ErrorPersistenciaTickets,
  LoteDeTickets,
  LoteDeTicketsDuplicado,
  LoteYaAsignado,
  Ticket,
  TicketDuplicado,
  TicketNoEncontrado,
  TicketYaUtilizado
} from '@gesgrow/core/contexts/harvest/index.js'
import { crearGeneradorCodigoTicketAleatorio } from '../src/infrastructure/harvest/generadorCodigoTicket.js'
import { crearRepositorioTicketsHarvestSupabase } from '../src/infrastructure/supabase/harvestTicketsAdapter.js'
import {
  reconstituirCatalogoTicket,
  serializarGeneracionTickets
} from '../src/infrastructure/supabase/harvestTicketsMapper.js'

const campaniaId = 'C-1'
const codigoTicket = 'T-1'
function fila() {
  return {
    lote: { id: 'L-1', campania_id: campaniaId },
    ticket: { codigo: codigoTicket, lote_id: 'L-1', campania_id: campaniaId },
    asignacion: null,
    registro: null
  }
}
function asignada() {
  return {
    ...fila(),
    asignacion: {
      lote_id: 'L-1',
      campania_id: campaniaId,
      trabajador_id: 'W-1',
      operacion_id: 'OP-1'
    }
  }
}
function utilizada() {
  return {
    ...asignada(),
    registro: {
      id: 'R-1',
      codigo_ticket: codigoTicket,
      lote_id: 'L-1',
      campania_id: campaniaId,
      trabajador_id: 'W-1',
      asignacion_operacion_id: 'OP-1',
      fecha_hora: '2026-10-14T12:00:00Z'
    }
  }
}

test('reconstitución de lote/ticket disponibles sin exponer filas', () => {
  const catalogo = reconstituirCatalogoTicket(fila(), { campaniaId, codigoTicket })
  assert.ok(catalogo instanceof CatalogoDeTickets)
  const lote = catalogo.identificarLote(codigoTicket)
  const ticket = catalogo.obtenerTicket(codigoTicket)
  assert.ok(lote instanceof LoteDeTickets)
  assert.ok(ticket instanceof Ticket)
  assert.equal(lote.campaniaId, campaniaId)
  assert.equal(lote.estado, 'DISPONIBLE')
  assert.equal(ticket.estado, 'DISPONIBLE')
  assert.equal(lote.campania_id, undefined)
  assert.equal(ticket.lote_id, undefined)
})

test('reconstitución de asignación conserva identidad, exclusividad e idempotencia', () => {
  const catalogo = reconstituirCatalogoTicket(asignada(), { campaniaId, codigoTicket })
  const lote = catalogo.identificarLote(codigoTicket)
  assert.equal(lote.estado, 'ASIGNADO')
  assert.equal(lote.asignacion.trabajadorId, 'W-1')
  assert.strictEqual(
    lote.asignar({ trabajadorId: 'W-1', operacionId: 'OP-1' }),
    lote.asignacion
  )
  assert.throws(
    () => lote.asignar({ trabajadorId: 'W-2', operacionId: 'OP-2' }),
    LoteYaAsignado
  )
})

test('reconstitución del uso conserva registro, trabajador y rechazo de reutilización', () => {
  const catalogo = reconstituirCatalogoTicket(utilizada(), { campaniaId, codigoTicket })
  const ticket = catalogo.obtenerTicket(codigoTicket)
  assert.equal(ticket.estado, 'UTILIZADO')
  assert.equal(ticket.registroCosecha.id, 'R-1')
  assert.equal(ticket.registroCosecha.trabajadorId, 'W-1')
  assert.equal(ticket.registroCosecha.asignacionOperacionId, 'OP-1')
  assert.throws(
    () =>
      catalogo.registrarCosechaDesdeTicket({
        codigoTicket,
        id: 'R-2',
        fechaHora: '2026-10-15'
      }),
    TicketYaUtilizado
  )
})

test('el mapper rechaza estados persistidos inconsistentes, incluso asignaciones/atribuciones ajenas', () => {
  const incompatibles = [
    null,
    {},
    { ...fila(), lote: { id: 'L-1', campania_id: 'C-2' } },
    { ...fila(), ticket: { ...fila().ticket, lote_id: 'L-2' } },
    { ...fila(), ticket: { ...fila().ticket, codigo: 'T-2' } },
    { ...fila(), ticket: { ...fila().ticket, campania_id: 'C-2' } },
    { ...asignada(), asignacion: { ...asignada().asignacion, campania_id: 'C-2' } },
    { ...utilizada(), asignacion: null },
    ...[
      'codigo_ticket',
      'lote_id',
      'campania_id',
      'trabajador_id',
      'asignacion_operacion_id'
    ].map((campo) => ({
      ...utilizada(),
      registro: { ...utilizada().registro, [campo]: 'AJENO' }
    }))
  ]
  for (const estado of incompatibles)
    assert.throws(
      () => reconstituirCatalogoTicket(estado, { campaniaId, codigoTicket }),
      ErrorPersistenciaTickets
    )
})

test('el mapper serializa agregados independientes y rechaza campañas o estados incompatibles', () => {
  const lote = new LoteDeTickets({ id: 'L-1', campaniaId })
  const ticket = new Ticket({ codigo: codigoTicket, loteId: lote.id })
  const generacion = { campaniaId, lotes: [lote], tickets: [ticket] }
  assert.deepEqual(serializarGeneracionTickets(generacion), [
    { id: lote.id, tickets: [codigoTicket] }
  ])
  assert.throws(
    () => serializarGeneracionTickets({ ...generacion, campaniaId: 'C-2' }),
    ErrorPersistenciaTickets
  )
  assert.throws(
    () => serializarGeneracionTickets({ ...generacion, tickets: [] }),
    ErrorPersistenciaTickets
  )
  lote.asignar({ trabajadorId: 'W', operacionId: 'OP' })
  assert.throws(() => serializarGeneracionTickets(generacion), ErrorPersistenciaTickets)
  ticket.registrarCosecha({ id: 'R', lote, fechaHora: '2026-10-14' })
  assert.throws(() => serializarGeneracionTickets(generacion), ErrorPersistenciaTickets)
})

test('adapter guarda con una sola llamada RPC y resuelve únicamente campaña/código', async () => {
  const llamadas = []
  const repositorio = crearRepositorioTicketsHarvestSupabase({
    rpc: async (nombre, args) => {
      llamadas.push([nombre, args])
      return { data: nombre === 'harvest_resolver_ticket' ? fila() : null, error: null }
    }
  })
  const lote = new LoteDeTickets({ id: 'L-1', campaniaId })
  await repositorio.guardarLotesConTickets({
    campaniaId,
    lotes: [lote],
    tickets: [new Ticket({ codigo: codigoTicket, loteId: lote.id })]
  })
  const catalogo = await repositorio.resolverCatalogoPorCodigo({
    campaniaId,
    codigoTicket
  })
  assert.ok(catalogo instanceof CatalogoDeTickets)
  assert.deepEqual(llamadas, [
    [
      'harvest_crear_lotes_tickets',
      { p_campania_id: campaniaId, p_lotes: [{ id: 'L-1', tickets: [codigoTicket] }] }
    ],
    ['harvest_resolver_ticket', { p_campania_id: campaniaId, p_codigo: codigoTicket }]
  ])
})

test('adapter traduce conflictos SQL y conserva rechazo/ausencia sin entregar DTO', async () => {
  for (const [error, Tipo, campo] of [
    [
      { code: '23505', message: 'harvest_ticket_duplicado', details: codigoTicket },
      TicketDuplicado,
      'codigoTicket'
    ],
    [
      { code: '23505', message: 'harvest_lote_duplicado', details: 'L-1' },
      LoteDeTicketsDuplicado,
      'loteId'
    ],
    [{ code: '42501', message: 'denied' }, ErrorPersistenciaTickets]
  ]) {
    const repositorio = crearRepositorioTicketsHarvestSupabase({
      rpc: async () => ({ error })
    })
    await assert.rejects(
      repositorio.resolverCatalogoPorCodigo({ campaniaId, codigoTicket }),
      (rechazo) =>
        rechazo instanceof Tipo && (!campo || rechazo[campo] === error.details)
    )
  }
  const repositorio = crearRepositorioTicketsHarvestSupabase({
    rpc: async () => ({ data: null })
  })
  await assert.rejects(
    repositorio.resolverCatalogoPorCodigo({ campaniaId, codigoTicket }),
    TicketNoEncontrado
  )
  const fallo = new Error('Sin red')
  const sinRed = crearRepositorioTicketsHarvestSupabase({
    rpc: async () => {
      throw fallo
    }
  })
  await assert.rejects(
    sinRed.resolverCatalogoPorCodigo({ campaniaId, codigoTicket }),
    (error) => error instanceof ErrorPersistenciaTickets && error.cause === fallo
  )
})

test('el generador provisional usa una fuente reemplazable y no añade convención al código', () => {
  let secuencia = 0
  const generador = crearGeneradorCodigoTicketAleatorio({
    generarIdentificador: () => `FUENTE ${++secuencia}`
  })
  assert.equal(generador.generar(), 'FUENTE 1')
  assert.equal(generador.generar(), 'FUENTE 2')
})
