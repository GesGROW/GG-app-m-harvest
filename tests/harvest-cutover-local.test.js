import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { openDB } from 'idb'
import * as local from '../src/offline/db.js'
import { crearCasosDeUso } from '../src/application/crearCasosDeUso.js'
import { crearAdaptadoresOffline } from '../src/infrastructure/offline/crearAdaptadoresOffline.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/index.js'
import {
  modeloOperativoHarvest,
  PoliticaHarvestDesconocida,
  EscrituraLegacyRetirada,
  CampaniaSinCutover,
  TicketYaUtilizado,
  TicketNoEncontrado,
  LoteYaAsignado,
  LoteDeTickets,
  Ticket
} from '@gesgrow/core/contexts/harvest/index.js'
import { snapshotHarvest } from './helpers/snapshotHarvest.js'

const OP = '12345678',
  DNI = '87654321',
  J = '87654322'
const politica = { campaniaId: 'C', version: 1, activadoEn: '2026-10-14T12:00:00Z' }
const operador = { dni: OP, campania: { id: 'C' } },
  sesionLectura = { sesion_id: 'S', dni_jabero: J }
const asignacion = { trabajadorId: 'W', operacionId: 'ASIGNACION' }
const cases = crearCasosDeUso({
  offline: crearAdaptadoresOffline(),
  backend: {},
  generarId: () => crypto.randomUUID(),
  ahora: () => new Date().toISOString(),
  estaEnLinea: () => false,
  registrarError() {}
})
const asignar = () =>
  cases.asignarTicket({ operador, cosechador: { dni: DNI }, codigoTicket: 'T1' })
const registrar = () =>
  cases.registrarLecturaJaba({ operador, sesionLectura, codigo: 'T1' })

function nuevaGeneracion(asignacion = null) {
  const inicial = snapshotHarvest({ cutover: politica })
  const nueva = snapshotHarvest({
    cutover: politica,
    loteId: 'LT-NUEVO',
    codigos: ['N1', 'N2'],
    asignacion
  })
  return {
    ...nueva,
    lotesDeTickets: [...inicial.lotesDeTickets, ...nueva.lotesDeTickets],
    tickets: [...inicial.tickets, ...nueva.tickets]
  }
}
function casosConCatalogo(obtenerSnapshotHarvest, enLinea = true) {
  return crearCasosDeUso({
    offline: crearAdaptadoresOffline(),
    backend: { obtenerSnapshotHarvest },
    estaEnLinea: () => enLinea,
    asignacionPorLoteObligatoria: true,
    generarId: () => crypto.randomUUID(),
    ahora: () => new Date().toISOString(),
    registrarError() {}
  })
}
const asignarNuevo = (casos, codigoTicket = 'N1') =>
  casos.asignarTicket({ operador, cosechador: { dni: DNI }, codigoTicket })
async function filas(store) {
  const db = await openDB('scc', 5)
  try {
    return await db.getAll(store)
  } finally {
    db.close()
  }
}
async function cache(cutover) {
  await local.guardarSnapshotHarvest(snapshotHarvest({ cutover }))
}
beforeEach(async () => {
  await local.obtenerColaCompleta()
  const db = await openDB('scc', 5),
    tx = db.transaction([...db.objectStoreNames], 'readwrite')
  for (const nombre of db.objectStoreNames) await tx.objectStore(nombre).clear()
  await tx.done
  db.close()
  await local.seleccionarCampaniaLocal('C')
  await local.guardarOperador({
    dni: OP,
    autorizado_para_fecha: fechaOperativa(),
    campanias: [{ id: 'C' }, { id: 'D' }]
  })
  await local.guardarCache({
    campania: { id: 'C', estado: 'ACTIVA' },
    trabajadores: [
      { id: 'W', dni: DNI, nombre: 'Ana', activo: true, roles: ['COSECHADOR'] },
      { id: 'J', dni: J, nombre: 'José', activo: true, roles: ['JABERO'] }
    ],
    tickets: [],
    lotes: [],
    harvest: snapshotHarvest()
  })
  await local.guardarSesionLocal({
    id: 'S',
    sesion_id: 'S',
    campania_id: 'C',
    dni_operador: OP,
    dni_jabero: J,
    estado: 'ACTIVA'
  })
})

