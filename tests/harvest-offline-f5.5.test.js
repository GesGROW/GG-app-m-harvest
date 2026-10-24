import 'fake-indexeddb/auto'
import { IDBObjectStore } from 'fake-indexeddb'
import assert from 'node:assert/strict'
import test, { beforeEach, after } from 'node:test'
import { openDB, wrap } from 'idb'
import * as local from '../src/offline/db.js'
import { crearHarvestLocal } from '../src/offline/harvest.js'
import { sincronizarPendientes } from '../src/offline/sync.js'
import { configurarBackend, backend } from '@gesgrow/core/backend/backend.js'
import { crearCasosDeUso } from '../src/application/crearCasosDeUso.js'
import { crearAdaptadoresOffline } from '../src/infrastructure/offline/crearAdaptadoresOffline.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/index.js'
import {
  LoteDeTickets,
  Ticket,
  LoteYaAsignado,
  TicketYaUtilizado,
  TicketNoEncontrado,
  validarSnapshotHarvest
} from '@gesgrow/core/contexts/harvest/index.js'
import { snapshotHarvest } from './helpers/snapshotHarvest.js'

function configurarRemoto(funciones) {
  configurarBackend({
    ...Object.fromEntries(
      Object.keys(backend).map((nombre) => [
        nombre,
        async () => {
          throw new Error('Llamada inesperada: ' + nombre)
        }
      ])
    ),
    ...funciones
  })
}

const OP = '12345678',
  DNI = '87654321',
  JABERO = '87654322',
  FECHA = '2026-10-14T12:00:00Z'
const asignacion = { trabajadorId: 'W', operacionId: 'ASIG-SERVIDOR' }
const navigatorAnterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: false },
  configurable: true
})
after(() => {
  if (navigatorAnterior)
    Object.defineProperty(globalThis, 'navigator', navigatorAnterior)
  else delete globalThis.navigator
})

async function preparar(campaniaId = 'C', asignado = false) {
  const campania = { id: campaniaId, estado: 'ACTIVA', nombre: campaniaId }
  await local.seleccionarCampaniaLocal(campaniaId)
  await local.guardarOperador({
    dni: OP,
    autorizado_para_fecha: fechaOperativa(),
    campanias: [{ id: 'C' }, { id: 'D' }]
  })
  await local.guardarCache({
    campania,
    trabajadores: [
      { dni: DNI, id: 'W', nombre: 'Ana', roles: ['COSECHADOR'], activo: true },
      { dni: JABERO, id: 'JABERO', nombre: 'José', roles: ['JABERO'], activo: true }
    ],
    tickets: [],
    lotes: [],
    harvest: snapshotHarvest({ campaniaId, asignacion: asignado ? asignacion : null })
  })
  await local.guardarSesionLocal({
    id: `S-${campaniaId}`,
    sesion_id: `S-${campaniaId}`,
    campania_id: campaniaId,
    dni_operador: OP,
    dni_jabero: JABERO,
    estado: 'ACTIVA'
  })
}
const asignar = (codigoTicket = 'T1', campaniaId = 'C') =>
  local.reservarAsignacionHarvest({
    codigoTicket,
    cosechadorDni: DNI,
    dniOperador: OP,
    campaniaId
  })
const consumir = (codigoTicket = 'T1', campaniaId = 'C') =>
  local.reservarConsumoHarvest({
    codigoTicket,
    dniOperador: OP,
    campaniaId,
    sesionId: `S-${campaniaId}`,
    registroId: crypto.randomUUID(),
    fechaHora: FECHA
  })
