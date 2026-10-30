import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { openDB } from 'idb'
import * as local from '../src/offline/db.js'
import { sincronizarPendientes } from '../src/offline/sync.js'
import { configurarBackend } from '@gesgrow/core/backend/backend.js'
import { crearSupabaseBackend } from '../src/infrastructure/supabase/backendAdapter.js'
import {
  respuestaAsignacionHarvest,
  respuestaRegistroHarvest
} from './helpers/asignacionHarvest.js'

const navigatorOriginal = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true
})
after(() => {
  if (navigatorOriginal)
    Object.defineProperty(globalThis, 'navigator', navigatorOriginal)
  else delete globalThis.navigator
})

beforeEach(async () => {
  navigator.onLine = true
  await local.seleccionarCampaniaLocal('C')
  const db = await openDB('scc', 5)
  const tx = db.transaction([...db.objectStoreNames], 'readwrite')
  for (const store of db.objectStoreNames) await tx.objectStore(store).clear()
  await tx.done
  db.close()
  await local.guardarCache({
    campania: { id: 'C', estado: 'ACTIVA' },
    trabajadores: [],
    tickets: [],
    lotes: []
  })
})

test('la cola conserva identificadores y parámetros; ASIGNAR_TICKET confirma un lote', async () => {
  const llamadas = []
  configurarBackend(
    crearSupabaseBackend({
      async rpc(...args) {
        llamadas.push(args)
        return {
          data: ['harvest_asignar_v4', 'harvest_registrar_v4'].includes(args[0])
            ? { modelo: 'LEGACY', resultado: { ok: true } }
            : { ok: true }
        }
      }
    })
  )
  const ticket = await local.guardarAsignacionOffline({
    codigoTicket: 'T001',
    cosechadorDni: '87654321',
    dniOperador: '12345678'
  })
  const jabero = await local.registrarJaberoOffline('12345678', '87654322')
  await local.iniciarSesionOffline(
    { id: 'S', dni_jabero: '87654322', lote_id: 'L', estado: 'ACTIVA' },
    '12345678'
  )
  const lectura = await local.registrarLecturaOffline(
    {
      id: 'J',
      sesion_id: 'S',
      codigo_ticket: 'T001',
      fecha_hora: '2026-10-14T12:00:00Z',
      estado_sync: 'PENDIENTE'
    },
    '12345678'
  )
  const cierre = await local.finalizarSesionOffline('S', '12345678')
  const pendientes = await local.obtenerColaCompleta()
  navigator.onLine = false
  await sincronizarPendientes()
  assert.deepEqual(llamadas, [])
  assert.deepEqual(await local.obtenerColaCompleta(), pendientes)
  navigator.onLine = true
  await sincronizarPendientes()
  assert.deepEqual(llamadas, [
    [
      'harvest_asignar_v4',
      {
        p_dni_operador: '12345678',
        p_dni_cosechador: '87654321',
        p_codigo_ticket: 'T001',
        p_operacion_id: ticket.id,
        p_campania_id: 'C'
      }
    ],
    [
      'registrar_jabero_campania',
      {
        p_dni_operador: '12345678',
        p_dni_trabajador: '87654322',
        p_operacion_id: jabero.id,
        p_campania_id: 'C'
      }
    ],
    [
      'iniciar_sesion_lectura_campania',
      {
        p_dni_operador: '12345678',
        p_dni_jabero: '87654322',
        p_lote_id: 'L',
        p_sesion_id: 'S',
        p_campania_id: 'C'
      }
    ],
    [
      'harvest_registrar_v4',
      {
        p_dni_operador: '12345678',
        p_sesion_id: 'S',
        p_codigo_ticket: 'T001',
        p_lectura_id: 'J',
        p_fecha_hora: '2026-10-14T12:00:00Z',
        p_operacion_id: lectura.id,
        p_campania_id: 'C'
      }
    ],
    [
      'cerrar_sesion_lectura_campania',
      {
        p_dni_operador: '12345678',
        p_sesion_id: 'S',
        p_operacion_id: cierre.id,
        p_campania_id: 'C'
      }
    ]
  ])
  assert.ok(
    (await local.obtenerColaCompleta()).every((op) => op.estado === 'SINCRONIZADA')
  )
  assert.equal((await local.obtenerTicket('T001')).estado_sync, 'SINCRONIZADO')
  assert.equal(
    (await local.obtenerTrabajador('87654322')).estado_sync_jabero,
    'SINCRONIZADO'
  )
  assert.equal((await local.obtenerLecturasSesion('S'))[0].estado_sync, 'SINCRONIZADO')
  await sincronizarPendientes()
  assert.equal(llamadas.length, 5)
})

for (const [error, estado] of [
  [{ message: 'Failed to fetch' }, 'PENDIENTE'],
  [{ status: 403, message: 'No autorizado' }, 'PENDIENTE'],
  [{ code: '42501', message: 'PDA revocado' }, 'PENDIENTE'],
  [{ code: 'P0001', message: 'Operación rechazada' }, 'ERROR']
]) {
  test(`el error ${error.code ?? error.status ?? 'de red'} conserva el estado ${estado} y bloquea los comandos posteriores`, async () => {
    let llamadas = 0
    configurarBackend(
      crearSupabaseBackend({
        async rpc() {
          llamadas += 1
          return { error }
        }
      })
    )
    const primero = await local.guardarAsignacionOffline({
      codigoTicket: 'T001',
      cosechadorDni: '87654321',
      dniOperador: '12345678'
    })
    await local.agregarOperacion('CERRAR_SESION', {
      dniOperador: '12345678',
      sesionId: 'S'
    })
    await sincronizarPendientes()
    const cola = await local.obtenerColaCompleta()
    assert.equal(llamadas, 1)
    assert.equal(cola.find((op) => op.id === primero.id).estado, estado)
    assert.equal(cola.find((op) => op.id === primero.id).error, error.message)
    assert.equal(cola.find((op) => op.id !== primero.id).estado, 'PENDIENTE')
    assert.equal((await local.obtenerTicket('T001')).estado_sync, estado)
  })
}