test('política explícita distingue caché desconocida, legacy y Harvest sin inferir por fecha/registros', () => {
  assert.throws(
    () => modeloOperativoHarvest(undefined, 'C'),
    PoliticaHarvestDesconocida
  )
  assert.equal(modeloOperativoHarvest(null, 'C'), 'LEGACY')
  assert.equal(
    modeloOperativoHarvest({ ...politica, activadoEn: '2999-01-01T00:00:00Z' }, 'C'),
    'HARVEST'
  )
  for (const p of [
    { ...politica, campaniaId: 'D' },
    { ...politica, version: 2 },
    { ...politica, activadoEn: 'invalida' }
  ])
    assert.throws(() => modeloOperativoHarvest(p, 'C'))
})

test('Application exige renovar caché de versiones anteriores antes de crear nuevas intenciones', async () => {
  await assert.rejects(asignar(), PoliticaHarvestDesconocida)
  await assert.rejects(registrar(), PoliticaHarvestDesconocida)
  assert.deepEqual(await filas('cola'), [])
  assert.deepEqual(await filas('harvestReservas'), [])
})

test('E023: descarga una generación posterior al ingreso y reserva una sola vez todo el lote', async () => {
  await cache(politica)
  let descargas = 0
  const casos = casosConCatalogo(async (dni, campaniaId) => {
    descargas++
    assert.equal(dni, OP)
    assert.equal(campaniaId, 'C')
    assert.deepEqual(await filas('cola'), [])
    return nuevaGeneracion()
  })
  const r = await asignarNuevo(casos)
  assert.equal(descargas, 1)
  assert.equal(r.estado, 'PENDIENTE')
  assert.equal((await filas('cola')).length, 1)
  assert.equal(
    (await local.obtenerEstadoHarvest('N2')).lote.asignacion.operacionId,
    r.operacion.id
  )
  await assert.rejects(asignarNuevo(casos, 'N2'), LoteYaAsignado)
  assert.equal(descargas, 1)
})

test('E023: la renovación conserva reservas y lecturas pendientes de otros lotes', async () => {
  await cache(politica)
  const anterior = await asignar()
  await registrar()
  const antes = await filas('cola')
  const casos = casosConCatalogo(async () => nuevaGeneracion())
  await asignarNuevo(casos)
  const despues = await filas('cola')
  for (const op of antes)
    assert.deepEqual(
      despues.find((o) => o.id === op.id),
      op
    )
  assert.equal(
    (await local.obtenerEstadoHarvest('T2')).lote.asignacion.operacionId,
    anterior.operacion.id
  )
  assert.equal(await local.contarLecturasSesion('S'), 1)
})

test('E023: un ticket inexistente tras renovar se rechaza sin bucles ni comandos', async () => {
  await cache(politica)
  let descargas = 0
  const casos = casosConCatalogo(async () => {
    descargas++
    return nuevaGeneracion()
  })
  await assert.rejects(asignarNuevo(casos, 'NO-EXISTE'), TicketNoEncontrado)
  assert.equal(descargas, 1)
  assert.deepEqual(await filas('cola'), [])
})

test('E023: sin conexión distingue ticket no descargado y permite asignar los conocidos', async () => {
  await cache(politica)
  const casos = casosConCatalogo(async () => {
    assert.fail('No debe consultar sin conexión')
  }, false)
  await assert.rejects(asignarNuevo(casos), /no está descargado.*Conéctate/)
  assert.deepEqual(await filas('cola'), [])
  await asignarNuevo(casos, 'T1')
  assert.equal((await filas('cola')).length, 1)
})

test('E023: al renovar se respeta la asignación de otro PDA', async () => {
  await cache(politica)
  const casos = casosConCatalogo(async () =>
    nuevaGeneracion({ trabajadorId: 'OTRO', operacionId: 'ASIG-REMOTA' })
  )
  await assert.rejects(asignarNuevo(casos), LoteYaAsignado)
  assert.deepEqual(await filas('cola'), [])
})

test('E023: fallo de red no crea intención ni impide una renovación posterior', async () => {
  await cache(politica)
  let descargas = 0
  const casos = casosConCatalogo(async () => {
    if (++descargas === 1) throw new Error('No se pudo conectar')
    return nuevaGeneracion()
  })
  await assert.rejects(asignarNuevo(casos), /No se pudo conectar/)
  assert.deepEqual(await filas('cola'), [])
  await asignarNuevo(casos)
  assert.equal(descargas, 2)
  assert.equal((await filas('cola')).length, 1)
})

