import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'

test('la migración v3→v4 conserva caché, sesiones y pendientes bajo su campaña anterior', async () => {
  const anterior = await openDB('scc', 3, {
    upgrade(db) {
      db.createObjectStore('meta')
      db.createObjectStore('operadores', { keyPath: 'dni' })
      db.createObjectStore('trabajadores', { keyPath: 'dni' })
      db.createObjectStore('tickets', { keyPath: 'codigo_ticket' })
      db.createObjectStore('lotes', { keyPath: 'lote_id' })
      const cola = db.createObjectStore('cola', { keyPath: 'id' })
      cola.createIndex('estado', 'estado')
      cola.createIndex('creado_en', 'creado_en')
      const sesiones = db.createObjectStore('sesiones', { keyPath: 'id' })
      sesiones.createIndex('estado', 'estado')
      sesiones.createIndex('dni_operador', 'dni_operador')
      const lecturas = db.createObjectStore('lecturas', { keyPath: 'id' })
      lecturas.createIndex('sesion_id', 'sesion_id')
      lecturas.createIndex('estado_sync', 'estado_sync')
    }
  })
  await anterior.put(
    'meta',
    { id: 'campania-anterior', nombre: 'Arándanos 2026' },
    'campania_activa'
  )
  await anterior.put('trabajadores', {
    dni: '81000001',
    nombre: 'Ana',
    roles: ['JABERO']
  })
  await anterior.put('tickets', {
    codigo_ticket: 'T1',
    cosechador_dni: '81000002',
    estado_sync: 'PENDIENTE'
  })
  await anterior.put('lotes', { lote_id: 'L1', codigo: 'Norte' })
  await anterior.put('sesiones', {
    id: 'S1',
    dni_operador: '47480378',
    dni_jabero: '81000001',
    lote_id: 'L1',
    estado: 'ACTIVA'
  })
  await anterior.put('cola', {
    id: 'O1',
    tipo: 'INICIAR_SESION',
    estado: 'PENDIENTE',
    creado_en: new Date().toISOString(),
    payload: { dniOperador: '47480378', loteId: 'L1', sesionId: 'S1' }
  })
  anterior.close()
  const local = await import('../src/offline/db.js')
  await local.seleccionarCampaniaLocal('campania-anterior')
  assert.equal((await local.obtenerTicket('T1')).estado_sync, 'PENDIENTE')
  assert.equal((await local.obtenerTrabajador('81000001')).nombre, 'Ana')
  assert.equal((await local.obtenerSesionesActivas('47480378'))[0].id, 'S1')
  assert.equal(
    (await local.obtenerColaCompleta())[0].payload.campaniaId,
    'campania-anterior'
  )
  assert.equal(
    (await local.obtenerCacheCampania('campania-anterior')).nombre,
    'Arándanos 2026'
  )
  await local.seleccionarCampaniaLocal('otra-campania')
  assert.equal(await local.obtenerTicket('T1'), undefined)
  assert.deepEqual(await local.obtenerSesionesActivas('47480378'), [])
})
