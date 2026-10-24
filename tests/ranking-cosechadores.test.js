import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buscarRankingCosechadores,
  normalizarRankingCosechadores,
  obtenerRankingCosechadores,
  reemplazarRankingCosechadores,
  resumirRankingCosechadores
} from '@gesgrow/core/contexts/harvest/application/reports/rankingCosechadores.js'

const respuestaBase = {
  ok: true,
  campania: 'Campaña Arándanos 2026',
  ranking: [
    {
      posicion: 2,
      cosechador_dni: '81000002',
      cosechador: 'Ana López',
      total_jabas: 176,
      ultima_lectura: '2026-09-30T15:39:00.000Z'
    },
    {
      posicion: 1,
      cosechador_dni: '81000001',
      cosechador: 'Juan Pérez',
      total_jabas: 184,
      ultima_lectura: '2026-09-30T15:42:00.000Z'
    }
  ]
}

test('ordena el ranking por total de jabas descendente', () => {
  const resultado = normalizarRankingCosechadores(respuestaBase)
  assert.deepEqual(
    resultado.ranking.map((fila) => fila.total_jabas),
    [184, 176]
  )
})

test('conserva posiciones empatadas devueltas por DENSE_RANK', () => {
  const resultado = normalizarRankingCosechadores({
    ...respuestaBase,
    ranking: [
      { ...respuestaBase.ranking[0], posicion: 2, total_jabas: 176 },
      {
        ...respuestaBase.ranking[1],
        posicion: 2,
        total_jabas: 176,
        cosechador: 'Luis Torres',
        cosechador_dni: '81000003'
      }
    ]
  })

  assert.deepEqual(
    resultado.ranking.map((fila) => fila.posicion),
    [2, 2]
  )
})

test('busca por nombre ignorando mayúsculas y espacios', () => {
  const ranking = normalizarRankingCosechadores(respuestaBase).ranking
  assert.equal(buscarRankingCosechadores(ranking, '  ANA   LÓPEZ ').length, 1)
})

test('busca por DNI', () => {
  const ranking = normalizarRankingCosechadores(respuestaBase).ranking
  assert.equal(
    buscarRankingCosechadores(ranking, '81000001')[0].cosechador,
    'Juan Pérez'
  )
})

test('resume la cantidad de cosechadores', () => {
  const ranking = normalizarRankingCosechadores(respuestaBase).ranking
  assert.equal(resumirRankingCosechadores(ranking).cosechadores, 2)
})

test('resume el total de jabas', () => {
  const ranking = normalizarRankingCosechadores(respuestaBase).ranking
  assert.equal(resumirRankingCosechadores(ranking).jabas, 360)
})

test('un ranking vacío produce resumen vacío', () => {
  const resultado = normalizarRankingCosechadores({
    ok: true,
    campania: 'Campaña vacía',
    ranking: []
  })
  assert.deepEqual(resumirRankingCosechadores(resultado.ranking), {
    cosechadores: 0,
    jabas: 0
  })
})

test('normaliza tipos de la respuesta de la RPC', () => {
  const resultado = normalizarRankingCosechadores({
    ok: true,
    campania: ' Campaña 2026 ',
    ranking: [
      {
        posicion: '1',
        cosechador_dni: ' 81000001 ',
        cosechador: ' Juan Pérez ',
        total_jabas: '12',
        ultima_lectura: '2026-09-30T15:42:00Z'
      }
    ]
  })

  assert.deepEqual(resultado, {
    ok: true,
    campania: 'Campaña 2026',
    ranking: [
      {
        posicion: 1,
        cosechador_dni: '81000001',
        cosechador: 'Juan Pérez',
        total_jabas: 12,
        ultima_lectura: '2026-09-30T15:42:00Z'
      }
    ]
  })
})

test('propaga el error de la consulta', async () => {
  const consultar = async () => {
    throw new Error('RPC no disponible')
  }
  await assert.rejects(
    obtenerRankingCosechadores('12345678', consultar),
    /RPC no disponible/
  )
})

test('actualizar reemplaza el ranking y no duplica filas', () => {
  const actual = [{ cosechador_dni: '81000001', total_jabas: 10 }]
  const siguiente = [
    { cosechador_dni: '81000001', total_jabas: 11 },
    { cosechador_dni: '81000002', total_jabas: 4 }
  ]

  const reemplazado = reemplazarRankingCosechadores(actual, siguiente)
  assert.equal(reemplazado.length, 2)
  assert.deepEqual(reemplazado, siguiente)
  assert.notEqual(reemplazado, siguiente)
})
