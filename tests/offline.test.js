import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agregarOperacion,
  agregarRolTrabajador,
  cerrarSesionLocal,
  contarLecturasCosechador,
  contarLecturasSesion,
  contarErrores,
  existeTicketPendiente,
  guardarAsignacionOffline,
  guardarCache,
  guardarLecturaLocal,
  guardarSesionLocal,
  guardarTicketLocal,
  marcarOperacionError,
  marcarOperacionSincronizada,
  marcarLecturaSincronizada,
  marcarTicketError,
  marcarTicketSincronizado,
  obtenerColaCompleta,
  obtenerSesionLocal,
  obtenerTicket,
  obtenerTickets,
  obtenerTrabajador
} from '../src/offline/db.js'
import { filtrarAsignacionesHoy } from '@gesgrow/core/contexts/harvest/application/queries/asignadosHoy.js'

test('una asignación offline nueva queda disponible para Asignados hoy', async () => {
  const ahora = new Date(2026, 8, 30, 12, 0, 0)
  const fechaAsignacion = new Date(2026, 8, 30, 10, 5, 0).toISOString()

  await guardarAsignacionOffline({
    codigoTicket: 'OFFLINE-HOY-001',
    cosechadorDni: '70001122',
    cosechador: 'Rosa Torres',
    dniOperador: '70000000',
    fechaAsignacion
  })

  const asignaciones = filtrarAsignacionesHoy(await obtenerTickets(), { ahora })
  const guardada = asignaciones.find((item) => item.codigo_ticket === 'OFFLINE-HOY-001')

  assert.equal(guardada?.estado_sync, 'PENDIENTE')
  assert.equal(guardada?.fecha_asignacion, fechaAsignacion)
})

test('un ticket guardado no se acepta por segunda vez', async () => {
  const codigoTicket = 'ABC123'

  assert.equal(await existeTicketPendiente(codigoTicket), false)

  const operacion = await agregarOperacion('ASIGNAR_TICKET', {
    dniOperador: '12345678',
    dniCosechador: '87654321',
    codigoTicket
  })

  assert.equal(await existeTicketPendiente(codigoTicket), true)

  await marcarOperacionSincronizada(operacion.id)

  assert.equal(await existeTicketPendiente(codigoTicket), true)
})

test('las operaciones con error quedan fuera de la comprobación local', async () => {
  const codigoTicket = 'ERR123'
  const operacion = await agregarOperacion('ASIGNAR_TICKET', {
    dniOperador: '12345678',
    dniCosechador: '87654321',
    codigoTicket
  })

  await marcarOperacionError(operacion.id, 'Error de prueba')

  assert.equal(await existeTicketPendiente(codigoTicket), false)
})

test('los tickets del caché se pueden consultar por código', async () => {
  await guardarCache({
    campania: 'prueba',
    sincronizado_en: new Date().toISOString(),
    trabajadores: [],
    lotes: [],
    tickets: [{ codigo_ticket: 'CACHE123' }]
  })

  assert.deepEqual(await obtenerTicket('CACHE123'), {
    tenant_id: '00000000-0000-4000-8000-000000000001',
    campania_id: '',
    codigo_ticket: 'CACHE123',
    fecha_asignacion: null,
    estado_sync: 'SINCRONIZADO'
  })
})

test('el caché conserva una asignación local pendiente', async () => {
  const fechaAsignacion = '2026-09-30T13:42:00.000Z'
  await guardarTicketLocal({
    codigoTicket: 'LOCAL123',
    cosechadorDni: '87654321',
    cosechador: 'Juan Pérez',
    operacionId: 'operacion-local',
    fechaAsignacion
  })

  await guardarCache({
    campania: 'prueba',
    sincronizado_en: new Date().toISOString(),
    trabajadores: [],
    lotes: [],
    tickets: []
  })

  const ticketPendiente = await obtenerTicket('LOCAL123')
  assert.equal(ticketPendiente.cosechador, 'Juan Pérez')
  assert.equal(ticketPendiente.estado_sync, 'PENDIENTE')
  assert.equal(ticketPendiente.fecha_asignacion, fechaAsignacion)

  await marcarTicketSincronizado('LOCAL123')
  const ticketSincronizado = await obtenerTicket('LOCAL123')
  assert.equal(ticketSincronizado.estado_sync, 'SINCRONIZADO')
  assert.equal(ticketSincronizado.fecha_asignacion, fechaAsignacion)
})

