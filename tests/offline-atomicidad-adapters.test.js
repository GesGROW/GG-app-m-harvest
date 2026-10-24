import 'fake-indexeddb/auto'
import { IDBObjectStore } from 'fake-indexeddb'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { openDB, wrap } from 'idb'
import { crearAdaptadoresOffline } from '../src/infrastructure/offline/crearAdaptadoresOffline.js'

const offline = crearAdaptadoresOffline()
const operador = '12345678'
const sesion = {
  id: 'S',
  sesion_id: 'S',
  dni_jabero: '87654322',
  dni_operador: operador,
  campania_id: 'C',
  lote_id: 'L',
  variedad_id: 'V',
  estado: 'ACTIVA',
  fecha_inicio: '2026-10-14T12:00:00.000Z'
}
const lectura = {
  id: 'J',
  sesion_id: 'S',
  codigo_ticket: 'T001',
  cosechador_dni: '87654321',
  cosechador: 'Ana',
  fecha_hora: '2026-10-14T12:01:00.000Z',
  estado_sync: 'PENDIENTE'
}

beforeEach(async () => {
  await offline.campanias.seleccionar('C')
  const db = await openDB('scc', 5)
  const tx = db.transaction([...db.objectStoreNames], 'readwrite')
  for (const store of db.objectStoreNames) await tx.objectStore(store).clear()
  await tx.done
  db.close()
  await offline.campanias.guardarCache({
    campania: { id: 'C', estado: 'ACTIVA' },
    trabajadores: [],
    lotes: [],
    tickets: []
  })
})

async function snapshot() {
  const db = await openDB('scc', 5)
  assert.equal(db.version, 5)
  assert.deepEqual(
    [...db.objectStoreNames],
    [
      'cola',
      'harvestAsignaciones',
      'harvestLotes',
      'harvestRegistros',
      'harvestReservas',
      'harvestTickets',
      'lecturas',
      'lotes',
      'meta',
      'operadores',
      'sesiones',
      'tickets',
      'trabajadores'
    ]
  )
  const tx = db.transaction([...db.objectStoreNames], 'readonly')
  const resultado = Object.fromEntries(
    await Promise.all(
      [...db.objectStoreNames].map(async (store) => [
        store,
        await tx.objectStore(store).getAll()
      ])
    )
  )
  await tx.done
  db.close()
  return resultado
}

// Observar la transacción nativa y provocar abortos DESPUÉS de una escritura
// exitosa evita confundir validación previa con rollback transaccional real.
async function observarEscrituras(ejecutar, abortarStore) {
  const original = IDBObjectStore.prototype.put
  const escrituras = []
  const abortos = []
  IDBObjectStore.prototype.put = function (value, ...args) {
    const request = original.call(this, value, ...args)
    escrituras.push({ store: this.name, value, transaction: this.transaction })
    if (this.name === abortarStore) {
      // Observar también done: un aborto intencional puede rechazar tanto la
      // siguiente petición de la función existente como el ciclo de vida de
      // la transacción. Ambas promesas forman parte de esta prueba de fallo.
      abortos.push(assert.rejects(wrap(this.transaction).done, { name: 'AbortError' }))
      request.addEventListener('success', () => this.transaction.abort(), {
        once: true
      })
    }
    return request
  }
  try {
    if (abortarStore) await assert.rejects(ejecutar())
    else return { operacion: await ejecutar(), escrituras }
    await Promise.all(abortos)
    assert.ok(escrituras.some((item) => item.store === abortarStore))
    return { escrituras }
  } finally {
    IDBObjectStore.prototype.put = original
  }
}

