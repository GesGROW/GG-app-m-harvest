import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { documentoVista } from './helpers/elementoVista.js'
import { crearNavegacionPrincipal } from '../src/presentation/arranque/navegacion.js'
import { crearTecladosManuales } from '../src/presentation/arranque/teclados.js'
import { configurarEventosCampo } from '../src/presentation/arranque/eventos.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const turno = () => new Promise((resolve) => setImmediate(resolve))

function eventos() {
  const handlers = new Map()
  return {
    handlers,
    addEventListener(tipo, callback, captura) {
      assert.equal(handlers.has(tipo), false, `Listener duplicado: ${tipo}`)
      handlers.set(tipo, { callback, captura })
    },
    emitir: (tipo, ...args) => handlers.get(tipo).callback(...args)
  }
}
function arranque() {
  const window = { ...eventos(), navigator: { onLine: true } }
  const document = { ...eventos(), hidden: false }
  const registro = [],
    errores = [],
    intervalos = []
  const estado = { operador: {}, vigente: true }
  configurarEventosCampo({
    window,
    document,
    temporizadores: { setInterval: (fn, ms) => intervalos.push({ fn, ms }) },
    obtenerOperador: () => estado.operador,
    verificarVigenciaOperador: () => {
      registro.push('vigencia')
      return estado.vigente
    },
    sincronizar: async () => {
      registro.push('sync')
      if (estado.error) throw estado.error
    },
    actualizarEstadoConexion: async () => registro.push('estado'),
    registrarInfo: () => {},
    registrarError: (...args) => errores.push(args)
  })
  return { window, document, registro, estado, errores, intervalos }
}

test('foco y temporizador sincronizan en línea y actualizan el indicador', async () => {
  const campo = arranque()
  assert.equal(campo.intervalos.length, 1)
  assert.equal(campo.intervalos[0].ms, 30000)
  await campo.window.emitir('focus')
  await campo.intervalos[0].fn()
  assert.deepEqual(campo.registro, [
    'vigencia',
    'sync',
    'estado',
    'vigencia',
    'sync',
    'estado'
  ])
})

test('el temporizador sin conexión no envía operaciones', async () => {
  const campo = arranque()
  campo.window.navigator.onLine = false
  await campo.intervalos[0].fn()
  assert.deepEqual(campo.registro, ['vigencia'])
})

test('recuperar conexión refresca el indicador incluso si falla sincronizar', async () => {
  const campo = arranque()
  campo.estado.error = new Error('Sin red')
  await campo.window.emitir('online')
  assert.deepEqual(campo.registro, ['vigencia', 'sync', 'estado'])
  assert.equal(campo.errores[0][1], campo.estado.error)
})

test('sin conexión actualiza solamente el indicador', async () => {
  const campo = arranque()
  await campo.window.emitir('offline')
  assert.deepEqual(campo.registro, ['estado'])
})

test('la autorización vencida bloquea foco, conexión y temporizador', async () => {
  const campo = arranque()
  campo.estado.vigente = false
  await campo.window.emitir('focus')
  await campo.window.emitir('online')
  await campo.intervalos[0].fn()
  assert.deepEqual(campo.registro, ['vigencia', 'vigencia', 'vigencia'])
})

test('al volver a la pestaña comprueba vigencia; oculta o sin operador no consulta', () => {
  const campo = arranque()
  campo.document.emitir('visibilitychange')
  campo.document.hidden = true
  campo.document.emitir('visibilitychange')
  campo.document.hidden = false
  campo.estado.operador = null
  campo.document.emitir('visibilitychange')
  assert.deepEqual(campo.registro, ['vigencia'])
})