test('E023: no guarda ni asigna tickets de otra campaña o empresa', async () => {
  await cache(politica)
  const ajena = casosConCatalogo(async () =>
    snapshotHarvest({ campaniaId: 'D', codigos: ['N1'] })
  )
  await assert.rejects(asignarNuevo(ajena), /no corresponden a esta campaña/)
  const otraEmpresa = casosConCatalogo(async () => ({
    ...nuevaGeneracion(),
    tenantId: crypto.randomUUID()
  }))
  await assert.rejects(asignarNuevo(otraEmpresa))
  assert.deepEqual(await filas('cola'), [])
  await assert.rejects(local.obtenerEstadoHarvest('N1'), TicketNoEncontrado)
})

test('E023: también renueva antes de leer un ticket nuevo ya asignado', async () => {
  await cache(politica)
  let descargas = 0
  const casos = casosConCatalogo(async () => {
    descargas++
    return nuevaGeneracion(asignacion)
  })
  const lectura = await casos.registrarLecturaJaba({
    operador,
    sesionLectura,
    codigo: 'N1'
  })
  assert.equal(descargas, 1)
  assert.equal(lectura.total, 1)
  assert.equal((await filas('cola')).length, 1)
})

test('E023: escaneos simultáneos comparten descarga y solo uno reserva el lote', async () => {
  await cache(politica)
  let descargas = 0
  const casos = casosConCatalogo(async () => {
    descargas++
    await new Promise((resolve) => setTimeout(resolve, 20))
    return nuevaGeneracion()
  })
  const resultados = await Promise.allSettled([
    asignarNuevo(casos),
    asignarNuevo(casos, 'N2')
  ])
  assert.equal(descargas, 1)
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1)
  assert.ok(
    resultados.find((r) => r.status === 'rejected').reason instanceof LoteYaAsignado
  )
  assert.equal((await filas('cola')).length, 1)
})

test('antes del corte Application usa legacy explícito y conserva escaneos repetidos', async () => {
  await cache(null)
  const a = await asignar()
  assert.equal(a.operacion.modelo, 'LEGACY')
  const r1 = await registrar(),
    r2 = await registrar()
  assert.equal(r1.operacion.modelo, 'LEGACY')
  assert.equal(r2.total, 2)
  assert.equal((await filas('harvestReservas')).length, 0)
  await assert.rejects(
    local.reservarAsignacionHarvest({
      codigoTicket: 'T2',
      cosechadorDni: DNI,
      dniOperador: OP,
      campaniaId: 'C'
    }),
    CampaniaSinCutover
  )
})

test('PDA exige asignación por lote y no genera pendientes por ticket con caché antigua', async () => {
  await cache(null)
  const pda = crearCasosDeUso({
    offline: crearAdaptadoresOffline(),
    backend: {},
    asignacionPorLoteObligatoria: true,
    generarId: () => crypto.randomUUID(),
    ahora: () => new Date().toISOString(),
    estaEnLinea: () => false,
    registrarError() {}
  })
  await assert.rejects(
    pda.asignarTicket({ operador, cosechador: { dni: DNI }, codigoTicket: 'T1' }),
    /Actualiza los datos/
  )
  assert.deepEqual(await filas('cola'), [])
  await cache(politica)
  const r = await pda.asignarTicket({
    operador,
    cosechador: { dni: DNI },
    codigoTicket: 'T1'
  })
  assert.equal(r.operacion.modelo, 'HARVEST')
  await assert.rejects(
    pda.asignarTicket({ operador, cosechador: { dni: J }, codigoTicket: 'T2' }),
    /asignado/
  )
})

