import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'

test('la versión 3 migra desde v1 y conserva cola, sesiones y lecturas', async () => {
  const anterior = await openDB('scc', 1, {
    upgrade(db) {
      db.createObjectStore('meta')
      db.createObjectStore('operadores', { keyPath: 'dni' })
      db.createObjectStore('trabajadores', { keyPath: 'dni' })
      db.createObjectStore('lotes', { keyPath: 'lote_id' })
      db.createObjectStore('tickets', { keyPath: 'codigo_ticket' })
      const cola = db.createObjectStore('cola', { keyPath: 'id' })
      cola.createIndex('estado', 'estado')
      cola.createIndex('creado_en', 'creado_en')
    }
  })

  await anterior.put('operadores', { dni: '12345678', nombre: 'Operador' })
  await anterior.put('cola', {
    id: 'operacion-anterior',
    tipo: 'ASIGNAR_TICKET',
    estado: 'PENDIENTE',
    payload: { codigoTicket: 'ABC123' },
    creado_en: new Date().toISOString()
  })
  anterior.close()

  const {
    contarLecturasSesion,
    guardarLecturaLocal,
    guardarSesionLocal,
    obtenerColaCompleta,
    obtenerOperador,
    obtenerSesionLocal
  } = await import('../src/offline/db.js')

  assert.equal((await obtenerOperador('12345678')).nombre, 'Operador')
  assert.equal((await obtenerColaCompleta()).length, 1)

  await guardarSesionLocal({ id: 'sesion-local', estado: 'ACTIVA' })
  await guardarLecturaLocal({
    id: 'lectura-local',
    sesion_id: 'sesion-local',
    cosechador_dni: '87654321',
    estado_sync: 'PENDIENTE'
  })

  assert.equal((await obtenerSesionLocal('sesion-local')).estado, 'ACTIVA')
  assert.equal(await contarLecturasSesion('sesion-local'), 1)
  const migrada = await openDB('scc', 5)
  assert.equal(
    migrada.transaction('sesiones').store.indexNames.contains('dni_operador'),
    true
  )
  migrada.close()
})
