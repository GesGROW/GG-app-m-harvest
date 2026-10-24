import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'

import {
  agregarOperacion,
  contarLecturasSesion,
  guardarLecturaLocal,
  guardarSesionLocal,
  marcarLecturaSincronizada,
  obtenerSesionLocal,
  obtenerSesionesOperador
} from '../src/offline/db.js'
import {
  FILTROS_SESIONES_LECTURA,
  enriquecerSesionLectura,
  filtrarSesionesLectura,
  formatearFechaSesion,
  formatearPeriodoSesion,
  ordenarSesionesLectura
} from '@gesgrow/core/contexts/harvest/application/queries/sesionesLectura.js'

function crearSesion(sufijo, cambios = {}) {
  const id = `sesion-${sufijo}`
  return {
    id,
    sesion_id: id,
    jabero: 'Pedro Ramírez',
    dni_jabero: '70000001',
    dni_operador: '10000001',
    lote_id: 'lote-1',
    lote_codigo: 'LOTE-001',
    variedad: 'Ventura',
    estado: 'ACTIVA',
    fecha_inicio: '2026-09-30T13:14:00.000Z',
    ...cambios
  }
}

test('una sesión activa local aparece para su operador', async () => {
  const sesion = crearSesion('activa-db', { dni_operador: '11000001' })
  await guardarSesionLocal(sesion)

  const sesiones = await obtenerSesionesOperador('11000001')
  assert.equal(
    sesiones.some((actual) => actual.id === sesion.id),
    true
  )
})

test('una sesión cerrada local también aparece para su operador', async () => {
  const sesion = crearSesion('cerrada-db', {
    dni_operador: '11000002',
    estado: 'CERRADA',
    fecha_fin: '2026-09-30T14:02:00.000Z'
  })
  await guardarSesionLocal(sesion)

  const sesiones = await obtenerSesionesOperador('11000002')
  assert.equal(
    sesiones.some((actual) => actual.id === sesion.id),
    true
  )
})

test('las sesiones activas aparecen antes que las cerradas', () => {
  const cerrada = crearSesion('orden-cerrada', {
    estado: 'CERRADA',
    fecha_inicio: '2026-09-30T15:00:00.000Z'
  })
  const activa = crearSesion('orden-activa', {
    fecha_inicio: '2026-09-30T10:00:00.000Z'
  })

  assert.deepEqual(
    ordenarSesionesLectura([cerrada, activa]).map((sesion) => sesion.id),
    [activa.id, cerrada.id]
  )
})

test('las sesiones cerradas se ordenan por fecha_inicio descendente', () => {
  const antigua = crearSesion('cerrada-antigua', {
    estado: 'CERRADA',
    fecha_inicio: '2026-09-28T10:00:00.000Z'
  })
  const reciente = crearSesion('cerrada-reciente', {
    estado: 'CERRADA',
    fecha_inicio: '2026-09-29T10:00:00.000Z'
  })

  assert.deepEqual(
    ordenarSesionesLectura([antigua, reciente]).map((sesion) => sesion.id),
    [reciente.id, antigua.id]
  )
})

test('el total de jabas usa una lectura local como una jaba', () => {
  const sesion = crearSesion('conteo')
  const lecturas = [1, 2, 3].map((numero) => ({
    id: `conteo-${numero}`,
    sesion_id: sesion.id,
    codigo_ticket: `T-${numero}`,
    cosechador_dni: '80000001'
  }))

  assert.equal(enriquecerSesionLectura(sesion, lecturas).total_jabas, 3)
})

test('las lecturas de otra sesión no cuentan', () => {
  const sesion = crearSesion('aislada')
  const lecturas = [
    { id: 'aislada-1', sesion_id: sesion.id },
    { id: 'otra-1', sesion_id: 'otra-sesion' }
  ]

  assert.equal(enriquecerSesionLectura(sesion, lecturas).total_jabas, 1)
})

test('el mismo ticket repetido cuenta como varias jabas', () => {
  const sesion = crearSesion('ticket-repetido')
  const lecturas = [1, 2].map((numero) => ({
    id: `ticket-repetido-${numero}`,
    sesion_id: sesion.id,
    codigo_ticket: 'TICKET-REPETIDO',
    cosechador_dni: '80000001'
  }))

  assert.equal(enriquecerSesionLectura(sesion, lecturas).total_jabas, 2)
})

test('la búsqueda por jabero ignora mayúsculas y espacios externos', () => {
  const sesion = crearSesion('buscar-jabero')
  const resultado = filtrarSesionesLectura([sesion], { busqueda: '  pedro RAMÍREZ ' })
  assert.equal(resultado.length, 1)
})

test('la búsqueda encuentra una sesión por DNI del jabero', () => {
  const sesion = crearSesion('buscar-dni')
  assert.equal(filtrarSesionesLectura([sesion], { busqueda: '70000001' }).length, 1)
})

test('la búsqueda encuentra una sesión por lote y variedad', () => {
  const sesion = crearSesion('buscar-lote')
  assert.equal(filtrarSesionesLectura([sesion], { busqueda: 'lote-001' }).length, 1)
  assert.equal(filtrarSesionesLectura([sesion], { busqueda: 'ventura' }).length, 1)
})

