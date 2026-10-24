import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'
import { openDB } from 'idb'
import { backend, configurarBackend } from '@gesgrow/core/backend/backend.js'
import { ErrorBackend } from '@gesgrow/core/backend/errores.js'
import { crearCasosDeUso } from '../src/application/crearCasosDeUso.js'
import { casosDeUso, configurarCasosDeUso } from '../src/application/casosDeUso.js'
import { crearAdaptadoresOffline } from '../src/infrastructure/offline/crearAdaptadoresOffline.js'
import { crearColaIndexedDB } from '../src/infrastructure/indexeddb/colaAdapter.js'
import { operacionesOperadores } from '@gesgrow/core/contexts/identity-access/ports/operadores.js'
import { operacionesCampanias } from '@gesgrow/core/contexts/campaign-management/ports/campanias.js'
import { operacionesCosecha } from '../src/ports/offline/cosecha.js'
import { operacionesCola } from '../src/ports/offline/cola.js'
import { operacionesSincronizacion } from '../src/ports/offline/sincronizacion.js'
import { validarPuertosOffline } from '../src/ports/offline/validarPuertosOffline.js'

const offline = crearAdaptadoresOffline()
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

async function seleccionar(id) {
  await offline.campanias.seleccionar(id)
  await offline.campanias.guardarCache({
    campania: { id, estado: 'ACTIVA' },
    trabajadores: [],
    tickets: [],
    lotes: []
  })
}
beforeEach(async () => {
  navigator.onLine = true
  const db = await openDB('scc', 5)
  const tx = db.transaction([...db.objectStoreNames], 'readwrite')
  for (const store of db.objectStoreNames) await tx.objectStore(store).clear()
  await tx.done
  db.close()
  await seleccionar('C')
})

function prepararBackend() {
  let fallar = true
  const llamadas = []
  const implementacion = Object.fromEntries(
    Object.keys(backend).map((nombre) => [nombre, async () => ({ ok: true })])
  )
  implementacion.asignarTicket = async (parametros) => {
    llamadas.push(parametros)
    if (fallar && parametros.campaniaId === 'C')
      throw new ErrorBackend('Rechazo', { status: 403 })
    return { ok: true }
  }
  configurarBackend(implementacion)
  return {
    llamadas,
    permitir: () => {
      fallar = false
    }
  }
}
const asignar = (codigoTicket) =>
  offline.cosecha.guardarAsignacion({
    codigoTicket,
    dniOperador: '12345678',
    cosechadorDni: '87654321',
    cosechador: 'Ana'
  })

test('los adapters implementan cinco puertos enfocados sin CRUD genérico ni inserción aislada de comandos', () => {
  validarPuertosOffline(offline)
  for (const [nombre, operaciones] of Object.entries({
    operadores: operacionesOperadores,
    campanias: operacionesCampanias,
    cosecha: operacionesCosecha,
    cola: operacionesCola,
    sincronizacion: operacionesSincronizacion
  })) {
    assert.deepEqual(Object.keys(offline[nombre]).sort(), [...operaciones].sort())
    assert.ok(Object.isFrozen(offline[nombre]))
    assert.equal(offline[nombre].agregarOperacion, undefined)
    assert.equal(offline[nombre].guardarEntidad, undefined)
  }
  assert.throws(
    () => crearCasosDeUso({ offline: { ...offline, cosecha: {} } }),
    /cosecha.obtenerTrabajador/
  )
  assert.throws(
    () => validarPuertosOffline({ ...offline, sincronizacion: {} }),
    /sincronizacion.sincronizar/
  )
})

test('la fachada de Application exige inyección y conserva la implementación ante configuración incompleta', async () => {
  const aislada = await import('../src/application/casosDeUso.js?sin-configuracion')
  assert.throws(
    () => aislada.casosDeUso.validarOperador('12345678'),
    /No se configuraron/
  )
  const implementacion = Object.fromEntries(
    Object.keys(casosDeUso).map((nombre) => [nombre, async () => nombre])
  )
  configurarCasosDeUso(implementacion)
  assert.throws(() => configurarCasosDeUso({}), /Falta el caso de uso/)
  assert.equal(await casosDeUso.validarOperador('12345678'), 'validarOperador')
})