test('la captura detiene un clic vencido y permite el formulario de ingreso sin operador', () => {
  const campo = arranque()
  let bloqueos = 0
  const clic = {
    preventDefault: () => bloqueos++,
    stopImmediatePropagation: () => bloqueos++
  }
  assert.equal(campo.document.handlers.get('click').captura, true)
  campo.estado.vigente = false
  campo.document.emitir('click', clic)
  assert.equal(bloqueos, 2)
  campo.estado.operador = null
  campo.document.emitir('click', clic)
  assert.equal(bloqueos, 2)
})

function navegacion(opciones = {}) {
  const document = documentoVista(html)
  const nodo = (id) => document.querySelector(`#${id}`)
  const cambios = [],
    errores = []
  let actualizaciones = 0
  const controlador = crearNavegacionPrincipal({
    document,
    obtenerOperador: () => ({ nombre: 'Ana' }),
    autorizarVista: (v) => v,
    verificarVigenciaOperador: () => true,
    desactivarTecladoManual: () => cambios.push('teclado'),
    mostrarIngresoDispositivo: () => false,
    alCambiarVista: (vista) => cambios.push(vista),
    alMostrarMenu: async () => actualizaciones++,
    registrarError: (e) => errores.push(e),
    ...opciones
  })
  return { controlador, nodo, cambios, errores, actualizaciones: () => actualizaciones }
}

test('navegar oculta las otras pantallas y notifica a los flujos', async () => {
  const campo = navegacion()
  campo.controlador.mostrarMenu()
  assert.equal(campo.nodo('vista-menu').classList.contains('oculto'), false)
  assert.equal(campo.nodo('menu-operador').textContent, 'Ana')
  assert.equal(campo.actualizaciones(), 1)
  await campo.nodo('btn-menu-reportes').emitir('click')
  assert.equal(campo.nodo('vista-menu').classList.contains('oculto'), true)
  assert.equal(campo.nodo('vista-reportes').classList.contains('oculto'), false)
  assert.equal(campo.cambios.at(-2), 'teclado')
  assert.equal(campo.cambios.at(-1), campo.nodo('vista-reportes'))
})

test('el acceso del dispositivo puede ocupar la pantalla del login', () => {
  const campo = navegacion({ mostrarIngresoDispositivo: () => true })
  campo.controlador.mostrarVista(campo.nodo('vista-login'))
  assert.equal(campo.nodo('vista-login').classList.contains('oculto'), true)
})

test('un menú sin autorización no carga contadores ni sesiones', () => {
  const campo = navegacion({ verificarVigenciaOperador: () => false })
  campo.controlador.mostrarMenu()
  assert.equal(campo.actualizaciones(), 0)
  assert.equal(campo.cambios.length, 0)
})

test('un error al cargar el menú se registra sin rechazos pendientes', async () => {
  const error = new Error('Lectura fallida')
  const campo = navegacion({
    alMostrarMenu: async () => {
      throw error
    }
  })
  campo.controlador.mostrarMenu()
  await turno()
  assert.deepEqual(campo.errores, [error])
})

test('los seis teclados conservan su modo y se desactivan por campo o en conjunto', () => {
  const document = documentoVista(html)
  const campos = [
    'dni-operador',
    'dni-cosechador',
    'codigo-ticket',
    'dni-jabero',
    'dni-jabero-lectura',
    'ticket-lectura'
  ]
  const registro = [],
    apagados = []
  for (const id of campos)
    document.querySelector(`#${id}`).parentElement = document.createElement('div')
  const teclados = crearTecladosManuales({
    document,
    configurarTecladoManual(input, boton, modo) {
      registro.push([input.getAttribute('id'), modo])
      assert.ok(boton)
      return () => apagados.push(input.getAttribute('id'))
    }
  })
  assert.deepEqual(
    registro.map(([, modo]) => modo),
    ['numeric', 'numeric', 'text', 'numeric', 'numeric', 'text']
  )
  teclados.desactivar(document.querySelector('#codigo-ticket'))
  assert.deepEqual(apagados, ['codigo-ticket'])
  apagados.length = 0
  teclados.desactivar()
  assert.deepEqual(apagados, campos)
})
