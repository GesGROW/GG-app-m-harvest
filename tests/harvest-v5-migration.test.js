import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'

async function contenido(db, nombres) {
  const resultado = {}
  for (const nombre of nombres) {
    const tx = db.transaction(nombre)
    resultado[nombre] = {
      keyPath: tx.store.keyPath,
      indices: [...tx.store.indexNames].map((n) => ({
        nombre: n,
        keyPath: tx.store.index(n).keyPath,
        unique: tx.store.index(n).unique
      })),
      claves: await tx.store.getAllKeys(),
      filas: await tx.store.getAll()
    }
    await tx.done
  }
  return resultado
}

test('v4 → v5 conserva datos, claves e índices; F6.1 añade solo ownership y su marcador', async () => {
  const anterior = await openDB('scc', 4, {
    upgrade(db) {
      db.createObjectStore('meta')
      db.createObjectStore('operadores', { keyPath: 'dni' })
      db.createObjectStore('trabajadores', { keyPath: ['campania_id', 'dni'] })
      db.createObjectStore('tickets', { keyPath: ['campania_id', 'codigo_ticket'] })
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
  const nombres = [...anterior.objectStoreNames]
  await anterior.put('meta', { id: 'A', estado: 'ACTIVA' }, 'campania_activa')
  await anterior.put('meta', { id: 'A', nombre: 'Campaña anterior' }, 'campania:A')
  await anterior.put('meta', { id: 'B', datos: [1, null, 'á'] }, 'campania:B')
  await anterior.put(
    'meta',
    { cualquierCache: true, binario: new Uint8Array([0, 255]) },
    'cache-existente'
  )
  await anterior.put('operadores', {
    dni: '12345678',
    autorizado_para_fecha: '2026-10-14'
  })
  await anterior.put('trabajadores', {
    campania_id: 'A',
    dni: '87654321',
    roles: ['COSECHADOR']
  })
  await anterior.put('trabajadores', {
    campania_id: 'B',
    dni: '87654321',
    nombre: 'Otra campaña'
  })
  await anterior.put('tickets', {
    campania_id: 'A',
    codigo_ticket: 'LEGACY',
    estado_sync: 'ERROR'
  })
  await anterior.put('lotes', { lote_id: 'L', campania_id: 'A' })
  await anterior.put('sesiones', {
    id: 'S',
    campania_id: 'A',
    estado: 'ACTIVA',
    dni_operador: '12345678'
  })
  for (const [id, estado] of [
    ['P', 'PENDIENTE'],
    ['E', 'ERROR'],
    ['C', 'SINCRONIZADA']
  ]) {
    await anterior.put('cola', {
      id,
      estado,
      tipo: 'REGISTRAR_JABA',
      payload: { campaniaId: 'A', codigoTicket: 'LEGACY', lecturaId: id },
      error: estado === 'ERROR' ? 'Rechazo previo' : null,
      creado_en: '2026-10-13T12:00:00Z'
    })
    await anterior.put('lecturas', {
      id,
      sesion_id: 'S',
      codigo_ticket: 'LEGACY',
      campania_id: 'A',
      estado_sync: estado
    })
  }
  const antes = await contenido(anterior, nombres)
  anterior.close()
  const local = await import('../src/offline/db.js')
  await local.obtenerColaCompleta() // Ejecuta la migración real de producción.
  const migrada = await openDB('scc', 5)
  assert.equal(migrada.version, 5)
  const despues = await contenido(migrada, nombres)
  for (const [nombre, store] of Object.entries(despues)) {
    if (nombre === 'meta') {
      const index = store.claves.indexOf('platform:ownership:v1')
      assert.deepEqual(store.filas[index], {
        tenantId: '00000000-0000-4000-8000-000000000001',
        version: 1
      })
      store.claves.splice(index, 1)
      store.filas.splice(index, 1)
    }
    for (const fila of store.filas) {
      if (fila.tenant_id !== undefined) {
        assert.equal(fila.tenant_id, '00000000-0000-4000-8000-000000000001')
        delete fila.tenant_id
      }
    }
  }
  assert.deepEqual(despues, antes)
  const persistido = await contenido(migrada, nombres)
  assert.deepEqual(
    [...migrada.objectStoreNames].filter((n) => !nombres.includes(n)),
    [
      'harvestAsignaciones',
      'harvestLotes',
      'harvestRegistros',
      'harvestReservas',
      'harvestTickets'
    ]
  )
  for (const nombre of [...migrada.objectStoreNames].filter(
    (n) => !nombres.includes(n)
  ))
    assert.equal(await migrada.count(nombre), 0)
  migrada.close()
  const reabierta = await openDB('scc', 5)
  assert.deepEqual(await contenido(reabierta, nombres), persistido)
  reabierta.close()
})