async function dbSnapshot() {
  const db = await openDB('scc', 5)
  const resultado = {}
  for (const nombre of db.objectStoreNames) resultado[nombre] = await db.getAll(nombre)
  db.close()
  return resultado
}
async function fila(store, key) {
  const db = await openDB('scc', 5)
  const r = await db.get(store, key)
  db.close()
  return r
}
async function operacion(id) {
  return (await local.obtenerColaCompleta()).find((o) => o.id === id)
}
function resultadoAsignacion(op, trabajadorId = 'W') {
  const lote = new LoteDeTickets({ id: 'LT', campaniaId: op.payload.campaniaId })
  lote.asignar({ trabajadorId, operacionId: op.id })
  const ticket = new Ticket({ codigo: op.payload.codigoTicket, loteId: lote.id })
  return { lote, ticket, asignacion: lote.asignacion }
}
function resultadoConsumo(op, operacionAsignacion = asignacion.operacionId) {
  const r = resultadoAsignacion({ ...op, id: operacionAsignacion })
  const registro = r.ticket.registrarCosecha({
    id: op.payload.lecturaId,
    lote: r.lote,
    sesionId: op.payload.sesionId,
    operacionId: op.id,
    fechaHora: op.payload.fechaHora
  })
  return { ...r, registro }
}
async function abortarTras(store, accion) {
  const original = IDBObjectStore.prototype.put
  let abortada = false
  const observadas = []
  IDBObjectStore.prototype.put = function (...args) {
    const peticion = original.apply(this, args)
    if (this.name === store && !abortada) {
      abortada = true
      observadas.push(assert.rejects(wrap(this.transaction).done))
      peticion.addEventListener('success', () => this.transaction.abort(), {
        once: true
      })
    }
    return peticion
  }
  try {
    await assert.rejects(accion())
    await Promise.all(observadas)
    assert.ok(abortada)
  } finally {
    IDBObjectStore.prototype.put = original
  }
}

beforeEach(async () => {
  navigator.onLine = false
  await local.obtenerColaCompleta()
  const db = await openDB('scc', 5)
  const tx = db.transaction([...db.objectStoreNames], 'readwrite')
  for (const nombre of db.objectStoreNames) await tx.objectStore(nombre).clear()
  await tx.done
  db.close()
  await preparar()
})

test('una reserva asigna el lote efectivo, resuelve hermanos y conserva el snapshot disponible', async () => {
  const op = await asignar('T2')
  const e = await local.obtenerEstadoHarvest('T1')
  assert.equal(e.asignacionServidor, undefined)
  assert.equal(e.lote.asignacion.trabajadorId, 'W')
  assert.equal(e.reservaAsignacion.operacionId, op.id)
  assert.equal(e.proyeccion.cosechador_dni, DNI)
  assert.equal((await fila('harvestLotes', ['C', 'LT'])).estado, 'DISPONIBLE')
  assert.equal(op.modelo, 'HARVEST')
  assert.equal(op.origenVersion, 5)
  assert.deepEqual(op.payload, {
    codigoTicket: 'T2',
    dniCosechador: DNI,
    dniOperador: OP,
    campaniaId: 'C'
  })
  await assert.rejects(asignar('T1'), LoteYaAsignado)
  assert.equal((await local.obtenerColaCompleta()).length, 1)
})

test('dos reservas simultáneas de tickets hermanos se serializan en IndexedDB', async () => {
  const resultados = await Promise.allSettled([asignar('T1'), asignar('T2')])
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(
    resultados.find((r) => r.status === 'rejected').reason instanceof LoteYaAsignado
  )
  assert.equal((await dbSnapshot()).harvestReservas.length, 1)
})

test('consume offline una vez, deriva el trabajador y rechaza inmediatamente el segundo escaneo', async () => {
  const a = await asignar('T2')
  const { operacion: op, ticket } = await consumir('T1')
  assert.equal(ticket.cosechador_dni, DNI)
  assert.deepEqual(op.dependencias, [a.id])
  const e = await local.obtenerEstadoHarvest('T1')
  assert.equal(e.estadoServidor, 'DISPONIBLE')
  assert.equal(e.estadoEfectivo, 'CONSUMO_PENDIENTE')
  assert.equal(e.ticket.registroCosecha.trabajadorId, 'W')
  await assert.rejects(consumir('T1'), TicketYaUtilizado)
  assert.equal(await local.contarLecturasSesion('S-C'), 1)
  assert.equal(await local.contarLecturasCosechador('S-C', DNI), 1)
  assert.equal((await dbSnapshot()).harvestRegistros.length, 0)
  assert.equal((await fila('lecturas', op.payload.lecturaId)).estado_sync, 'PENDIENTE')
})

