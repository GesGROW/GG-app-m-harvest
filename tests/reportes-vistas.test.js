import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { crearConsultasReportes } from '../src/application/crearConsultasReportes.js'
import { crearReportes } from '../src/presentation/reportes/index.js'
import { documentoVista } from './helpers/elementoVista.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const campania = { id: 'A', nombre: 'Campaña A', fecha_inicio: '2026-10-01' }
const respuestas = {
  resumen: {
    ok: true,
    campania,
    resumen: {
      total_jabas: 7,
      total_cosechadores: 1,
      total_lotes: 1,
      total_sesiones: 1,
      dias_con_produccion: 1
    }
  },
  ranking: {
    ok: true,
    campania: campania.nombre,
    ranking: [
      {
        posicion: 1,
        cosechador_dni: '12345678',
        cosechador: 'Ana Pérez',
        total_jabas: 7
      }
    ]
  },
  diaria: {
    ok: true,
    campania,
    produccion: [
      { fecha: '2026-10-30', total_jabas: 7, total_cosechadores: 1, total_sesiones: 1 }
    ]
  },
  lotes: {
    ok: true,
    campania,
    produccion: [
      {
        lote_id: 'L',
        lote_codigo: 'L-1',
        lote_nombre: 'Anterior',
        variedad: 'Hass',
        total_jabas: 7,
        total_cosechadores: 1,
        total_sesiones: 1
      }
    ]
  }
}
const metodos = {
  resumen: 'obtenerResumenCampania',
  ranking: 'obtenerRankingCosechadores',
  diaria: 'obtenerProduccionDiaria',
  lotes: 'obtenerProduccionLotes'
}

function preparar() {
  const document = documentoVista(html)
  const peticiones = []
  const navegacion = []
  const estado = { operador: { dni: '47480378', campania }, online: true, error: null }
  const consultas = crearConsultasReportes({
    obtenerOperador: () => estado.operador,
    consultas: Object.fromEntries(
      Object.entries(metodos).map(([nombre, metodo]) => [
        metodo,
        async (parametros) => {
          peticiones.push({ nombre, parametros })
          if (estado.error) throw estado.error
          return respuestas[nombre]
        }
      ])
    )
  })
  const reportes = crearReportes({
    document,
    mostrarVista: (vista) => navegacion.push(vista),
    mostrarMenu: () => navegacion.push('menu'),
    consultas,
    obtenerLotes: async () => [{ lote_id: 'L', nombre: 'Campo Norte' }],
    estaEnLinea: () => estado.online
  })
  const nodo = (id) => document.querySelector(`#${id}`)
  return { reportes, estado, peticiones, navegacion, nodo }
}

for (const [nombre, boton, vista, datos, feedback] of [
  [
    'resumen',
    'resumen',
    'resumen-campania',
    'resumen-total-jabas',
    'resumen-campania-feedback'
  ],
  [
    'ranking',
    'ranking',
    'ranking-cosechadores',
    'ranking-tabla-body',
    'ranking-feedback'
  ],
  [
    'diaria',
    'produccion',
    'produccion-diaria',
    'produccion-tabla-body',
    'produccion-feedback'
  ],
  ['lotes', 'lotes', 'produccion-lotes', 'lotes-lista', 'lotes-feedback']
]) {
  test(`${nombre}: abre, consulta la campaña activa, actualiza y vuelve al menú de reportes`, async () => {
    const v = preparar()
    await v.nodo(`btn-reporte-${boton}`).emitir('click')
    assert.equal(v.navegacion.at(-1), v.nodo(`vista-${vista}`))
    assert.equal(v.peticiones.length, 1)
    const { parametros } = v.peticiones[0]
    assert.equal(parametros.campaniaId, 'A')
    assert.equal(parametros.dniOperador, '47480378')
    if (nombre === 'ranking') assert.equal(parametros.periodo, 'HOY')
    if (['resumen', 'diaria'].includes(nombre)) assert.ok(parametros.zonaHoraria)
    assert.equal(
      v.nodo(datos)[nombre === 'resumen' ? 'textContent' : 'children'].length > 0,
      true
    )
    await v.nodo(`btn-actualizar-${boton}`).emitir('click')
    assert.equal(v.peticiones.length, 2)
    await v.nodo(`btn-volver-${boton}`).emitir('click')
    assert.equal(v.navegacion.at(-1), v.nodo('vista-reportes'))
    await v.nodo('btn-volver-reportes').emitir('click')
    assert.equal(v.navegacion.at(-1), 'menu')
  })

  test(`${nombre}: actualizar offline conserva los datos y un fallo remoto permite reintentar`, async () => {
    const v = preparar()
    await v.nodo(`btn-reporte-${boton}`).emitir('click')
    const antes = v.nodo(datos)[nombre === 'resumen' ? 'textContent' : 'children']
    v.estado.online = false
    await v.nodo(`btn-actualizar-${boton}`).emitir('click')
    assert.equal(v.peticiones.length, 1)
    assert.equal(
      v.nodo(datos)[nombre === 'resumen' ? 'textContent' : 'children'],
      antes
    )
    assert.match(v.nodo(feedback).textContent, /sin conexión/)
    assert.equal(v.nodo(`btn-actualizar-${boton}`).disabled, false)
    v.estado.online = true
    v.estado.error = new Error('Respuesta no disponible')
    await v.nodo(`btn-actualizar-${boton}`).emitir('click')
    assert.match(v.nodo(feedback).textContent, /Respuesta no disponible/)
    assert.equal(
      v.nodo(datos)[nombre === 'resumen' ? 'textContent' : 'children'],
      antes
    )
    v.estado.error = null
    await v
      .nodo(nombre === 'ranking' ? 'btn-actualizar-ranking' : `btn-reintentar-${boton}`)
      .emitir('click')
    assert.equal(v.nodo(feedback).classList.contains('oculto'), true)
  })
}