const operaciones = [
  {
    nombre: 'asignación',
    tipo: 'ASIGNAR_TICKET',
    store: 'tickets',
    preparar: async () => {},
    ejecutar: () =>
      offline.cosecha.guardarAsignacion({
        codigoTicket: 'T001',
        cosechadorDni: '87654321',
        cosechador: 'Ana',
        dniOperador: operador
      }),
    verificar(datos, op) {
      assert.equal(datos.tickets[0].operacion_id, op.id)
      assert.equal(datos.tickets[0].estado_sync, 'PENDIENTE')
      assert.ok(datos.trabajadores[0].roles.includes('COSECHADOR'))
      assert.equal(op.payload.codigoTicket, 'T001')
    }
  },
  {
    nombre: 'jabero',
    tipo: 'REGISTRAR_JABERO',
    store: 'trabajadores',
    preparar: async () => {},
    ejecutar: () => offline.cosecha.registrarJabero(operador, '87654322'),
    verificar(datos, op) {
      assert.equal(datos.trabajadores[0].operacion_jabero_id, op.id)
      assert.equal(datos.trabajadores[0].estado_sync_jabero, 'PENDIENTE')
      assert.ok(datos.trabajadores[0].roles.includes('JABERO'))
      assert.equal(op.payload.dniTrabajador, '87654322')
    }
  },
  {
    nombre: 'inicio de sesión',
    tipo: 'INICIAR_SESION',
    store: 'sesiones',
    preparar: async () => {},
    ejecutar: () => offline.cosecha.iniciarSesion(sesion, operador),
    verificar(datos, op) {
      assert.deepEqual(datos.sesiones[0], {
        ...sesion,
        tenant_id: '00000000-0000-4000-8000-000000000001'
      })
      assert.equal(op.payload.sesionId, sesion.id)
      assert.equal(op.payload.variedadId, sesion.variedad_id)
    }
  },
  {
    nombre: 'lectura',
    tipo: 'REGISTRAR_JABA',
    store: 'lecturas',
    preparar: () => offline.cosecha.iniciarSesion(sesion, operador),
    ejecutar: () => offline.cosecha.registrarLectura(lectura, operador),
    verificar(datos, op) {
      assert.deepEqual(datos.lecturas[0], {
        ...lectura,
        tenant_id: '00000000-0000-4000-8000-000000000001',
        campania_id: 'C'
      })
      assert.equal(op.payload.lecturaId, lectura.id)
      assert.equal(op.payload.fechaHora, lectura.fecha_hora)
    }
  },
  {
    nombre: 'cierre de sesión',
    tipo: 'CERRAR_SESION',
    store: 'sesiones',
    preparar: () => offline.cosecha.iniciarSesion(sesion, operador),
    ejecutar: () => offline.cosecha.cerrarSesion(sesion.id, operador),
    verificar(datos, op) {
      assert.equal(datos.sesiones[0].estado, 'CERRADA')
      assert.ok(datos.sesiones[0].fecha_fin)
      assert.equal(op.payload.sesionId, sesion.id)
    }
  }
]

for (const caso of operaciones) {
  test(`adapter ${caso.nombre} confirma cambio local y comando en UNA transacción`, async () => {
    await caso.preparar()
    const antes = await snapshot()
    const { operacion, escrituras } = await observarEscrituras(caso.ejecutar)
    const datos = await snapshot()
    assert.equal(datos.cola.length, antes.cola.length + 1)
    assert.deepEqual(
      datos.cola.find((op) => op.id === operacion.id),
      operacion
    )
    assert.equal(operacion.tipo, caso.tipo)
    assert.equal(operacion.estado, 'PENDIENTE')
    assert.equal(operacion.intentos, 0)
    assert.equal(operacion.payload.campaniaId, 'C')
    assert.match(operacion.id, /^[0-9a-f-]{36}$/)
    const comando = escrituras.find(
      (item) => item.store === 'cola' && item.value.id === operacion.id
    )
    assert.ok(comando)
    assert.ok(escrituras.some((item) => item.store === caso.store))
    for (const escritura of escrituras)
      assert.strictEqual(escritura.transaction, comando.transaction)
    caso.verificar(datos, operacion)
  })
  for (const store of ['cola', caso.store]) {
    test(`adapter ${caso.nombre}: abortar tras escribir ${store} revierte datos, comando y metadatos`, async () => {
      await caso.preparar()
      const antes = await snapshot()
      await observarEscrituras(caso.ejecutar, store)
      assert.deepEqual(await snapshot(), antes)
    })
  }
}

test('asignación revierte el cosechador provisional si se aborta antes de crear el comando', async () => {
  const antes = await snapshot()
  await observarEscrituras(operaciones[0].ejecutar, 'trabajadores')
  assert.deepEqual(await snapshot(), antes)
})