test('sin lote asignado, sin ticket, otra campaña o autorización vencida no se escribe ninguna intención', async () => {
  const antes = await dbSnapshot()
  await assert.rejects(consumir(), /no está asignado/)
  await assert.rejects(asignar('DESCONOCIDO'), TicketNoEncontrado)
  await assert.rejects(asignar('T1', 'D'))
  assert.deepEqual(await dbSnapshot(), antes)
  await local.guardarOperador({
    dni: OP,
    autorizado_para_fecha: '2000-01-01',
    campanias: [{ id: 'C' }]
  })
  const vencido = await dbSnapshot()
  await assert.rejects(asignar(), /autorización local/)
  assert.deepEqual(await dbSnapshot(), vencido)
})

test('sesión ajena/cerrada u operador ajeno a campaña se rechazan sin escrituras', async () => {
  await preparar('C', true)
  for (const cambio of [
    { estado: 'CERRADA' },
    { dni_operador: '00000000' },
    { campania_id: 'D' }
  ]) {
    await local.guardarSesionLocal({
      id: 'S-C',
      dni_operador: OP,
      campania_id: 'C',
      estado: 'ACTIVA',
      ...cambio
    })
    const antes = await dbSnapshot()
    await assert.rejects(consumir(), /sesión/)
    assert.deepEqual(await dbSnapshot(), antes)
  }
  await local.guardarOperador({
    dni: OP,
    autorizado_para_fecha: fechaOperativa(),
    campanias: [{ id: 'D' }]
  })
  await assert.rejects(asignar(), /ya no está asignada/)
})

for (const store of ['meta', 'cola', 'trabajadores', 'harvestReservas'])
  test(`asignación: aborto tras ${store} revierte reserva, comando y provisional`, async () => {
    const antes = await dbSnapshot()
    await abortarTras(store, () => asignar())
    assert.deepEqual(await dbSnapshot(), antes)
  })
for (const store of ['cola', 'harvestReservas', 'lecturas'])
  test(`consumo: aborto tras ${store} revierte lectura, reserva y comando`, async () => {
    await asignar()
    const antes = await dbSnapshot()
    await abortarTras(store, () => consumir())
    assert.deepEqual(await dbSnapshot(), antes)
  })

test('reservas, trabajador efectivo y consumo único sobreviven una nueva conexión y nuevas instancias', async () => {
  const a = await asignar()
  await consumir()
  const db = await openDB('scc', 5)
  const engine = crearHarvestLocal({
    dbPromise: Promise.resolve(db),
    crearOperacionEnTx: () => {
      throw new Error('No escribe esta prueba')
    }
  })
  const e = await engine.obtener('T1', 'C')
  assert.equal(e.estadoEfectivo, 'CONSUMO_PENDIENTE')
  assert.equal(e.reservaAsignacion.operacionId, a.id)
  assert.equal((await engine.obtener('T2', 'C')).lote.asignacion.trabajadorId, 'W')
  db.close()
})

test('renovar caché no sobrescribe reservas; snapshot tardío nunca revierte un ACK', async () => {
  const a = await asignar()
  const { operacion: c } = await consumir()
  await preparar()
  assert.equal(
    (await local.obtenerEstadoHarvest('T2')).reservaAsignacion.operacionId,
    a.id
  )
  assert.equal(
    (await local.obtenerEstadoHarvest('T1')).estadoEfectivo,
    'CONSUMO_PENDIENTE'
  )
  await local.confirmarOperacionHarvest(a, resultadoAsignacion(a))
  await local.confirmarOperacionHarvest(c, resultadoConsumo(c, a.id))
  const antes = await operacion(c.id)
  await local.confirmarOperacionHarvest(c, resultadoConsumo(c, a.id))
  assert.deepEqual(await operacion(c.id), antes)
  await local.guardarSnapshotHarvest(snapshotHarvest()) // Respuesta iniciada antes del ACK.
  const e = await local.obtenerEstadoHarvest('T1')
  assert.equal(e.estadoServidor, 'UTILIZADO')
  assert.equal(e.registroServidor.operacionId, c.id)
  assert.equal(e.asignacionServidor.operacionId, a.id)
  assert.equal((await fila('harvestTickets', ['C', 'T1'])).estado, 'UTILIZADO')
  assert.equal((await fila('harvestLotes', ['C', 'LT'])).estado, 'ASIGNADO')
  assert.equal((await fila('harvestReservas', c.id)).estado, 'CONFIRMADA')
  assert.equal(
    (await fila('lecturas', c.payload.lecturaId)).estado_sync,
    'SINCRONIZADO'
  )
  await assert.rejects(consumir(), TicketYaUtilizado)
})