test('ranking aplica búsqueda local y consulta de nuevo al cambiar de período', async () => {
  const v = preparar()
  await v.nodo('btn-reporte-ranking').emitir('click')
  v.nodo('ranking-busqueda').value = 'no existe'
  await v.nodo('ranking-busqueda').emitir('input')
  assert.equal(v.nodo('ranking-tabla-body').children.length, 0)
  assert.equal(v.peticiones.length, 1)
  v.nodo('ranking-busqueda').value = 'ana'
  await v.nodo('ranking-busqueda').emitir('input')
  assert.equal(v.nodo('ranking-tabla-body').children.length, 1)
  v.nodo('ranking-periodo').value = 'SEMANA'
  await v.nodo('ranking-periodo').emitir('change')
  // El evento inicia una tarea asíncrona; esperar su actualización de vista.
  await new Promise(setImmediate)
  assert.equal(v.peticiones.at(-1).parametros.periodo, 'SEMANA')
  assert.equal(v.nodo('ranking-periodo').disabled, false)
})

test('reiniciar al entrar a otra campaña no reutiliza datos anteriores sin conexión', async () => {
  const v = preparar()
  for (const nombre of ['resumen', 'produccion', 'lotes', 'ranking'])
    await v.nodo(`btn-reporte-${nombre}`).emitir('click')
  v.estado.operador = { dni: '80000001', campania: { id: 'B', nombre: 'Campaña B' } }
  v.reportes.reiniciar()
  v.estado.online = false
  for (const nombre of ['resumen', 'produccion', 'lotes', 'ranking'])
    await v.nodo(`btn-reporte-${nombre}`).emitir('click')
  assert.equal(v.nodo('resumen-campania-contenido').classList.contains('oculto'), true)
  for (const id of ['produccion-tabla-body', 'lotes-lista', 'ranking-tabla-body'])
    assert.equal(v.nodo(id).children.length, 0)
  assert.equal(v.peticiones.length, 4)
  v.estado.online = true
  await v.nodo('btn-actualizar-produccion').emitir('click')
  assert.equal(v.peticiones.at(-1).parametros.campaniaId, 'B')
  assert.equal(v.peticiones.at(-1).parametros.dniOperador, '80000001')
})

test('la consulta rechaza una respuesta tardía si cambió la campaña o se cerró sesión', async () => {
  for (const siguiente of [null, { dni: '47480378', campania: { id: 'B' } }]) {
    let operador = { dni: '47480378', campania }
    let resolver
    const consultas = crearConsultasReportes({
      obtenerOperador: () => operador,
      consultas: {
        obtenerProduccionLotes: () =>
          new Promise((resolve) => {
            resolver = resolve
          })
      }
    })
    const pendiente = consultas.lotes()
    operador = siguiente
    resolver(respuestas.lotes)
    await assert.rejects(pendiente, /campaña de trabajo cambió/)
  }
})

test('sin campaña seleccionada no se envía ninguna consulta', async () => {
  let llamadas = 0
  const consultas = crearConsultasReportes({
    obtenerOperador: () => null,
    consultas: {
      obtenerProduccionLotes: () => {
        llamadas++
      }
    }
  })
  await assert.rejects(consultas.lotes(), /seleccionar su campaña/)
  assert.equal(llamadas, 0)
})
