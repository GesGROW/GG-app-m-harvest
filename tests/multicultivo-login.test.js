import { ingresoCampo } from './helpers/ingresoCampo.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolverCampaniaOperador } from '@gesgrow/core/contexts/campaign-management/domain/campaniaOperador.js'
import { parametrosCampania } from '../src/infrastructure/supabase/campania.js'

const A = { id: 'A', cultivo_nombre: 'Arándanos', nombre: 'Arándanos 2026' }
const B = { id: 'B', cultivo_nombre: 'Mandarina', nombre: 'Mandarina 2026' }
function login(opciones, { offline = false, disponibles = ['A', 'B'] } = {}) {
  const campo = ingresoCampo({
    operador: { dni: '47480378', campanias: opciones, offline },
    navigator: { onLine: !offline },
    obtenerCacheCampania: async (id) => (disponibles.includes(id) ? { id } : null)
  })
  return {
    ...campo,
    opcionesCultivo: campo.nodo('opciones-cultivo')
  }
}
test('una sola campaña entra directamente y carga únicamente su caché', async () => {
  const vista = login([A])
  await vista.enviar()
  assert.deepEqual(vista.menus, ['A'])
  assert.deepEqual(vista.consultas, [
    ['seleccion', 'A'],
    ['cache', '47480378', 'A']
  ])
  assert.equal(vista.storage.get('campania_id'), 'A')
})
test('varias campañas solicitan cultivo y no cargan datos hasta elegirlo', async () => {
  const vista = login([A, B])
  await vista.enviar()
  assert.deepEqual(vista.menus, [])
  assert.deepEqual(vista.consultas, [['vista', 'vista-cultivos']])
  assert.equal(vista.opcionesCultivo.children.length, 2)
  assert.match(vista.opcionesCultivo.children[1].textContent, /Mandarina/)
  await vista.opcionesCultivo.children[1].emitir('click')
  assert.deepEqual(vista.menus, ['B'])
  assert.equal(vista.storage.get('campania_id'), 'B')
})
test('restaurar mantiene la campaña elegida y vuelve a preguntar si esa asignación desapareció', async () => {
  const restaurado = login([A, B])
  await restaurado.restaurar('B')
  assert.deepEqual(restaurado.menus, ['B'])
  const revocado = login([A, B])
  await revocado.restaurar('C')
  assert.deepEqual(revocado.menus, [])
  assert.equal(revocado.opcionesCultivo.children.length, 2)
})
test('offline permite una campaña previamente cargada y explica si aún falta su caché', async () => {
  const vista = login([A, B], { offline: true, disponibles: ['A'] })
  await vista.enviar()
  await vista.opcionesCultivo.children[1].emitir('click')
  assert.deepEqual(vista.menus, [])
  assert.match(
    vista.nodo('cultivo-mensaje').textContent,
    /no está disponible sin conexión/
  )
  await vista.opcionesCultivo.children[0].emitir('click')
  assert.deepEqual(vista.menus, ['A'])
  assert.equal(
    vista.consultas.some((item) => item[0] === 'cache'),
    false
  )
})

test('cancelar durante la carga no restaura el ingreso desde una respuesta tardía', async () => {
  const vista = login([A, B])
  let completarCache
  vista.fuentes.actualizarCacheOperativa = () =>
    new Promise((resolve) => {
      completarCache = resolve
    })
  await vista.enviar()
  const ingreso = vista.opcionesCultivo.children[1].emitir('click')
  // Dejar que el ingreso alcance su consulta antes de volver a la pantalla DNI.
  await new Promise((resolve) => setImmediate(resolve))
  await vista.nodo('btn-cancelar-cultivo').emitir('click')
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