test('confirmación: un fallo tras insertar registro revierte snapshot, reserva, lectura y ACK', async () => {
  await preparar('C', true)
  const { operacion: op } = await consumir()
  const antes = await dbSnapshot()
  await abortarTras('harvestRegistros', () =>
    local.confirmarOperacionHarvest(op, resultadoConsumo(op))
  )
  assert.deepEqual(await dbSnapshot(), antes)
  await local.confirmarOperacionHarvest(op, resultadoConsumo(op))
  assert.equal((await operacion(op.id)).estado, 'SINCRONIZADA')
})

test('rechazo de asignación bloquea lecturas de hermanos, preserva auditoría y corrige los conteos', async () => {
  const a = await asignar('T1')
  const { operacion: c } = await consumir('T2')
  await local.rechazarOperacionHarvest(a, new Error('Operador rechazado'))
  assert.equal((await operacion(a.id)).estado, 'ERROR')
  assert.equal((await operacion(c.id)).bloqueadaPorDependencia, true)
  assert.equal((await fila('harvestReservas', c.id)).estado, 'BLOQUEADA')
  assert.equal(await local.contarLecturasSesion('S-C'), 0)
  assert.equal(await local.contarLecturasCosechador('S-C', DNI), 0)
  assert.equal(await local.obtenerUltimaLecturaSesion('S-C'), undefined)
  const audit = await local.obtenerLecturasSesionCompletas('S-C')
  assert.equal(audit.length, 1)
  assert.equal(audit[0].valida, false)
  assert.equal(await local.reintentarOperacion(c.id), false)
  assert.equal(await local.reintentarOperacion(a.id), true)
  assert.equal((await operacion(a.id)).id, a.id)
  // El hijo sigue bloqueado hasta un reintento explícito; nunca se reactiva ocultamente.
  assert.equal((await operacion(c.id)).estado, 'ERROR')
})

test('rechazo y cascade también son una sola transacción IndexedDB', async () => {
  const a = await asignar()
  await consumir('T2')
  const antes = await dbSnapshot()
  await abortarTras('lecturas', () =>
    local.rechazarOperacionHarvest(a, new Error('Rechazo'))
  )
  assert.deepEqual(await dbSnapshot(), antes)
})

test('rechazo por TicketYaUtilizado mantiene intención y bloquea reescaneo hasta conocer el ganador', async () => {
  await preparar('C', true)
  const { operacion: c } = await consumir()
  await local.rechazarOperacionHarvest(c, new TicketYaUtilizado('T1'))
  await assert.rejects(consumir(), /Actualice la caché/)
  assert.equal(await local.contarLecturasSesion('S-C'), 0)
  await local.guardarSnapshotHarvest(
    snapshotHarvest({
      asignacion,
      registros: [
        {
          id: 'GANADOR',
          codigoTicket: 'T1',
          operacionId: 'OTRA',
          sesionId: 'S-C',
          fechaHora: FECHA
        }
      ]
    })
  )
  await assert.rejects(consumir(), TicketYaUtilizado)
  assert.equal((await local.obtenerEstadoHarvest('T1')).registroServidor.id, 'GANADOR')
  assert.equal((await operacion(c.id)).estado, 'ERROR')
})

