import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'

import {
  contarLecturasSesion,
  guardarCache,
  guardarLecturaLocal,
  marcarLecturaSincronizada,
  obtenerLecturasSesion,
  obtenerTrabajadores
} from '../src/offline/db.js'
import {
  ORDEN_COSECHADORES_JABAS,
  agruparLecturasPorCosechador,
  buscarCosechadoresJabas,
  ordenarCosechadoresJabas,
  resumirCosechadoresJabas
} from '@gesgrow/core/contexts/harvest/application/queries/cosechadoresJabas.js'

function lectura({
  id,
  sesion = 'sesion-prueba',
  ticket = 'TICKET-1',
  dni = '81000001',
  nombre = 'Juan Pérez',
  fecha = '2026-09-30T14:00:00.000Z',
  estado = 'PENDIENTE'
}) {
  return {
    id,
    sesion_id: sesion,
    codigo_ticket: ticket,
    cosechador_dni: dni,
    cosechador: nombre,
    fecha_hora: fecha,
    estado_sync: estado
  }
}

test('una lectura genera 1 jaba', () => {
  const grupos = agruparLecturasPorCosechador([lectura({ id: 'cj-1' })])
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].jabas, 1)
})

test('tres lecturas del mismo ticket generan 3 jabas', () => {
  const lecturas = [1, 2, 3].map((numero) =>
    lectura({ id: `cj-ticket-${numero}`, ticket: 'REPETIDO-001' })
  )
  assert.equal(agruparLecturasPorCosechador(lecturas)[0].jabas, 3)
})

test('lecturas del mismo cosechador se agrupan', () => {
  const grupos = agruparLecturasPorCosechador([
    lectura({ id: 'cj-mismo-1' }),
    lectura({ id: 'cj-mismo-2', ticket: 'TICKET-2' })
  ])
  assert.equal(grupos.length, 1)
  assert.equal(grupos[0].jabas, 2)
})

test('lecturas de dos cosechadores generan dos grupos', () => {
  const grupos = agruparLecturasPorCosechador([
    lectura({ id: 'cj-dos-1', dni: '81000001', nombre: 'Ana' }),
    lectura({ id: 'cj-dos-2', dni: '81000002', nombre: 'Luis' })
  ])
  assert.equal(grupos.length, 2)
})

test('solo se obtienen lecturas de la sesión indicada', async () => {
  await guardarLecturaLocal(
    lectura({ id: 'cj-sesion-a-1', sesion: 'cj-sesion-a', dni: '81000011' })
  )
  await guardarLecturaLocal(
    lectura({ id: 'cj-sesion-b-1', sesion: 'cj-sesion-b', dni: '81000022' })
  )

  const lecturas = await obtenerLecturasSesion('cj-sesion-a')
  assert.equal(lecturas.length, 1)
  assert.equal(lecturas[0].sesion_id, 'cj-sesion-a')
})

test('total agrupado coincide con total de sesión', async () => {
  const sesion = 'cj-total-sesion'
  for (const numero of [1, 2, 3, 4]) {
    await guardarLecturaLocal(
      lectura({
        id: `cj-total-${numero}`,
        sesion,
        ticket: numero <= 2 ? 'MISMO-TICKET' : `TICKET-${numero}`,
        dni: numero <= 3 ? '81000001' : '81000002'
      })
    )
  }

  const grupos = agruparLecturasPorCosechador(await obtenerLecturasSesion(sesion))
  assert.equal(
    resumirCosechadoresJabas(grupos).jabas,
    await contarLecturasSesion(sesion)
  )
})

test('última lectura toma el fecha_hora válido más reciente', () => {
  const grupos = agruparLecturasPorCosechador([
    lectura({ id: 'cj-fecha-1', fecha: '2026-09-30T10:00:00.000Z' }),
    lectura({ id: 'cj-fecha-2', fecha: 'fecha-invalida' }),
    lectura({ id: 'cj-fecha-3', fecha: '2026-09-30T12:30:00.000Z' })
  ])
  assert.equal(grupos[0].ultimaLectura, '2026-09-30T12:30:00.000Z')
})

test('búsqueda por nombre ignora mayúsculas y espacios repetidos', () => {
  const grupos = [{ dni: '81000001', nombre: 'Ana María López', jabas: 1 }]
  assert.equal(buscarCosechadoresJabas(grupos, '  ANA   MARÍA ').length, 1)
})

