import assert from 'node:assert/strict'
import test from 'node:test'
import { AsignacionDeLote } from '@gesgrow/core/contexts/harvest/domain/asignacionDeLote.js'
import { CatalogoDeTickets } from '@gesgrow/core/contexts/harvest/domain/catalogoDeTickets.js'
import {
  DatoDeTicketsInvalido,
  ErrorDominioTickets,
  LoteDeTicketsDuplicado,
  LoteSinAsignar,
  LoteYaAsignado,
  TicketDuplicado,
  TicketNoEncontrado,
  TicketSinLote,
  TicketYaUtilizado
} from '@gesgrow/core/contexts/harvest/domain/erroresTickets.js'
import { LoteDeTickets } from '@gesgrow/core/contexts/harvest/domain/loteDeTickets.js'
import { RegistroCosecha } from '@gesgrow/core/contexts/harvest/domain/registroCosecha.js'
import { Ticket } from '@gesgrow/core/contexts/harvest/domain/ticket.js'

const fechaHora = '2026-10-14T12:00:00.000Z'
const asignar = { trabajadorId: 'TRABAJADOR-1', operacionId: 'OP-1' }

function preparar() {
  const lote = new LoteDeTickets({ id: 'LT-1', campaniaId: 'C-1' })
  const otroLote = new LoteDeTickets({ id: 'LT-2', campaniaId: 'C-2' })
  const tickets = [
    new Ticket({ codigo: 'T-1', loteId: lote.id }),
    new Ticket({ codigo: 'T-2', loteId: lote.id }),
    new Ticket({ codigo: 'T-3', loteId: otroLote.id })
  ]
  const catalogo = new CatalogoDeTickets({ lotes: [lote, otroLote], tickets })
  return { lote, otroLote, tickets, catalogo }
}

test('un lote pertenece a una campaña y nace disponible, sin asignación ni tickets internos', () => {
  const { lote } = preparar()
  assert.equal(lote.campaniaId, 'C-1')
  assert.equal(lote.estado, 'DISPONIBLE')
  assert.equal(lote.asignacion, null)
  assert.deepEqual(Object.keys(lote), ['id', 'campaniaId'])
  assert.throws(() => lote.obtenerAsignacion(), LoteSinAsignar)
  assert.throws(() => {
    lote.campaniaId = 'C-2'
  }, TypeError)
  assert.equal(lote.campaniaId, 'C-1')
})

test('un lote exige identidad y campaña', () => {
  for (const valor of [undefined, null, '', ' ', [], {}]) {
    assert.throws(
      () => new LoteDeTickets({ id: valor, campaniaId: 'C-1' }),
      DatoDeTicketsInvalido
    )
    assert.throws(
      () => new LoteDeTickets({ id: 'LT-1', campaniaId: valor }),
      DatoDeTicketsInvalido
    )
  }
})

test('un ticket exige código y una única referencia inmutable a su lote', () => {
  const {
    tickets: [ticket]
  } = preparar()
  assert.equal(ticket.codigo, 'T-1')
  assert.equal(ticket.loteId, 'LT-1')
  assert.equal(ticket.estado, 'DISPONIBLE')
  assert.equal(ticket.registroCosecha, null)
  for (const valor of [undefined, null, '', ' ', [], {}]) {
    assert.throws(
      () => new Ticket({ codigo: valor, loteId: 'LT-1' }),
      DatoDeTicketsInvalido
    )
    assert.throws(() => new Ticket({ codigo: 'T-1', loteId: valor }), TicketSinLote)
  }
  assert.throws(() => {
    ticket.codigo = 'OTRO'
  }, TypeError)
  assert.throws(() => {
    ticket.loteId = 'LT-2'
  }, TypeError)
  assert.equal(ticket.loteId, 'LT-1')
})

test('el catálogo rechaza códigos duplicados incluso entre lotes y campañas diferentes', () => {
  const { lote, otroLote, tickets } = preparar()
  for (const loteId of [lote.id, otroLote.id]) {
    assert.throws(
      () =>
        new CatalogoDeTickets({
          lotes: [lote, otroLote],
          tickets: [...tickets, new Ticket({ codigo: ' T-1 ', loteId })]
        }),
      (error) => error instanceof TicketDuplicado && error.codigoTicket === 'T-1'
    )
  }
})

test('el catálogo rechaza lotes duplicados y referencias a lotes inexistentes', () => {
  const { lote, tickets } = preparar()
  assert.throws(
    () =>
      new CatalogoDeTickets({
        lotes: [lote, new LoteDeTickets({ id: lote.id, campaniaId: 'C-2' })],
        tickets: []
      }),
    LoteDeTicketsDuplicado
  )
  assert.throws(
    () => new CatalogoDeTickets({ lotes: [lote], tickets }),
    (error) => error instanceof TicketSinLote && error.loteId === 'LT-2'
  )
})