test('snapshot confirma otra asignación: adopta autoridad y rechaza reserva y consumo dependiente', async () => {
  const a = await asignar()
  const { operacion: c } = await consumir('T2')
  await local.guardarSnapshotHarvest(
    snapshotHarvest({ asignacion: { trabajadorId: 'OTRO', operacionId: 'GANADOR' } })
  )
  const e = await local.obtenerEstadoHarvest('T2')
  assert.equal(e.lote.asignacion.trabajadorId, 'OTRO')
  assert.equal(e.reservaAsignacion, null)
  assert.equal(e.reservaConsumo, null)
  assert.equal((await operacion(a.id)).estado, 'ERROR')
  assert.equal((await operacion(c.id)).estado, 'ERROR')
  assert.equal(await local.contarLecturasSesion('S-C'), 0)
})

test('snapshot inválido aborta también la renovación de las cachés preexistentes', async () => {
  await asignar()
  const antes = await dbSnapshot()
  const s = snapshotHarvest()
  s.tickets[0].loteId = 'AJENO'
  await assert.rejects(
    local.guardarCache({
      campania: { id: 'C', estado: 'ACTIVA', nombre: 'No debe persistir' },
      trabajadores: [],
      lotes: [],
      tickets: [],
      harvest: s
    })
  )
  assert.deepEqual(await dbSnapshot(), antes)
  for (const cambio of [
    { campaniaId: 'D' },
    { estado: 'UTILIZADO' },
    { registroId: 'FALSO' }
  ]) {
    const corrupto = snapshotHarvest()
    Object.assign(corrupto.tickets[0], cambio)
    assert.throws(() => validarSnapshotHarvest(corrupto))
  }
})

test('Application productiva usa el puerto Harvest, sin fallback a escritura legacy ni consumo repetido', async () => {
  await local.guardarSnapshotHarvest(
    snapshotHarvest({ cutover: { campaniaId: 'C', version: 1, activadoEn: FECHA } })
  )
  const offline = crearAdaptadoresOffline()
  const cases = crearCasosDeUso({
    offline,
    backend: {},
    estaEnLinea: () => false,
    generarId: () => crypto.randomUUID(),
    ahora: () => FECHA,
    registrarError() {}
  })
  const operador = { dni: OP, campania: { id: 'C' } }
  const a = await cases.asignarTicket({
    operador,
    cosechador: { dni: DNI },
    codigoTicket: 'T2'
  })
  assert.equal(a.estado, 'PENDIENTE')
  const r = await cases.registrarLecturaJaba({
    operador,
    sesionLectura: { sesion_id: 'S-C', dni_jabero: JABERO },
    codigo: 'T1'
  })
  assert.equal(r.total, 1)
  assert.equal(r.ticket.cosechador_dni, DNI)
  assert.equal(await r.sincronizar(), false)
  assert.equal(await local.obtenerTicket('T2'), undefined)
  await assert.rejects(
    cases.registrarLecturaJaba({
      operador,
      sesionLectura: { sesion_id: 'S-C', dni_jabero: JABERO },
      codigo: 'T1'
    }),
    TicketYaUtilizado
  )
})

test('reconexión confirma lote y consumo en orden, conservando UUID ante respuesta perdida', async () => {
  const a = await asignar('T2')
  const { operacion: c } = await consumir('T1')
  const llamadas = [],
    recibos = new Map()
  let perder = true
  configurarRemoto({
    async asignarTicket(p) {
      llamadas.push(p.operacionId)
      const resultado = resultadoAsignacion(a)
      recibos.set(a.id, resultado)
      if (perder) {
        perder = false
        throw new Error('Failed to fetch')
      }
      return recibos.get(a.id)
    },
    async registrarLecturaJaba(p) {
      llamadas.push(p.operacionId)
      return resultadoConsumo(c, a.id)
    }
  })
  navigator.onLine = true
  await sincronizarPendientes()
  assert.equal((await operacion(a.id)).estado, 'PENDIENTE')
  assert.equal((await operacion(c.id)).estado, 'PENDIENTE')
  await sincronizarPendientes()
  await sincronizarPendientes()
  assert.deepEqual(llamadas, [a.id, a.id, c.id])
  assert.equal((await local.obtenerEstadoHarvest('T1')).estadoServidor, 'UTILIZADO')
  assert.equal(await local.contarLecturasSesion('S-C'), 1)
})

