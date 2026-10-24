import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CatalogoDeTickets,
  DatoDeTicketsInvalido,
  LoteDeTickets,
  LoteYaAsignado,
  Ticket,
  crearAsignarLoteDeTickets
} from '@gesgrow/core/contexts/harvest/index.js'
import { crearSupabaseBackend } from '../src/infrastructure/supabase/backendAdapter.js'
import { ErrorBackend, OperacionNoDisponible } from '@gesgrow/core/backend/errores.js'
import { esErrorTemporal } from '@gesgrow/core/shared/erroresConexion.js'
import {
  CampaniaTicketIncorrecta,
  TicketNoEncontrado,
  TicketSinLote
} from '@gesgrow/core/contexts/harvest/index.js'

const contexto = {
  codigoTicket: 'T-2',
  operador: { dni: '12345678', campania: { id: 'C' } },
  cosechador: { dni: '87654321' },
  operacionId: 'OP'
}

test('AsignarLoteDeTickets recibe el contexto PDA y delega la decisión atómica al puerto', async () => {
  const lote = new LoteDeTickets({ id: 'L', campaniaId: 'C' })
  const tickets = ['T-1', 'T-2'].map(
    (codigo) => new Ticket({ codigo, loteId: lote.id })
  )
  const catalogo = new CatalogoDeTickets({ lotes: [lote], tickets })
  const llamadas = []
  const caso = crearAsignarLoteDeTickets({
    repositorioTickets: {
      asignarLoteDesdeTicket: async (solicitud) => {
        llamadas.push(solicitud)
        catalogo.asignarLoteDesdeTicket({
          codigoTicket: solicitud.codigoTicket,
          trabajadorId: 'UUID-WORKFORCE',
          operacionId: solicitud.operacionId
        })
        return catalogo
      }
    }
  })
  const resultado = await caso(contexto)
  assert.deepEqual(llamadas, [
    {
      codigoTicket: 'T-2',
      campaniaId: 'C',
      dniOperador: '12345678',
      dniCosechador: '87654321',
      operacionId: 'OP'
    }
  ])
  assert.strictEqual(resultado.lote, lote)
  assert.strictEqual(resultado.asignacion, catalogo.identificarLote('T-1').asignacion)
  assert.equal(resultado.ticket.estado, 'DISPONIBLE')
  assert.ok(tickets.every((ticket) => ticket.registroCosecha === null))
  assert.strictEqual(
    (await caso({ ...contexto, codigoTicket: 'T-1' })).asignacion,
    resultado.asignacion
  )
})

test('admite trabajador y campaña explícitos sin depender de un DTO de PostgreSQL', async () => {
  const lote = new LoteDeTickets({ id: 'L', campaniaId: 'C' })
  lote.asignar({ trabajadorId: 'W', operacionId: 'OP' })
  const caso = crearAsignarLoteDeTickets({
    repositorioTickets: {
      asignarLoteDesdeTicket: async (solicitud) => {
        assert.equal(solicitud.dniCosechador, '87654321')
        return new CatalogoDeTickets({
          lotes: [lote],
          tickets: [new Ticket({ codigo: 'T-2', loteId: lote.id })]
        })
      }
    }
  })
  const resultado = await caso({
    ...contexto,
    cosechador: undefined,
    trabajador: { dni: '87654321' },
    operador: { dni: '12345678' },
    campania: { id: 'C' }
  })
  assert.equal(resultado.asignacion.trabajadorId, 'W')
})

test('contexto incompleto no llega al puerto; el rechazo del servidor no se convierte en éxito local', async () => {
  let llamadas = 0
  const rechazo = new LoteYaAsignado('L')
  const caso = crearAsignarLoteDeTickets({
    repositorioTickets: {
      asignarLoteDesdeTicket: async () => {
        llamadas++
        throw rechazo
      }
    }
  })
  for (const cambio of [
    { codigoTicket: '' },
    { operador: null },
    { cosechador: null },
    { campania: {} },
    { operacionId: null }
  ])
    await assert.rejects(caso({ ...contexto, ...cambio }), DatoDeTicketsInvalido)
  assert.equal(llamadas, 0)
  await assert.rejects(caso(contexto), (error) => error === rechazo)
  assert.equal(llamadas, 1)
})

test('errores operativos se traducen al dominio; fallos de red conservan reintento y no hay fallback', async () => {
  const args = {
    codigoTicket: 'T',
    campaniaId: 'C',
    dniOperador: '12345678',
    dniCosechador: '87654321',
    operacionId: 'OP'
  }
  for (const [error, Tipo, temporal] of [
    [{ message: 'harvest_lote_ya_asignado', details: 'L' }, LoteYaAsignado, false],
    [{ message: 'harvest_ticket_no_encontrado' }, TicketNoEncontrado, false],
    [{ message: 'harvest_ticket_sin_lote' }, TicketSinLote, false],
    [{ message: 'harvest_campania_incorrecta' }, CampaniaTicketIncorrecta, false],
    [{ message: 'Failed to fetch' }, ErrorBackend, true],
    [{ message: 'No autorizado', status: 403 }, ErrorBackend, false],
    [{ message: 'violates unique constraint', code: '23505' }, ErrorBackend, false],
    [{ message: 'Servicio no disponible', status: 503 }, ErrorBackend, true],
    [{ message: 'Missing', code: 'PGRST202' }, OperacionNoDisponible, false]
  ]) {
    const nombres = []
    const adapter = crearSupabaseBackend({
      rpc: async (nombre) => {
        nombres.push(nombre)
        return { error }
      }
    })
    await assert.rejects(
      adapter.asignarTicket(args),
      (rechazo) => rechazo instanceof Tipo && esErrorTemporal(rechazo) === temporal
    )
    assert.deepEqual(nombres, ['harvest_asignar_lote_tickets'])
  }
})