test('escanear cualquier ticket identifica el mismo lote completo, incluso después de usarlo', () => {
  const { lote, otroLote, catalogo } = preparar()
  assert.strictEqual(catalogo.identificarLote('T-1'), lote)
  assert.strictEqual(catalogo.identificarLote(' T-2 '), lote)
  assert.strictEqual(catalogo.identificarLote('T-3'), otroLote)
  lote.asignar(asignar)
  catalogo.registrarCosechaDesdeTicket({ codigoTicket: 'T-1', id: 'RC-1', fechaHora })
  assert.strictEqual(catalogo.identificarLote('T-1'), lote)
  assert.strictEqual(catalogo.identificarLote('T-2').asignacion, lote.asignacion)
})

test('un código desconocido no asigna lotes ni registra cosecha', () => {
  const { lote, catalogo } = preparar()
  for (const ejecutar of [
    () => catalogo.identificarLote('DESCONOCIDO'),
    () => catalogo.asignarLoteDesdeTicket({ codigoTicket: 'DESCONOCIDO', ...asignar }),
    () =>
      catalogo.registrarCosechaDesdeTicket({
        codigoTicket: 'DESCONOCIDO',
        id: 'RC-1',
        fechaHora
      })
  ])
    assert.throws(ejecutar, TicketNoEncontrado)
  assert.equal(lote.estado, 'DISPONIBLE')
})

test('asignar un ticket asigna todo su lote y conserva disponible otro lote', () => {
  const { lote, otroLote, tickets, catalogo } = preparar()
  const asignacion = catalogo.asignarLoteDesdeTicket({
    codigoTicket: 'T-2',
    ...asignar
  })
  assert.ok(asignacion instanceof AsignacionDeLote)
  assert.deepEqual({ ...asignacion }, { loteId: lote.id, ...asignar })
  assert.equal(lote.estado, 'ASIGNADO')
  assert.strictEqual(catalogo.identificarLote('T-1').asignacion, asignacion)
  assert.equal(otroLote.estado, 'DISPONIBLE')
  assert.ok(tickets.every((ticket) => ticket.registroCosecha === null))
})

test('repetir la misma operación desde el mismo ticket o un ticket hermano devuelve la misma asignación', () => {
  const { lote, catalogo } = preparar()
  const primera = catalogo.asignarLoteDesdeTicket({ codigoTicket: 'T-1', ...asignar })
  for (const codigoTicket of ['T-1', 'T-2']) {
    assert.strictEqual(
      catalogo.asignarLoteDesdeTicket({ codigoTicket, ...asignar }),
      primera
    )
  }
  assert.strictEqual(lote.asignacion, primera)
})

test('otro trabajador o una operación diferente no pueden crear una segunda asignación', () => {
  const { lote, catalogo } = preparar()
  const primera = lote.asignar(asignar)
  for (const cambio of [
    { trabajadorId: 'TRABAJADOR-2' },
    { operacionId: 'OP-2' },
    { trabajadorId: 'TRABAJADOR-2', operacionId: 'OP-2' }
  ]) {
    assert.throws(
      () =>
        catalogo.asignarLoteDesdeTicket({ codigoTicket: 'T-2', ...asignar, ...cambio }),
      (error) => error instanceof LoteYaAsignado && error.loteId === lote.id
    )
    assert.strictEqual(lote.asignacion, primera)
  }
  assert.throws(() => {
    primera.trabajadorId = 'TRABAJADOR-2'
  }, TypeError)
  assert.throws(() => {
    lote.asignacion = null
  }, TypeError)
})

test('una asignación inválida conserva el lote disponible', () => {
  const { lote } = preparar()
  for (const campo of ['trabajadorId', 'operacionId']) {
    assert.throws(
      () => lote.asignar({ ...asignar, [campo]: '' }),
      DatoDeTicketsInvalido
    )
    assert.equal(lote.asignacion, null)
  }
  assert.equal(lote.asignar(asignar).trabajadorId, asignar.trabajadorId)
})

test('registrar cosecha exige que el lote esté asignado y no consume el ticket al fallar', () => {
  const {
    lote,
    tickets: [ticket],
    catalogo
  } = preparar()
  assert.throws(
    () =>
      catalogo.registrarCosechaDesdeTicket({
        codigoTicket: ticket.codigo,
        id: 'RC-1',
        fechaHora
      }),
    (error) => error instanceof LoteSinAsignar && error.loteId === lote.id
  )
  assert.equal(ticket.registroCosecha, null)
  assert.equal(ticket.estado, 'DISPONIBLE')
  lote.asignar(asignar)
  assert.ok(
    ticket.registrarCosecha({ id: 'RC-1', lote, fechaHora }) instanceof RegistroCosecha
  )
})

