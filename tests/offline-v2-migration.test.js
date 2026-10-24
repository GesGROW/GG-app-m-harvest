import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'

test('la versión 3 conserva una sesión activa y cola creadas por v2', async () => {
  const anterior = await openDB('scc', 2, {
    upgrade(db) {
      db.createObjectStore('meta')
      db.createObjectStore('operadores', { keyPath: 'dni' })
      db.createObjectStore('trabajadores', { keyPath: 'dni' })
      db.createObjectStore('lotes', { keyPath: 'lote_id' })
      db.createObjectStore('tickets', { keyPath: 'codigo_ticket' })
      const cola = db.createObjectStore('cola', { keyPath: 'id' })
      cola.createIndex('estado', 'estado')
      cola.createIndex('creado_en', 'creado_en')
      const sesiones = db.createObjectStore('sesiones', { keyPath: 'id' })
      sesiones.createIndex('estado', 'estado')
      const lecturas = db.createObjectStore('lecturas', { keyPath: 'id' })
      lecturas.createIndex('sesion_id', 'sesion_id')
      lecturas.createIndex('estado_sync', 'estado_sync')
    }
  })
  await anterior.put('sesiones', {
    id: 's-v2',
    sesion_id: 's-v2',
    dni_jabero: '87654321',
    lote_codigo: 'L2',
    estado: 'ACTIVA'
  })
  await anterior.put('cola', {
    id: 'op-v2',
    tipo: 'INICIAR_SESION',
    estado: 'SINCRONIZADA',
    creado_en: '2026-09-28T00:00:00.000Z',
    payload: { sesionId: 's-v2', dniOperador: '12345678' }
  })
  anterior.close()

  const { obtenerSesionesActivas } = await import('../src/offline/db.js')
  const sesiones = await obtenerSesionesActivas('12345678')
  assert.equal(sesiones.length, 1)
  assert.equal(sesiones[0].dni_operador, '12345678')
})
