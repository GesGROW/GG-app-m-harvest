import assert from 'node:assert/strict'
import test from 'node:test'
import { mensajeErrorTickets } from '../src/shared/mensajesTickets.js'
import {
  LoteYaAsignado,
  TicketYaUtilizado
} from '@gesgrow/core/contexts/harvest/index.js'

test('E015: muestra el código del lote, sin revelar UUID ni alterar el error de dominio', () => {
  const e = new LoteYaAsignado('b287816f-2736-4f74-a314-ee63a2891ce8')
  assert.equal(
    mensajeErrorTickets(e, 'C00005101'),
    'El lote de tickets 000051 ya está asignado.'
  )
  assert.equal(mensajeErrorTickets(e, 'T1'), 'Este lote de tickets ya está asignado.')
  assert.equal(e.loteId, 'b287816f-2736-4f74-a314-ee63a2891ce8')
})
test('E022: el reescaneo informa ticket ya registrado', () => {
  assert.equal(
    mensajeErrorTickets(new TicketYaUtilizado('C00005101')),
    'El ticket C00005101 ya está registrado.'
  )
})