test('sincronizar y recargar caché conserva fecha de asignación sin duplicar el ticket', async () => {
  const codigoTicket = 'SYNC-FECHA-001'
  const fechaAsignacion = '2026-09-30T14:10:00.000Z'

  await guardarTicketLocal({
    codigoTicket,
    cosechadorDni: '70112233',
    cosechador: 'Ana López',
    operacionId: 'operacion-sync-fecha',
    fechaAsignacion
  })
  await marcarTicketSincronizado(codigoTicket)

  await guardarCache({
    campania: 'prueba',
    sincronizado_en: new Date().toISOString(),
    trabajadores: [],
    lotes: [],
    tickets: [
      {
        codigo_ticket: codigoTicket,
        cosechador_dni: '70112233',
        cosechador: 'Ana López'
      }
    ]
  })

  const coincidencias = (await obtenerTickets()).filter(
    (item) => item.codigo_ticket === codigoTicket
  )

  assert.equal(coincidencias.length, 1)
  assert.equal(coincidencias[0].estado_sync, 'SINCRONIZADO')
  assert.equal(coincidencias[0].fecha_asignacion, fechaAsignacion)
})

test('una sincronización rechazada queda visible como error', async () => {
  const erroresPrevios = await contarErrores()
  const operacion = await agregarOperacion('ASIGNAR_TICKET', {
    dniOperador: '12345678',
    dniCosechador: '87654321',
    codigoTicket: 'RECHAZADO123'
  })

  await guardarTicketLocal({
    codigoTicket: 'RECHAZADO123',
    cosechadorDni: '87654321',
    cosechador: 'Juan Pérez',
    operacionId: operacion.id
  })

  await marcarOperacionError(operacion.id, 'Ticket ya asignado')
  await marcarTicketError('RECHAZADO123', 'Ticket ya asignado')

  assert.equal(await contarErrores(), erroresPrevios + 1)
  assert.equal((await obtenerTicket('RECHAZADO123')).estado_sync, 'ERROR')
})

test('jabero, sesión y lecturas quedan disponibles localmente', async () => {
  await guardarCache({
    campania: 'prueba',
    sincronizado_en: new Date().toISOString(),
    trabajadores: [{ dni: '70000003', nombre: 'Juan Pérez', roles: [] }],
    lotes: [{ lote_id: 'lote-1', codigo: 'L1', variedad: 'Variedad' }],
    tickets: []
  })

  await agregarRolTrabajador('70000003', 'JABERO')
  assert.deepEqual((await obtenerTrabajador('70000003')).roles, ['JABERO'])

  await guardarSesionLocal({ id: 'sesion-1', estado: 'ACTIVA' })
  await guardarLecturaLocal({
    id: 'lectura-1',
    sesion_id: 'sesion-1',
    cosechador_dni: '80000001',
    estado_sync: 'PENDIENTE'
  })
  await guardarLecturaLocal({
    id: 'lectura-2',
    sesion_id: 'sesion-1',
    cosechador_dni: '80000002',
    estado_sync: 'PENDIENTE'
  })

  assert.equal(await contarLecturasSesion('sesion-1'), 2)
  assert.equal(await contarLecturasCosechador('sesion-1', '80000001'), 1)

  await marcarLecturaSincronizada('lectura-1')
  await cerrarSesionLocal('sesion-1')
  assert.equal((await obtenerSesionLocal('sesion-1')).estado, 'CERRADA')
})

test('las operaciones rápidas conservan el orden de creación', async () => {
  const ids = []

  for (let numero = 0; numero < 20; numero += 1) {
    const operacion = await agregarOperacion('PRUEBA_ORDEN', { numero })
    ids.push(operacion.id)
  }

  const ordenadas = (await obtenerColaCompleta())
    .filter((operacion) => operacion.tipo === 'PRUEBA_ORDEN')
    .sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en))

  assert.deepEqual(
    ordenadas.map((operacion) => operacion.id),
    ids
  )
})