test('búsqueda por DNI encuentra al cosechador', () => {
  const grupos = [{ dni: '81000001', nombre: 'Ana López', jabas: 1 }]
  assert.equal(buscarCosechadoresJabas(grupos, '81000001').length, 1)
})

test('orden Más jabas usa cantidad, recencia y nombre', () => {
  const grupos = [
    { dni: '3', nombre: 'Carlos', jabas: 2, ultimaLectura: '2026-09-30T12:00:00Z' },
    { dni: '2', nombre: 'Bruno', jabas: 2, ultimaLectura: '2026-09-30T13:00:00Z' },
    { dni: '1', nombre: 'Ana', jabas: 3, ultimaLectura: '2026-09-30T11:00:00Z' }
  ]
  assert.deepEqual(
    ordenarCosechadoresJabas(grupos, ORDEN_COSECHADORES_JABAS.MAS_JABAS).map(
      (grupo) => grupo.nombre
    ),
    ['Ana', 'Bruno', 'Carlos']
  )
})

test('orden Recientes usa última lectura y nombre', () => {
  const grupos = [
    { dni: '2', nombre: 'Bruno', jabas: 1, ultimaLectura: '2026-09-30T12:00:00Z' },
    { dni: '1', nombre: 'Ana', jabas: 5, ultimaLectura: '2026-09-30T13:00:00Z' }
  ]
  assert.deepEqual(
    ordenarCosechadoresJabas(grupos, ORDEN_COSECHADORES_JABAS.RECIENTES).map(
      (grupo) => grupo.nombre
    ),
    ['Ana', 'Bruno']
  )
})

test('orden A–Z usa nombre y DNI', () => {
  const grupos = [
    { dni: '81000003', nombre: 'Bruno', jabas: 1 },
    { dni: '81000002', nombre: 'Ana', jabas: 1 },
    { dni: '81000001', nombre: 'Ana', jabas: 1 }
  ]
  assert.deepEqual(
    ordenarCosechadoresJabas(grupos, ORDEN_COSECHADORES_JABAS.AZ).map(
      (grupo) => grupo.dni
    ),
    ['81000001', '81000002', '81000003']
  )
})

test('cerrar y reabrir una conexión IndexedDB conserva los conteos', async () => {
  const sesion = 'cj-reapertura'
  await guardarLecturaLocal(lectura({ id: 'cj-reapertura-1', sesion }))
  await guardarLecturaLocal(lectura({ id: 'cj-reapertura-2', sesion }))

  const primera = await openDB('scc', 5)
  assert.equal(await primera.countFromIndex('lecturas', 'sesion_id', sesion), 2)
  primera.close()

  const reabierta = await openDB('scc', 5)
  assert.equal(await reabierta.countFromIndex('lecturas', 'sesion_id', sesion), 2)
  reabierta.close()
})

test('sincronizar una lectura no duplica ni cambia el total', async () => {
  const sesion = 'cj-sync'
  const id = 'cj-sync-1'
  await guardarLecturaLocal(lectura({ id, sesion }))
  const antes = await contarLecturasSesion(sesion)

  await marcarLecturaSincronizada(id)

  const lecturas = await obtenerLecturasSesion(sesion)
  assert.equal(await contarLecturasSesion(sesion), antes)
  assert.equal(lecturas.length, 1)
  assert.equal(lecturas[0].estado_sync, 'SINCRONIZADO')
})

test('sesión sin lecturas devuelve estado vacío', async () => {
  const grupos = agruparLecturasPorCosechador(
    await obtenerLecturasSesion('cj-sesion-vacia')
  )
  assert.deepEqual(resumirCosechadoresJabas(grupos), {
    cosechadores: 0,
    jabas: 0
  })
})

test('lectura antigua sin nombre usa cache de trabajadores y luego DNI como fallback', async () => {
  await guardarCache({
    campania: 'campania-cj',
    sincronizado_en: '2026-09-30T14:00:00.000Z',
    trabajadores: [{ dni: '81000999', nombre: 'Rosa Torres', roles: [] }],
    lotes: [],
    tickets: []
  })
  const trabajadores = await obtenerTrabajadores()
  const conCache = agruparLecturasPorCosechador(
    [lectura({ id: 'cj-antigua-cache', dni: '81000999', nombre: null })],
    trabajadores
  )
  const sinCache = agruparLecturasPorCosechador([
    lectura({ id: 'cj-antigua-dni', dni: '81000888', nombre: null })
  ])

  assert.equal(conCache[0].nombre, 'Rosa Torres')
  assert.equal(sinCache[0].nombre, '81000888')
})
