import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  agregarOperacion,
  agregarRolTrabajador,
  guardarCache,
  marcarJabero,
  obtenerTrabajadores,
  registrarJaberoOffline
} from '../src/offline/db.js'
import {
  FILTROS_JABEROS_CAMPANIA,
  filtrarJaberosCampania,
  obtenerBadgeEstadoJabero
} from '@gesgrow/core/contexts/workforce/application/queries/jaberosCampania.js'

function trabajador({
  dni = '80000001',
  nombre = 'Pedro Ramírez',
  roles = ['JABERO'],
  estado
} = {}) {
  return {
    dni,
    nombre,
    roles,
    ...(estado ? { estado_sync_jabero: estado } : {})
  }
}

test('solo muestra jaberos, pendientes y errores relevantes', () => {
  const resultado = filtrarJaberosCampania([
    trabajador({ dni: '80000001', nombre: 'Ana', roles: ['JABERO'] }),
    trabajador({ dni: '80000002', nombre: 'Bruno', roles: ['COSECHADOR'] }),
    trabajador({ dni: '80000003', nombre: 'Carla', roles: [], estado: 'PENDIENTE' }),
    trabajador({ dni: '80000004', nombre: 'Diego', roles: [], estado: 'ERROR' })
  ])

  assert.deepEqual(
    resultado.map((item) => item.dni),
    ['80000001', '80000003', '80000004']
  )
})

test('busca por nombre y DNI ignorando mayúsculas, extremos y espacios múltiples', () => {
  const trabajadores = [
    trabajador({ dni: '82000001', nombre: 'María   López' }),
    trabajador({ dni: '82000002', nombre: 'Luis Torres' })
  ]

  assert.deepEqual(
    filtrarJaberosCampania(trabajadores, { busqueda: '  MARÍA LÓPEZ ' }).map(
      (item) => item.dni
    ),
    ['82000001']
  )
  assert.deepEqual(
    filtrarJaberosCampania(trabajadores, { busqueda: ' 82000002 ' }).map(
      (item) => item.dni
    ),
    ['82000002']
  )
})

test('ordena por nombre ascendente y usa DNI como desempate', () => {
  const resultado = filtrarJaberosCampania([
    trabajador({ dni: '82000003', nombre: 'Zoe' }),
    trabajador({ dni: '82000002', nombre: 'Álvaro' }),
    trabajador({ dni: '82000001', nombre: 'Álvaro' })
  ])

  assert.deepEqual(
    resultado.map((item) => item.dni),
    ['82000001', '82000002', '82000003']
  )
})

test('filtros Pendientes y Error aíslan el estado solicitado', () => {
  const trabajadores = [
    trabajador({ dni: '83000001', nombre: 'Normal' }),
    trabajador({
      dni: '83000002',
      nombre: 'Pendiente',
      roles: [],
      estado: 'PENDIENTE'
    }),
    trabajador({ dni: '83000003', nombre: 'Fallido', roles: [], estado: 'ERROR' })
  ]

  assert.deepEqual(
    filtrarJaberosCampania(trabajadores, {
      filtro: FILTROS_JABEROS_CAMPANIA.PENDIENTE
    }).map((item) => item.dni),
    ['83000002']
  )
  assert.deepEqual(
    filtrarJaberosCampania(trabajadores, {
      filtro: FILTROS_JABEROS_CAMPANIA.ERROR
    }).map((item) => item.dni),
    ['83000003']
  )
})

test('solo Pendiente y Error generan badge visible', () => {
  assert.equal(obtenerBadgeEstadoJabero('SINCRONIZADO'), null)
  assert.equal(obtenerBadgeEstadoJabero(undefined), null)
  assert.deepEqual(obtenerBadgeEstadoJabero('PENDIENTE'), {
    etiqueta: 'Pendiente',
    clase: 'sync-badge--pending'
  })
  assert.deepEqual(obtenerBadgeEstadoJabero('ERROR'), {
    etiqueta: 'Error',
    clase: 'sync-badge--error'
  })
})

test('un registro offline aparece inmediatamente como pendiente desde IndexedDB', async () => {
  await guardarCache({
    campania: 'jaberos-test',
    sincronizado_en: '',
    trabajadores: [{ dni: '84000001', nombre: 'Offline', roles: [] }],
    lotes: [],
    tickets: []
  })

  await registrarJaberoOffline('12345678', '84000001')
  const resultado = filtrarJaberosCampania(await obtenerTrabajadores())

  assert.equal(
    resultado.find((item) => item.dni === '84000001').estado_sync_jabero,
    'PENDIENTE'
  )
})

test('sincronización confirmada y recarga de caché conservan un solo trabajador JABERO', async () => {
  await guardarCache({
    campania: 'jaberos-test',
    sincronizado_en: '',
    trabajadores: [{ dni: '85000001', nombre: 'Confirmado', roles: [] }],
    lotes: [],
    tickets: []
  })
  const op = await agregarOperacion('REGISTRAR_JABERO', { dniTrabajador: '85000001' })
  await agregarRolTrabajador('85000001', 'JABERO', op.id)
  await marcarJabero('85000001', 'SINCRONIZADO', op.id)

  await guardarCache({
    campania: 'jaberos-test',
    sincronizado_en: '',
    trabajadores: [{ dni: '85000001', nombre: 'Confirmado', roles: ['JABERO'] }],
    lotes: [],
    tickets: []
  })

  const coincidencias = (await obtenerTrabajadores()).filter(
    (item) => item.dni === '85000001'
  )
  assert.equal(coincidencias.length, 1)
  assert.deepEqual(coincidencias[0].roles, ['JABERO'])
  assert.equal(coincidencias[0].estado_sync_jabero, undefined)
  assert.equal(coincidencias[0].operacion_jabero_id, undefined)
})

test('el estado pendiente persiste al cerrar y reabrir una conexión IndexedDB', async () => {
  await guardarCache({
    campania: 'jaberos-test',
    sincronizado_en: '',
    trabajadores: [{ dni: '86000001', nombre: 'Persistente', roles: [] }],
    lotes: [],
    tickets: []
  })
  await registrarJaberoOffline('12345678', '86000001')

  const conexionInicial = await new Promise((resolve, reject) => {
    const request = indexedDB.open('scc', 5)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  conexionInicial.close()

  const conexionReabierta = await new Promise((resolve, reject) => {
    const request = indexedDB.open('scc', 5)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const registro = await new Promise((resolve, reject) => {
    const tx = conexionReabierta.transaction('trabajadores', 'readonly')
    const request = tx.objectStore('trabajadores').get(['', '86000001'])
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  conexionReabierta.close()

  assert.equal(registro.estado_sync_jabero, 'PENDIENTE')
  assert.equal(registro.roles.includes('JABERO'), true)
})