test('el puerto de cola encapsula exactamente la consulta de inicio rechazado', async () => {
  for (const [operaciones, rechazado] of [
    [[], false],
    [
      [{ tipo: 'INICIAR_SESION', payload: { sesionId: 'S' }, estado: 'PENDIENTE' }],
      false
    ],
    [
      [{ tipo: 'INICIAR_SESION', payload: { sesionId: 'OTRA' }, estado: 'ERROR' }],
      false
    ],
    [[{ tipo: 'REGISTRAR_JABA', payload: { sesionId: 'S' }, estado: 'ERROR' }], false],
    [[{ tipo: 'INICIAR_SESION', payload: { sesionId: 'S' }, estado: 'ERROR' }], true]
  ]) {
    const cola = crearColaIndexedDB({ obtenerColaCompleta: async () => operaciones })
    assert.equal(await cola.inicioSesionRechazado('S'), rechazado)
  }
})

test('los puertos conservan bloqueo por campaña, sincronización entre campañas y reintento con el mismo UUID', async () => {
  const remoto = prepararBackend()
  const primera = await asignar('T001')
  const segunda = await asignar('T002')
  await seleccionar('D')
  const otraCampania = await asignar('T001')
  navigator.onLine = false
  await offline.sincronizacion.sincronizar()
  assert.deepEqual(remoto.llamadas, [])
  navigator.onLine = true
  await offline.sincronizacion.sincronizar()
  assert.deepEqual(
    remoto.llamadas.map((p) => [p.campaniaId, p.operacionId]),
    [
      ['C', primera.id],
      ['D', otraCampania.id]
    ]
  )
  const cola = await offline.cola.obtenerOperaciones()
  assert.equal(cola.find((op) => op.id === primera.id).estado, 'ERROR')
  assert.equal(cola.find((op) => op.id === segunda.id).estado, 'PENDIENTE')
  assert.equal(cola.find((op) => op.id === otraCampania.id).estado, 'SINCRONIZADA')
  assert.equal(await offline.cola.contarErrores(), 0)
  assert.equal(await offline.cola.contarPendientes(), 0)
  assert.equal(await offline.cola.reintentarOperacion(primera.id), true)
  assert.equal(
    (await offline.cosecha.obtenerTicket('T001')).estado_sync,
    'SINCRONIZADO'
  )
  await offline.campanias.seleccionar('C')
  assert.equal((await offline.cosecha.obtenerTicket('T001')).estado_sync, 'PENDIENTE')
  assert.equal(await offline.cola.contarPendientes(), 2)
  remoto.permitir()
  await offline.sincronizacion.sincronizar()
  assert.deepEqual(
    remoto.llamadas.slice(2).map((p) => p.operacionId),
    [primera.id, segunda.id]
  )
  assert.ok(
    (await offline.cola.obtenerOperaciones()).every(
      (op) => op.estado === 'SINCRONIZADA'
    )
  )
  assert.equal(
    (await offline.cola.obtenerOperaciones()).find((op) => op.id === primera.id)
      .intentos,
    1
  )
  await offline.sincronizacion.sincronizar()
  assert.equal(remoto.llamadas.length, 4)
})

test('descartar desde otra campaña elimina solo el comando rechazado y su ticket', async () => {
  prepararBackend()
  const rechazado = await asignar('T001')
  await seleccionar('D')
  const otraCampania = await asignar('T001')
  await offline.sincronizacion.sincronizar()
  assert.equal(await offline.cola.descartarOperacion(rechazado.id), true)
  assert.equal(
    (await offline.cosecha.obtenerTicket('T001')).operacion_id,
    otraCampania.id
  )
  await offline.campanias.seleccionar('C')
  assert.equal(await offline.cosecha.obtenerTicket('T001'), undefined)
  assert.deepEqual(
    (await offline.cola.obtenerOperaciones()).map((op) => op.id),
    [otraCampania.id]
  )
})

test('el puerto de descarte mantiene el bloqueo cuando existen lecturas dependientes', async () => {
  prepararBackend()
  const asignacion = await asignar('T001')
  await offline.cosecha.iniciarSesion(
    { id: 'S', dni_jabero: '87654322', estado: 'ACTIVA', campania_id: 'C' },
    '12345678'
  )
  await offline.cosecha.registrarLectura(
    { id: 'J', sesion_id: 'S', codigo_ticket: 'T001', estado_sync: 'PENDIENTE' },
    '12345678'
  )
  await offline.sincronizacion.sincronizar()
  assert.equal(await offline.cola.descartarOperacion(asignacion.id), false)
  assert.equal(
    (await offline.cosecha.obtenerTicket('T001')).operacion_id,
    asignacion.id
  )
  assert.equal((await offline.cola.obtenerOperaciones()).length, 3)
})