test('consulta de asignados muestra todos los tickets del lote y omite la asignación legacy reparada', async () => {
  await cache(politica)
  await local.guardarTicketLocal({
    codigoTicket: 'T2',
    cosechadorDni: J,
    cosechador: 'Anterior',
    operacionId: 'OLD'
  })
  const r = await asignar()
  const pendientes = await local.obtenerAsignacionesTickets()
  assert.deepEqual(pendientes.map((t) => t.codigo_ticket).sort(), ['T1', 'T2'])
  assert.ok(
    pendientes.every(
      (t) =>
        t.cosechador_dni === DNI &&
        t.cosechador === 'Ana' &&
        t.estado_sync === 'PENDIENTE'
    )
  )
  assert.ok(pendientes.every((t) => t.fecha_asignacion === r.operacion.creado_en))
  await local.guardarSnapshotHarvest(
    snapshotHarvest({
      cutover: politica,
      asignacion: {
        trabajadorId: 'W',
        operacionId: r.operacion.id,
        fechaAsignacion: '2026-10-28T18:37:03Z'
      }
    })
  )
  const confirmadas = await local.obtenerAsignacionesTickets()
  assert.equal(confirmadas.length, 2)
  assert.ok(
    confirmadas.every(
      (t) =>
        t.estado_sync === 'SINCRONIZADO' &&
        t.fecha_asignacion === '2026-10-28T18:37:03Z' &&
        t.cosechador_dni === DNI
    )
  )
  assert.deepEqual(await local.obtenerAsignacionesTickets('D'), [])
})

test('después del corte Application crea registros y reservas Harvest; aliases legacy no pueden escribir', async () => {
  await cache(politica)
  const a = await asignar(),
    r = await registrar()
  assert.equal(a.operacion.modelo, 'HARVEST')
  assert.equal(r.operacion.modelo, 'HARVEST')
  assert.deepEqual(r.operacion.dependencias, [a.operacion.id])
  await assert.rejects(registrar(), TicketYaUtilizado)
  await assert.rejects(
    local.guardarAsignacionOffline({
      codigoTicket: 'T2',
      cosechadorDni: DNI,
      dniOperador: OP
    }),
    EscrituraLegacyRetirada
  )
  assert.equal((await filas('cola')).length, 2)
})

test('una política confirmada sobrevive snapshots tardíos y nuevas conexiones; otra campaña permanece aislada', async () => {
  await cache(politica)
  await cache(null)
  await cache(undefined)
  await local.guardarSnapshotHarvest(
    snapshotHarvest({ campaniaId: 'D', cutover: null })
  )
  assert.equal(await local.obtenerModeloOperativoHarvest('C'), 'HARVEST')
  assert.equal(await local.obtenerModeloOperativoHarvest('D'), 'LEGACY')
  const meta = (await filas('meta')).find((m) => m.cutover?.campaniaId === 'C')
  assert.deepEqual(meta.cutover, politica)
  const antes = await filas('meta')
  await assert.rejects(
    cache({ ...politica, activadoEn: '2026-10-15T12:00:00Z' }),
    /inmutable/
  )
  assert.deepEqual(await filas('meta'), antes)
})

test('el corte entre selección de modelo y escritura legacy aborta la intención sin cambiar payloads previos', async () => {
  await cache(null)
  const a = await asignar(),
    r = await registrar()
  const previas = await filas('cola')
  await cache(politica)
  await assert.rejects(
    local.guardarAsignacionOffline({
      codigoTicket: 'T2',
      cosechadorDni: DNI,
      dniOperador: OP,
      modeloSolicitado: 'LEGACY'
    }),
    EscrituraLegacyRetirada
  )
  assert.deepEqual(await filas('cola'), previas)
  assert.equal((await filas('lecturas'))[0].revision_corte, true)
  assert.equal(await local.contarLecturasSesion('S'), 0)
  assert.equal(a.operacion.modelo, 'LEGACY')
  assert.equal(r.operacion.modelo, 'LEGACY')
})

