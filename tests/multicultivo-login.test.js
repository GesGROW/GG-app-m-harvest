import { casosDeUsoParaVista } from './helpers/casosDeUso.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { resolverCampaniaOperador } from '@gesgrow/core/contexts/campaign-management/domain/campaniaOperador.js'
import { parametrosCampania } from '../src/infrastructure/supabase/campania.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const node = () => ({
  children: [],
  listeners: {},
  disabled: false,
  replaceChildren() {
    this.children = []
  },
  appendChild(child) {
    this.children.push(child)
  },
  addEventListener(name, handler) {
    this.listeners[name] = handler
  }
})
const A = { id: 'A', cultivo_nombre: 'Arándanos', nombre: 'Arándanos 2026' }
const B = { id: 'B', cultivo_nombre: 'Mandarina', nombre: 'Mandarina 2026' }
function login(opciones, { offline = false, disponibles = ['A', 'B'] } = {}) {
  const consultas = []
  const menus = []
  const storage = new Map()
  const opcionesCultivo = node()
  const ctx = vm.createContext({
    operador: { dni: '47480378', campanias: opciones, offline },
    resolverCampaniaOperador,
    opcionesCultivo,
    cultivoMensaje: { textContent: '' },
    vistaCultivos: { id: 'cultivos' },
    document: { createElement: node, querySelector: node },
    cerrarSesion() {},
    seleccionarCampaniaLocal: async (id) => consultas.push(['seleccion', id]),
    obtenerCacheCampania: async (id) => (disponibles.includes(id) ? { id } : null),
    actualizarCacheOperativa: async (dni, id) => consultas.push(['cache', dni, id]),
    mostrarVista: (vista) => consultas.push(['vista', vista.id]),
    mostrarMenu: () => menus.push(ctx.operador.campania.id),
    sessionStorage: { setItem: (key, value) => storage.set(key, value) },
    navigator: { onLine: !offline },
    sincronizarPendientes: async () => {},
    actualizarEstadoConexion() {},
    console,
    esErrorTemporal: () => false,
    sesionLectura: null,
    cosechador: null,
    resumenCampaniaActual: null,
    produccionLotesActual: [],
    produccionDiariaActual: [],
    rankingCosechadoresActual: []
  })
  ctx.casosDeUso = casosDeUsoParaVista(ctx)
  vm.runInContext(
    main.slice(
      main.indexOf('async function prepararIngreso('),
      main.indexOf('// LOGIN')
    ),
    ctx
  )
  return { ctx, consultas, menus, storage, opcionesCultivo }
}
test('una sola campaña entra directamente y carga únicamente su caché', async () => {
  const vista = login([A])
  await vista.ctx.prepararIngreso()
  assert.deepEqual(vista.menus, ['A'])
  assert.deepEqual(vista.consultas, [
    ['seleccion', 'A'],
    ['cache', '47480378', 'A']
  ])
  assert.equal(vista.storage.get('campania_id'), 'A')
})
test('varias campañas solicitan cultivo y no cargan datos hasta elegirlo', async () => {
  const vista = login([A, B])
  await vista.ctx.prepararIngreso()
  assert.deepEqual(vista.menus, [])
  assert.deepEqual(vista.consultas, [['vista', 'cultivos']])
  assert.equal(vista.opcionesCultivo.children.length, 2)
  assert.match(vista.opcionesCultivo.children[1].textContent, /Mandarina/)
  await vista.opcionesCultivo.children[1].listeners.click()
  assert.deepEqual(vista.menus, ['B'])
  assert.equal(vista.storage.get('campania_id'), 'B')
})
test('restaurar mantiene la campaña elegida y vuelve a preguntar si esa asignación desapareció', async () => {
  const restaurado = login([A, B])
  await restaurado.ctx.prepararIngreso('B')
  assert.deepEqual(restaurado.menus, ['B'])
  const revocado = login([A, B])
  await revocado.ctx.prepararIngreso('C')
  assert.deepEqual(revocado.menus, [])
  assert.equal(revocado.opcionesCultivo.children.length, 2)
})
test('offline permite una campaña previamente cargada y explica si aún falta su caché', async () => {
  const vista = login([A, B], { offline: true, disponibles: ['A'] })
  await vista.ctx.prepararIngreso()
  await vista.opcionesCultivo.children[1].listeners.click()
  assert.deepEqual(vista.menus, [])
  assert.match(vista.ctx.cultivoMensaje.textContent, /no está disponible sin conexión/)
  await vista.opcionesCultivo.children[0].listeners.click()
  assert.deepEqual(vista.menus, ['A'])
  assert.equal(
    vista.consultas.some((item) => item[0] === 'cache'),
    false
  )
})

test('cancelar durante la carga no restaura el ingreso desde una respuesta tardía', async () => {
  const vista = login([A, B])
  let completarCache
  vista.ctx.actualizarCacheOperativa = () =>
    new Promise((resolve) => {
      completarCache = resolve
    })
  await vista.ctx.prepararIngreso()
  const ingreso = vista.opcionesCultivo.children[1].listeners.click()
  // Dejar que el ingreso alcance su consulta antes de volver a la pantalla DNI.
  await new Promise((resolve) => setImmediate(resolve))
  vista.ctx.operador = null
  completarCache()
  await ingreso
  assert.deepEqual(vista.menus, [])
  assert.equal(vista.storage.has('campania_id'), false)
})
test('las peticiones incluyen el UUID de campaña y no aceptan una opción ajena al operador', () => {
  assert.throws(
    () => resolverCampaniaOperador({ campanias: [A] }, 'B'),
    /ya no está asignada/
  )
  assert.throws(() => resolverCampaniaOperador({ campanias: [] }), /No tiene campañas/)
  assert.deepEqual(
    parametrosCampania('B', 'obtener_produccion_lotes', { p_dni_operador: '47480378' }),
    [
      'obtener_produccion_lotes_campania',
      { p_dni_operador: '47480378', p_campania_id: 'B' }
    ]
  )
})