test('sync no envía lecturas dependientes de una asignación rechazada y consulta autoridad al reconectar', async () => {
  const a = await asignar('T1')
  const { operacion: c } = await consumir('T2')
  const llamadas = []
  configurarRemoto({
    async asignarTicket(p) {
      llamadas.push(p.operacionId)
      throw new LoteYaAsignado('LT')
    },
    async registrarLecturaJaba() {
      assert.fail('Nunca debe enviarse el consumo dependiente')
    },
    async obtenerSnapshotHarvest() {
      return snapshotHarvest({
        asignacion: { trabajadorId: 'OTRO', operacionId: 'GANADOR' }
      })
    }
  })
  navigator.onLine = true
  await sincronizarPendientes()
  assert.deepEqual(llamadas, [a.id])
  assert.equal((await operacion(c.id)).estado, 'ERROR')
  assert.equal(
    (await local.obtenerEstadoHarvest('T2')).asignacionServidor.trabajadorId,
    'OTRO'
  )
  assert.equal(await local.contarLecturasSesion('S-C'), 0)
})

test('dependencias de sesión/jabero son explícitas y su rechazo invalida la lectura provisional', async () => {
  await preparar('C', true)
  const j = await local.registrarJaberoOffline(OP, '87654323')
  const inicio = await local.iniciarSesionOffline(
    {
      id: 'S-C',
      sesion_id: 'S-C',
      dni_operador: OP,
      dni_jabero: '87654323',
      campania_id: 'C',
      estado: 'ACTIVA'
    },
    OP
  )
  const { operacion: c } = await consumir()
  assert.ok(c.dependencias.includes(inicio.id))
  assert.ok(c.dependencias.includes(j.id))
  await local.rechazarOperacionHarvest(j, new Error('Jabero rechazado'))
  assert.equal((await operacion(inicio.id)).estado, 'ERROR')
  assert.equal((await operacion(c.id)).estado, 'ERROR')
  assert.equal(await local.contarLecturasSesion('S-C'), 0)
})

test('comandos v4 conocidos se superponen sin cambiar UUID/payload; repetición ya encolada se rechaza', async () => {
  const a = await local.guardarAsignacionOffline({
    codigoTicket: 'T1',
    cosechadorDni: DNI,
    dniOperador: OP
  })
  const crear = () =>
    local.registrarLecturaOffline(
      {
        id: crypto.randomUUID(),
        sesion_id: 'S-C',
        codigo_ticket: 'T2',
        fecha_hora: FECHA,
        estado_sync: 'PENDIENTE'
      },
      OP
    )
  const c = await crear(),
    duplicado = await crear()
  await local.guardarSnapshotHarvest(snapshotHarvest())
  assert.deepEqual((await operacion(a.id)).payload, a.payload)
  assert.equal((await operacion(a.id)).origenVersion, 4)
  assert.deepEqual((await operacion(c.id)).payload, c.payload)
  assert.ok((await operacion(c.id)).dependencias.includes(a.id))
  assert.equal((await operacion(duplicado.id)).estado, 'ERROR')
  assert.equal(await local.contarLecturasSesion('S-C'), 1)
  await assert.rejects(consumir('T2'), TicketYaUtilizado)
  assert.equal(
    (await local.obtenerEstadoHarvest('T2')).reservaAsignacion.operacionId,
    a.id
  )
})

test('comandos v4 legacy conservan repeticiones y no crean reservas Harvest; servidor declara el modelo', async () => {
  const a = await local.guardarAsignacionOffline({
    codigoTicket: 'LEGACY',
    cosechadorDni: DNI,
    dniOperador: OP
  })
  const lectura = () =>
    local.registrarLecturaOffline(
      {
        id: crypto.randomUUID(),
        sesion_id: 'S-C',
        codigo_ticket: 'LEGACY',
        fecha_hora: FECHA,
        estado_sync: 'PENDIENTE'
      },
      OP
    )
  await lectura()
  await lectura()
  await local.guardarSnapshotHarvest(snapshotHarvest())
  const llamadas = []
  configurarRemoto({
    asignarTicket: async (p) => {
      llamadas.push(p)
      return { legacy: true, resultado: { ok: true } }
    },
    registrarLecturaJaba: async (p) => {
      llamadas.push(p)
      return { legacy: true, resultado: { ok: true } }
    }
  })
  navigator.onLine = true
  await sincronizarPendientes()
  assert.equal(llamadas.length, 3)
  assert.ok(llamadas.every((p) => p.compatibilidadV4))
  assert.equal((await operacion(a.id)).modelo, undefined)
  assert.equal(await local.contarLecturasSesion('S-C'), 2)
  assert.equal((await dbSnapshot()).harvestReservas.length, 0)
})