test('ACK piloto confirma consumo pero lo excluye de producción local, y la versión confirmada es inmutable', async () => {
  await local.guardarSnapshotHarvest(snapshotHarvest({ asignacion }))
  const { operacion: op } = await local.reservarConsumoHarvest({
    codigoTicket: 'T1',
    dniOperador: OP,
    campaniaId: 'C',
    sesionId: 'S',
    registroId: crypto.randomUUID(),
    fechaHora: '2026-10-14T11:59:59Z'
  })
  await local.guardarSnapshotHarvest(snapshotHarvest({ asignacion, cutover: politica }))
  const lote = new LoteDeTickets({ id: 'LT', campaniaId: 'C' })
  lote.asignar(asignacion)
  const ticket = new Ticket({ codigo: 'T1', loteId: 'LT' })
  const registro = ticket.registrarCosecha({
    lote,
    id: op.payload.lecturaId,
    sesionId: 'S',
    operacionId: op.id,
    fechaHora: op.payload.fechaHora,
    versionProduccion: null
  })
  await local.confirmarOperacionHarvest(op, { lote, ticket, registro })
  assert.equal(await local.contarLecturasSesion('S'), 0)
  assert.equal((await filas('lecturas'))[0].estado_sync, 'SINCRONIZADO')
  assert.equal((await local.obtenerEstadoHarvest('T1')).estadoServidor, 'UTILIZADO')
  const r = { ...registro }
  delete r.versionProduccion
  await local.guardarSnapshotHarvest(
    snapshotHarvest({ asignacion, cutover: politica, registros: [r] })
  )
  assert.equal((await filas('harvestRegistros'))[0].versionProduccion, null)
  await assert.rejects(
    local.guardarSnapshotHarvest(
      snapshotHarvest({
        asignacion,
        cutover: politica,
        registros: [{ ...registro, versionProduccion: 1 }]
      })
    ),
    /inmutable/
  )
})

test('un recibo legacy anterior restaura el conteo; un rechazo conserva la intención y bloquea dependientes', async () => {
  await cache(null)
  const a = await asignar(),
    r = await registrar()
  await local.confirmarOperacionHarvest(a.operacion, {
    legacy: true,
    resultado: { ok: true }
  })
  await cache(politica)
  assert.equal(await local.contarLecturasSesion('S'), 0)
  await local.confirmarOperacionHarvest(r.operacion, {
    legacy: true,
    resultado: { ok: true }
  })
  assert.equal(await local.contarLecturasSesion('S'), 1)
  assert.equal((await filas('lecturas'))[0].revision_corte, false)
  assert.deepEqual(
    (await filas('cola')).find((o) => o.id === r.operacion.id).payload,
    r.operacion.payload
  )
})

test('snapshot F5.6 corrige un ACK piloto confirmado por un cliente anterior sin metadatos productivos', async () => {
  await local.guardarSnapshotHarvest(snapshotHarvest({ asignacion }))
  const { operacion: op } = await local.reservarConsumoHarvest({
    codigoTicket: 'T1',
    dniOperador: OP,
    campaniaId: 'C',
    sesionId: 'S',
    registroId: crypto.randomUUID(),
    fechaHora: '2026-10-14T11:59:59Z'
  })
  const lote = new LoteDeTickets({ id: 'LT', campaniaId: 'C' })
  lote.asignar(asignacion)
  const ticket = new Ticket({ codigo: 'T1', loteId: 'LT' })
  const registro = ticket.registrarCosecha({
    lote,
    id: op.payload.lecturaId,
    sesionId: 'S',
    operacionId: op.id,
    fechaHora: op.payload.fechaHora
  })
  await local.confirmarOperacionHarvest(op, { lote, ticket, registro })
  assert.equal(await local.contarLecturasSesion('S'), 1)
  await local.guardarSnapshotHarvest(
    snapshotHarvest({
      asignacion,
      cutover: politica,
      registros: [{ ...registro, versionProduccion: null }]
    })
  )
  assert.equal(await local.contarLecturasSesion('S'), 0)
  assert.equal((await local.obtenerEstadoHarvest('T1')).estadoServidor, 'UTILIZADO')
})

test('asignación legacy pendiente rechazada por corte invalida sus consumos y prohíbe reintento automático', async () => {
  await cache(null)
  const a = await asignar(),
    r = await registrar()
  await cache(politica)
  await local.rechazarOperacionHarvest(a.operacion, new EscrituraLegacyRetirada())
  const cola = await filas('cola')
  assert.equal(cola.find((o) => o.id === a.operacion.id).retiradaPorCutover, true)
  assert.equal(cola.find((o) => o.id === r.operacion.id).bloqueadaPorDependencia, true)
  assert.equal(await local.reintentarOperacion(a.operacion.id), false)
  assert.equal(await local.reintentarOperacion(r.operacion.id), false)
  assert.equal(await local.contarLecturasSesion('S'), 0)
  assert.equal((await filas('lecturas')).length, 1)
})