test('el filtro Activas devuelve solo sesiones activas', () => {
  const activa = crearSesion('filtro-activa')
  const cerrada = crearSesion('filtro-activa-cerrada', { estado: 'CERRADA' })
  const resultado = filtrarSesionesLectura([cerrada, activa], {
    filtro: FILTROS_SESIONES_LECTURA.ACTIVAS
  })

  assert.deepEqual(
    resultado.map((sesion) => sesion.id),
    [activa.id]
  )
})

test('el filtro Cerradas devuelve solo sesiones cerradas', () => {
  const activa = crearSesion('filtro-cerrada-activa')
  const cerrada = crearSesion('filtro-cerrada', { estado: 'CERRADA' })
  const resultado = filtrarSesionesLectura([activa, cerrada], {
    filtro: FILTROS_SESIONES_LECTURA.CERRADAS
  })

  assert.deepEqual(
    resultado.map((sesion) => sesion.id),
    [cerrada.id]
  )
})

test('fecha_inicio se formatea usando la hora local del dispositivo', () => {
  const inicioLocal = new Date(2026, 8, 30, 8, 14)
  const ahoraLocal = new Date(2026, 8, 30, 12, 0)

  assert.equal(formatearFechaSesion(inicioLocal.toISOString(), ahoraLocal), 'Hoy 08:14')
})

test('una fecha de otro día usa dd/mm y hora local', () => {
  const inicioLocal = new Date(2026, 8, 29, 8, 14)
  const ahoraLocal = new Date(2026, 8, 30, 12, 0)

  assert.equal(
    formatearFechaSesion(inicioLocal.toISOString(), ahoraLocal),
    '29/09 08:14'
  )
})

test('una sesión cerrada muestra inicio y hora de fin', () => {
  const inicioLocal = new Date(2026, 8, 30, 8, 14)
  const finLocal = new Date(2026, 8, 30, 9, 2)
  const ahoraLocal = new Date(2026, 8, 30, 12, 0)
  const sesion = crearSesion('periodo', {
    estado: 'CERRADA',
    fecha_inicio: inicioLocal.toISOString(),
    fecha_fin: finLocal.toISOString()
  })

  assert.equal(formatearPeriodoSesion(sesion, ahoraLocal), 'Hoy 08:14 – 09:02')
})

test('una sesión guardada sigue disponible desde una nueva conexión a IndexedDB', async () => {
  const sesion = crearSesion('persistida', { dni_operador: '11000003' })
  await guardarSesionLocal(sesion)

  const dbReabierta = await openDB('scc', 5)
  const guardada = await dbReabierta.get('sesiones', sesion.id)
  dbReabierta.close()

  assert.equal(guardada.id, sesion.id)
  assert.equal(guardada.jabero, sesion.jabero)
})

test('sincronizar una lectura no duplica ni elimina jabas del total local', async () => {
  const sesion = crearSesion('sync-conteo', { dni_operador: '11000004' })
  await guardarSesionLocal(sesion)
  for (const numero of [1, 2]) {
    await guardarLecturaLocal({
      id: `sync-conteo-${numero}`,
      sesion_id: sesion.id,
      codigo_ticket: 'TICKET-SYNC',
      cosechador_dni: '80000001',
      estado_sync: 'PENDIENTE'
    })
  }

  assert.equal(await contarLecturasSesion(sesion.id), 2)
  await marcarLecturaSincronizada('sync-conteo-1')
  assert.equal(await contarLecturasSesion(sesion.id), 2)
})

test('una sesión sin lecturas muestra 0 jabas', () => {
  const sesion = crearSesion('sin-lecturas')
  assert.equal(enriquecerSesionLectura(sesion, []).total_jabas, 0)
})

test('la cantidad de cosechadores distintos se calcula por DNI', () => {
  const sesion = crearSesion('cosechadores')
  const lecturas = [
    { id: 'cosechador-1', sesion_id: sesion.id, cosechador_dni: '80000001' },
    { id: 'cosechador-2', sesion_id: sesion.id, cosechador_dni: '80000001' },
    { id: 'cosechador-3', sesion_id: sesion.id, cosechador_dni: '80000002' }
  ]

  assert.equal(enriquecerSesionLectura(sesion, lecturas).cosechadores_distintos, 2)
})

test('consultar y enriquecer una sesión no modifica sus datos persistidos', async () => {
  const sesion = crearSesion('solo-consulta', { dni_operador: '11000005' })
  await guardarSesionLocal(sesion)
  const antes = structuredClone(await obtenerSesionLocal(sesion.id))

  const [consultada] = await obtenerSesionesOperador('11000005')
  enriquecerSesionLectura(consultada, [])
  const despues = await obtenerSesionLocal(sesion.id)

  assert.deepEqual(despues, antes)
})

test('sesiones antiguas cerradas recuperan dni_operador desde la cola local', async () => {
  const sesion = crearSesion('legacy-cerrada', {
    dni_operador: undefined,
    estado: 'CERRADA',
    fecha_fin: '2026-09-30T14:02:00.000Z'
  })
  await guardarSesionLocal(sesion)
  await agregarOperacion('INICIAR_SESION', {
    dniOperador: '11000006',
    dniJabero: sesion.dni_jabero,
    loteId: sesion.lote_id,
    sesionId: sesion.id
  })

  const sesiones = await obtenerSesionesOperador('11000006')
  assert.equal(
    sesiones.some((actual) => actual.id === sesion.id),
    true
  )
  assert.equal((await obtenerSesionLocal(sesion.id)).dni_operador, '11000006')
})
