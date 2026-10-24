import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FILTROS_ASIGNADOS_HOY,
  filtrarAsignacionesHoy,
  obtenerBadgeEstadoAsignacion,
  perteneceAlDiaLocal
} from '@gesgrow/core/contexts/harvest/application/queries/asignadosHoy.js'

function ticket({
  codigo = 'TICKET-001',
  nombre = 'Juan Pérez',
  dni = '70123456',
  estado = 'SINCRONIZADO',
  fecha
} = {}) {
  return {
    codigo_ticket: codigo,
    cosechador: nombre,
    cosechador_dni: dni,
    estado_sync: estado,
    fecha_asignacion: fecha
  }
}

test('una asignación de hoy aparece y una del día anterior no', () => {
  const ahora = new Date(2026, 8, 30, 12, 0, 0)
  const hoy = new Date(2026, 8, 30, 8, 42, 0)
  const ayer = new Date(2026, 8, 29, 23, 59, 0)

  const resultado = filtrarAsignacionesHoy(
    [
      ticket({ codigo: 'HOY', fecha: hoy.toISOString() }),
      ticket({ codigo: 'AYER', fecha: ayer.toISOString() })
    ],
    { ahora }
  )

  assert.deepEqual(
    resultado.map((item) => item.codigo_ticket),
    ['HOY']
  )
})

test('el día se compara con calendario local y no con la fecha UTC serializada', () => {
  const ahora = new Date(2026, 8, 30, 23, 45, 0)
  const fecha = new Date(2026, 8, 30, 23, 30, 0)

  assert.equal(perteneceAlDiaLocal(fecha, ahora), true)

  if (ahora.getTimezoneOffset() > 0) {
    assert.notEqual(
      fecha.toISOString().slice(0, 10),
      `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(
        ahora.getDate()
      ).padStart(2, '0')}`
    )
  }
})

test('la búsqueda encuentra por nombre, DNI y ticket ignorando mayúsculas y espacios externos', () => {
  const ahora = new Date(2026, 8, 30, 12, 0, 0)
  const fecha = new Date(2026, 8, 30, 9, 0, 0).toISOString()
  const tickets = [
    ticket({
      codigo: 'ABC001',
      nombre: 'María López',
      dni: '70887766',
      fecha
    })
  ]

  assert.equal(
    filtrarAsignacionesHoy(tickets, { busqueda: '  MARÍA  ', ahora }).length,
    1
  )
  assert.equal(
    filtrarAsignacionesHoy(tickets, { busqueda: '  70887766 ', ahora }).length,
    1
  )
  assert.equal(
    filtrarAsignacionesHoy(tickets, { busqueda: ' abc001 ', ahora }).length,
    1
  )
})

test('los filtros Pendiente y Error muestran solo el estado solicitado', () => {
  const ahora = new Date(2026, 8, 30, 12, 0, 0)
  const fecha = new Date(2026, 8, 30, 9, 0, 0).toISOString()
  const tickets = [
    ticket({ codigo: 'SYNC', estado: 'SINCRONIZADO', fecha }),
    ticket({ codigo: 'PEND', estado: 'PENDIENTE', fecha }),
    ticket({ codigo: 'ERR', estado: 'ERROR', fecha })
  ]

  assert.deepEqual(
    filtrarAsignacionesHoy(tickets, {
      filtro: FILTROS_ASIGNADOS_HOY.PENDIENTE,
      ahora
    }).map((item) => item.codigo_ticket),
    ['PEND']
  )
  assert.deepEqual(
    filtrarAsignacionesHoy(tickets, {
      filtro: FILTROS_ASIGNADOS_HOY.ERROR,
      ahora
    }).map((item) => item.codigo_ticket),
    ['ERR']
  )
})

test('las asignaciones se ordenan de la más reciente a la más antigua', () => {
  const ahora = new Date(2026, 8, 30, 12, 0, 0)
  const tickets = [
    ticket({
      codigo: 'TEMPRANO',
      fecha: new Date(2026, 8, 30, 7, 30, 0).toISOString()
    }),
    ticket({
      codigo: 'RECIENTE',
      fecha: new Date(2026, 8, 30, 10, 15, 0).toISOString()
    })
  ]

  assert.deepEqual(
    filtrarAsignacionesHoy(tickets, { ahora }).map((item) => item.codigo_ticket),
    ['RECIENTE', 'TEMPRANO']
  )
})

test('solo Pendiente y Error generan badge visible', () => {
  assert.equal(obtenerBadgeEstadoAsignacion('SINCRONIZADO'), null)
  assert.deepEqual(obtenerBadgeEstadoAsignacion('PENDIENTE'), {
    etiqueta: 'Pendiente',
    clase: 'sync-badge--pending'
  })
  assert.deepEqual(obtenerBadgeEstadoAsignacion('ERROR'), {
    etiqueta: 'Error',
    clase: 'sync-badge--error'
  })
})
