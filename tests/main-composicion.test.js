import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/index.js'
import { documentoVista } from './helpers/elementoVista.js'

test('main compone los módulos reales y restaura el menú después de inicializarlos', async () => {
  const fuente = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const document = documentoVista(
    readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  )
  document.addEventListener = () => {}
  const almacen = new Map([
    ['operador_dni', '01748037'],
    ['campania_id', 'A']
  ])
  const operador = {
    dni: '01748037',
    nombre: 'Ana',
    autorizado_para_fecha: fechaOperativa(),
    campanias: [{ id: 'A' }]
  }
  const scanners = [],
    intervalos = [],
    errores = []
  for (const id of [
    'dni-operador',
    'dni-cosechador',
    'codigo-ticket',
    'dni-jabero',
    'dni-jabero-lectura',
    'ticket-lectura'
  ])
    document.querySelector(`#${id}`).parentElement = document.createElement('div')
  const contexto = {
    document,
    navigator: { onLine: true },
    window: { navigator: { onLine: true }, addEventListener() {} },
    sessionStorage: {
      getItem: (k) => almacen.get(k),
      setItem: (k, v) => almacen.set(k, v),
      removeItem: (k) => almacen.delete(k)
    },
    setInterval: (fn, ms) => intervalos.push({ fn, ms }),
    console: { error: (...args) => errores.push(args), log() {} },
    enhanceNativeSelects() {},
    configurarTecladoManual: () => () => {},
    configurarScanner: (form) => scanners.push(form),
    mostrarIngresoDispositivo: () => false,
    cerrarSesionDispositivo: async () => {},
    backend: {},
    casosDeUso: {
      validarOperador: async () => operador,
      ingresarCampania: async ({ operador, campania }) => ({
        operador: { ...operador, campania },
        sincronizar: async () => false
      })
    },
    contarErrores: async () => 0,
    contarPendientes: async () => 0,
    sincronizarPendientes: async () => {},
    evaluarDescarteOperacion() {},
    buscarCosechador() {},
    actualizarCacheOperativa() {},
    seleccionarCampaniaLocal: async () => {}
  }
  for (const [, lecturas] of fuente.matchAll(
    /import\s*\{([^}]+)\}\s*from '\.\/offline\/db'/g
  ))
    for (const nombre of lecturas.split(',').map((s) => s.trim()))
      contexto[nombre] ??= async () => []
  // Cargar las fábricas de producción; solo los puertos técnicos son simulados.
  const modulos = [
    ...fuente.matchAll(
      /from '(\.\/(?:presentation\/|application\/crearConsultas)[^']+)'/g
    )
  ]
  for (const [, ruta] of modulos)
    Object.assign(
      contexto,
      await import(new URL(`../src/${ruta.slice(2)}`, import.meta.url))
    )
  const configurarEventos = contexto.configurarEventosCampo
  contexto.configurarEventosCampo = (deps) =>
    configurarEventos({ ...deps, temporizadores: contexto })
  const composicion = fuente.replace(
    /^import\s+(?:'[^']+'|[\s\S]*?\sfrom\s+'[^']+')\s*$/gm,
    ''
  )
  assert.doesNotMatch(composicion, /\bimport\b/)
  runInNewContext(
    composicion.replace(
      'ingreso.restaurar()',
      'globalThis.restauracion = ingreso.restaurar()'
    ),
    contexto
  )
  await contexto.restauracion
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    document.querySelector('#vista-menu').classList.contains('oculto'),
    false
  )
  assert.equal(document.querySelector('#menu-operador').textContent, 'Ana')
  assert.equal(almacen.get('campania_id'), 'A')
  assert.equal(scanners.length, 6)
  assert.deepEqual(
    intervalos.map(({ ms }) => ms),
    [30000]
  )
  assert.deepEqual(errores, [])
})