test('aislamiento por campaña y ACK tardío tras cambiar de campaña no contaminan el contexto nuevo', async () => {
  const a = await asignar('T1', 'C')
  await consumir('T2', 'C')
  await preparar('D')
  const d = await asignar('T1', 'D')
  await local.confirmarOperacionHarvest(a, resultadoAsignacion(a))
  assert.equal(
    (await local.obtenerEstadoHarvest('T1')).reservaAsignacion.operacionId,
    d.id
  )
  assert.equal((await local.obtenerEstadoHarvest('T2')).estadoEfectivo, 'DISPONIBLE')
  assert.equal(await local.contarLecturasSesion('S-C'), 0)
  const e = await local.obtenerEstadoHarvest('T2', 'C')
  assert.equal(e.estadoEfectivo, 'CONSUMO_PENDIENTE')
  assert.equal(e.asignacionServidor.operacionId, a.id)
  assert.equal((await fila('harvestReservas', d.id)).estado, 'ACTIVA')
})

test('dos consumos simultáneos locales del mismo ticket crean una sola reserva y lectura', async () => {
  await preparar('C', true)
  const intentos = await Promise.allSettled([consumir(), consumir()])
  assert.equal(intentos.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(
    intentos.find((r) => r.status === 'rejected').reason instanceof TicketYaUtilizado
  )
  const datos = await dbSnapshot()
  assert.equal(datos.harvestReservas.length, 1)
  assert.equal(datos.lecturas.length, 1)
  assert.equal(datos.cola.length, 1)
})

test('un rechazo definitivo no detiene consumos independientes en los siguientes ciclos', async () => {
  await preparar('C', true)
  const { operacion: c1 } = await consumir('T1'),
    { operacion: c2 } = await consumir('T2')
  const llamadas = []
  configurarRemoto({
    async registrarLecturaJaba(p) {
      llamadas.push(p.operacionId)
      if (p.operacionId === c1.id) throw new TicketYaUtilizado('T1')
      return resultadoConsumo(c2)
    },
    async obtenerSnapshotHarvest() {
      return snapshotHarvest({
        asignacion,
        registros: [
          {
            id: 'GANADOR',
            codigoTicket: 'T1',
            operacionId: 'EXTERNA',
            sesionId: 'S-C',
            fechaHora: FECHA
          }
        ]
      })
    }
  })
  navigator.onLine = true
  await sincronizarPendientes()
  await sincronizarPendientes()
  assert.deepEqual(llamadas, [c1.id, c2.id])
  assert.equal((await operacion(c1.id)).estado, 'ERROR')
  assert.equal((await operacion(c2.id)).estado, 'SINCRONIZADA')
  assert.equal(await local.contarLecturasSesion('S-C'), 1)
  assert.equal((await local.obtenerLecturasSesionCompletas('S-C')).length, 2)
})

test('identidades de Workforce confirmadas sobreviven una respuesta de caché anterior al ACK', async () => {
  const a = await local.reservarAsignacionHarvest({
    codigoTicket: 'T1',
    cosechadorDni: '87654329',
    dniOperador: OP,
    campaniaId: 'C'
  })
  assert.equal(
    (await local.obtenerEstadoHarvest('T2')).lote.asignacion.trabajadorId,
    'DNI:87654329'
  )
  await local.confirmarOperacionHarvest(a, resultadoAsignacion(a, 'UUID-NUEVO'))
  await preparar() // Workforce de esta respuesta antigua todavía no incluye al trabajador nuevo.
  assert.equal(
    (await local.obtenerEstadoHarvest('T2')).proyeccion.cosechador_dni,
    '87654329'
  )
  const { operacion: c } = await consumir('T2')
  assert.equal(
    (await fila('lecturas', c.payload.lecturaId)).trabajador_id,
    'UUID-NUEVO'
  )
  assert.equal((await fila('lecturas', c.payload.lecturaId)).cosechador_dni, '87654329')
})

test('snapshot resuelve un trabajador de otro dispositivo sin depender de IDs en la caché legacy', async () => {
  const s = snapshotHarvest({
    asignacion: { trabajadorId: 'UUID-EXTERNO', operacionId: 'EXTERNA' }
  })
  s.identidadesTrabajadores = [{ id: 'UUID-EXTERNO', dni: '87654329' }]
  await local.guardarSnapshotHarvest(s)
  assert.equal(
    (await local.obtenerEstadoHarvest('T2')).proyeccion.cosechador_dni,
    '87654329'
  )
  await preparar() // Snapshot antiguo sin identidades no borra el enlace confirmado.
  assert.equal(
    (await local.obtenerEstadoHarvest('T1')).proyeccion.cosechador_dni,
    '87654329'
  )
})

test('reintento conserva UUID y vuelve a comprobar la autorización existente', async () => {
  const a = await asignar()
  await local.rechazarOperacionHarvest(a, new Error('Rechazo'))
  await local.guardarOperador({
    dni: OP,
    autorizado_para_fecha: '2000-01-01',
    campanias: [{ id: 'C' }]
  })
  const antes = await dbSnapshot()
  await assert.rejects(local.reintentarOperacion(a.id), /autorización/)
  assert.deepEqual(await dbSnapshot(), antes)
})

test('ACK devuelve el registro original: conserva clave provisional y usa ID/fecha confirmados', async () => {
  await preparar('C', true)
  const { operacion: c } = await consumir()
  const original = resultadoConsumo({
    ...c,
    payload: {
      ...c.payload,
      lecturaId: 'REGISTRO-ORIGINAL',
      fechaHora: '2026-10-14T10:00:00Z'
    }
  })
  await local.confirmarOperacionHarvest(c, original)
  const l = await fila('lecturas', c.payload.lecturaId)
  assert.equal(l.id, c.payload.lecturaId)
  assert.equal(l.registro_confirmado_id, 'REGISTRO-ORIGINAL')
  assert.equal(l.fecha_hora, '2026-10-14T10:00:00Z')
  assert.equal(
    (await local.obtenerEstadoHarvest('T1')).registroServidor.id,
    'REGISTRO-ORIGINAL'
  )
  await local.confirmarOperacionHarvest(c, original)
  assert.equal(await local.contarLecturasSesion('S-C'), 1)
})

test('un ACK ajeno a campaña/código/sesión/UUID se rechaza sin confirmar la reserva', async () => {
  await preparar('C', true)
  const { operacion: c } = await consumir()
  const antes = await dbSnapshot()
  for (const cambio of [
    { id: 'OTRA' },
    { payload: { ...c.payload, campaniaId: 'D' } },
    { payload: { ...c.payload, codigoTicket: 'T2' } },
    { payload: { ...c.payload, sesionId: 'AJENA' } }
  ]) {
    await assert.rejects(
      local.confirmarOperacionHarvest(c, resultadoConsumo({ ...c, ...cambio }))
    )
    assert.deepEqual(await dbSnapshot(), antes)
  }
})

test('un timeout tardío no reactiva reservas ni dependientes rechazados durante el RPC', async () => {
  const a = await asignar(),
    { operacion: c } = await consumir('T2')
  configurarRemoto({
    async asignarTicket() {
      await local.guardarSnapshotHarvest(
        snapshotHarvest({
          asignacion: { trabajadorId: 'OTRO', operacionId: 'GANADOR' }
        })
      )
      throw new Error('Failed to fetch')
    }
  })
  navigator.onLine = true
  await sincronizarPendientes()
  assert.equal((await operacion(a.id)).estado, 'ERROR')
  assert.equal((await operacion(c.id)).estado, 'ERROR')
  assert.equal((await fila('harvestReservas', a.id)).estado, 'RECHAZADA')
  assert.equal(await local.contarLecturasSesion('S-C'), 0)
})