test('el ticket rechaza registrar con un lote ausente, incorrecto o un objeto sin el agregado', () => {
  const {
    lote,
    otroLote,
    tickets: [ticket]
  } = preparar()
  otroLote.asignar(asignar)
  for (const incorrecto of [undefined, otroLote, { ...lote }]) {
    assert.throws(
      () => ticket.registrarCosecha({ id: 'RC-1', lote: incorrecto, fechaHora }),
      TicketSinLote
    )
    assert.equal(ticket.registroCosecha, null)
  }
})

test('la cosecha se atribuye a la asignación del lote, sin aceptar un trabajador del llamador', () => {
  const {
    lote,
    tickets: [ticket],
    catalogo
  } = preparar()
  lote.asignar(asignar)
  const registro = ticket.registrarCosecha({
    id: 'RC-1',
    lote,
    fechaHora,
    trabajadorId: 'TRABAJADOR-AJENO'
  })
  assert.ok(registro instanceof RegistroCosecha)
  assert.deepEqual(
    { ...registro },
    {
      id: 'RC-1',
      codigoTicket: 'T-1',
      campaniaId: 'C-1',
      fechaHora,
      loteId: lote.id,
      trabajadorId: asignar.trabajadorId,
      asignacionOperacionId: asignar.operacionId
    }
  )
  assert.strictEqual(ticket.registroCosecha, registro)
  assert.equal(ticket.estado, 'UTILIZADO')
  assert.throws(() => {
    registro.trabajadorId = 'OTRO'
  }, TypeError)
  assert.throws(() => {
    ticket.registroCosecha = null
  }, TypeError)
  const hermano = catalogo.registrarCosechaDesdeTicket({
    codigoTicket: 'T-2',
    id: 'RC-2',
    fechaHora
  })
  assert.equal(hermano.trabajadorId, registro.trabajadorId)
  assert.notStrictEqual(hermano, registro)
})

test('un ticket produce como máximo un registro, incluso repitiendo el mismo identificador', () => {
  const {
    lote,
    tickets: [ticket],
    catalogo
  } = preparar()
  lote.asignar(asignar)
  const primero = catalogo.registrarCosechaDesdeTicket({
    codigoTicket: 'T-1',
    id: 'RC-1',
    fechaHora
  })
  for (const id of ['RC-1', 'RC-OTRO']) {
    assert.throws(
      () =>
        catalogo.registrarCosechaDesdeTicket({ codigoTicket: 'T-1', id, fechaHora }),
      (error) => error instanceof TicketYaUtilizado && error.codigoTicket === 'T-1'
    )
    assert.throws(
      () => ticket.registrarCosecha({ id, lote, fechaHora }),
      TicketYaUtilizado
    )
    assert.strictEqual(ticket.registroCosecha, primero)
  }
  assert.strictEqual(lote.asignar(asignar), lote.asignacion)
  assert.equal(ticket.estado, 'UTILIZADO')
})

test('un registro inválido no consume el ticket y se puede corregir', () => {
  const {
    lote,
    tickets: [ticket]
  } = preparar()
  lote.asignar(asignar)
  for (const campo of ['id', 'fechaHora']) {
    assert.throws(
      () => ticket.registrarCosecha({ id: 'RC-1', lote, fechaHora, [campo]: '' }),
      DatoDeTicketsInvalido
    )
    assert.equal(ticket.registroCosecha, null)
  }
  assert.equal(ticket.registrarCosecha({ id: 'RC-1', lote, fechaHora }).id, 'RC-1')
})

test('las colecciones entregadas al catálogo no permiten cambiar códigos o asociaciones después', () => {
  const { lote } = preparar()
  const lotes = [lote]
  const ticket = new Ticket({ codigo: 'T-1', loteId: lote.id })
  const tickets = [ticket]
  const catalogo = new CatalogoDeTickets({ lotes, tickets })
  lotes.length = 0
  tickets.length = 0
  assert.strictEqual(catalogo.obtenerTicket('T-1'), ticket)
  assert.strictEqual(catalogo.identificarLote('T-1'), lote)
})

test('los errores del nuevo modelo son errores de dominio explícitos', () => {
  for (const Tipo of [
    LoteYaAsignado,
    TicketYaUtilizado,
    TicketSinLote,
    LoteSinAsignar,
    TicketDuplicado,
    TicketNoEncontrado,
    LoteDeTicketsDuplicado,
    DatoDeTicketsInvalido
  ]) {
    const error = new Tipo('IDENTIDAD')
    assert.ok(error instanceof ErrorDominioTickets)
    assert.ok(error instanceof Error)
    assert.equal(error.name, Tipo.name)
    assert.ok(error.message)
  }
})
