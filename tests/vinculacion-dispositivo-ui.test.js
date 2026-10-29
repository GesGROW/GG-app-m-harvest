import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { configurarVinculacionDispositivo } from '../src/modules/vinculacionDispositivo.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
function nodo() {
  const clases = new Set(),
    eventos = new Map()
  return {
    value: '',
    textContent: '',
    disabled: false,
    classList: {
      add: (c) => clases.add(c),
      remove: (c) => clases.delete(c),
      contains: (c) => clases.has(c),
      toggle: (c, v) => (v ? clases.add(c) : clases.delete(c))
    },
    setAttribute() {},
    focus() {},
    blur() {},
    addEventListener: (e, f) => eventos.set(e, f),
    emitir: (e, datos = {}) => eventos.get(e)?.({ preventDefault() {}, ...datos })
  }
}
const turno = () => new Promise((r) => setTimeout(r, 70))
function preparar({ vinculado = false, fragmento = '', fallar = false } = {}) {
  const nodes = Object.fromEntries(
    [...html.matchAll(/id="(pda-[^"]+|vista-vinculacion)"/g)].map((m) => [
      '#' + m[1],
      nodo()
    ])
  )
  const doc = {
    querySelector: (id) => nodes[id],
    querySelectorAll: () => [nodes['#vista-vinculacion']]
  }
  nodes['#vista-vinculacion'].querySelector = (id) => nodes[id]
  nodes['#vista-vinculacion'].querySelectorAll = () => []
  const origen = 'https://gg-app-m-harvest.vercel.app'
  const rutas = [],
    llamadas = []
  const navegador = {
    location: {
      origin: origen,
      pathname: '/',
      search: '',
      hash: fragmento,
      href: origen + '/' + fragmento
    },
    history: { replaceState: (_s, _t, url) => rutas.push(url) },
    navigator: {},
    addEventListener() {}
  }
  const servicio = {
    restaurar: async () => {},
    vista: () => (vinculado ? { empresa: 'Empresa A', nombre: 'PDA Norte' } : null),
    iniciarSesion: async (datos) => {
      llamadas.push(['login', datos])
      if (fallar) throw new Error('Credenciales inválidas')
    },
    iniciarConDni: async (dni) => {
      llamadas.push(['loginDni', dni])
      if (fallar) throw new Error('DNI no autorizado')
      return { operador: { dni } }
    },
    haySesionDni: () => false,
    vincular: async (t, n) => {
      llamadas.push(['vincular', t, n])
      vinculado = true
    },
    continuar: async () => ({ operador: { dni: '12345678' } }),
    salir: async () => {
      llamadas.push(['salir'])
    }
  }
  const iniciar = () =>
    configurarVinculacionDispositivo({
      servicio,
      doc,
      navegador,
      alIngresar: async (op) => llamadas.push(['ingresar', op.dni])
    })
  return { nodes, llamadas, rutas, iniciar, servicio, navegador }
}
test('primero escanea y vincula, luego muestra solo DNI sin solicitar PIN', async () => {
  const token = 'a'.repeat(64),
    e = preparar({ fragmento: '#vincular=' + token })
  await e.iniciar()
  assert.deepEqual(e.rutas, ['/'])
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), false)
  assert.doesNotMatch(html, /id="pda-enlace"|Leer enlace|pega el enlace|id="pda-pin/)
  e.nodes['#pda-email'].value = 'supervisor@example.test'
  e.nodes['#pda-password'].value = 'password-test'
  e.nodes['#pda-nombre'].value = 'PDA Norte'
  e.nodes['#pda-form-cuenta'].emitir('submit')
  await turno()
  assert.equal(e.nodes['#pda-password'].value, '')
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-ingreso'].classList.contains('oculto'), false)
  assert.equal(
    e.llamadas.some((l) => l[0] === 'ingresar'),
    false
  )
  e.nodes['#pda-dni'].value = '12345678'
  e.nodes['#pda-form-ingreso'].emitir('submit')
  await turno()
  assert.deepEqual(
    e.llamadas.map((l) => l[0]),
    ['login', 'vincular', 'loginDni', 'ingresar']
  )
})

test('un equipo conocido omite QR y correo y rechaza un DNI no autorizado', async () => {
  const e = preparar({ vinculado: true, fallar: true })
  await e.iniciar()
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-ingreso'].classList.contains('oculto'), false)
  e.nodes['#pda-dni'].value = '12345678'
  e.nodes['#pda-form-ingreso'].emitir('submit')
  await turno()
  assert.match(e.nodes['#pda-mensaje'].textContent, /DNI no autorizado/)
  assert.equal(
    e.llamadas.some((l) => l[0] === 'vincular' || l[0] === 'ingresar'),
    false
  )
})

test('la cámara lee el QR, cierra el stream y permite escanear otro código', async () => {
  const e = preparar()
  let cerrada = false
  e.navegador.BarcodeDetector = class {
    async detect() {
      return [
        { rawValue: 'https://gg-app-m-harvest.vercel.app/#vincular=' + 'a'.repeat(64) }
      ]
    }
  }
  e.navegador.navigator.mediaDevices = {
    getUserMedia: async () => ({
      getTracks: () => [
        {
          stop() {
            cerrada = true
          }
        }
      ]
    })
  }
  e.nodes['#pda-video'].play = async () => {}
  await e.iniciar()
  assert.equal(e.nodes['#pda-camara'].disabled, false)
  e.nodes['#pda-camara'].emitir('click')
  await turno()
  assert.equal(cerrada, true)
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), false)
  e.nodes['#pda-cambiar-qr'].emitir('click')
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), false)
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
})

test('si falla la reproducción de cámara cierra el stream y solicita revisar los permisos', async () => {
  const e = preparar()
  let cerrada = false
  e.navegador.BarcodeDetector = class {}
  e.navegador.navigator.mediaDevices = {
    getUserMedia: async () => ({
      getTracks: () => [
        {
          stop() {
            cerrada = true
          }
        }
      ]
    })
  }
  e.nodes['#pda-video'].play = async () => {
    throw new Error('Sin reproducción')
  }
  await e.iniciar()
  e.nodes['#pda-camara'].emitir('click')
  await turno()
  assert.equal(cerrada, true)
  assert.match(e.nodes['#pda-mensaje'].textContent, /Revisa sus permisos/)
  assert.equal(e.nodes['#pda-video'].srcObject, null)
})

test('primera apertura muestra la bienvenida y no permite ingreso sin vincular', async () => {
  const e = preparar()
  await e.iniciar()
  assert.equal(e.nodes['#pda-bienvenida'].classList.contains('oculto'), false)
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-ingreso'].classList.contains('oculto'), true)
  e.nodes['#pda-form-cuenta'].emitir('submit')
  await turno()
  assert.match(e.nodes['#pda-mensaje'].textContent, /Primero escanea/)
  assert.equal(e.llamadas.length, 0)
})

test('la flecha abre la cámara y un permiso rechazado conserva el reintento sin pedir cuenta', async () => {
  const e = preparar()
  let intentos = 0
  e.navegador.BarcodeDetector = class {}
  e.navegador.navigator.mediaDevices = {
    getUserMedia: async () => {
      intentos++
      throw new Error('NotAllowedError')
    }
  }
  await e.iniciar()
  e.nodes['#pda-comenzar'].emitir('click')
  await turno()
  assert.equal(intentos, 1)
  assert.equal(e.nodes['#pda-bienvenida'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), false)
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
  assert.match(e.nodes['#pda-mensaje'].textContent, /Permite su acceso/)
  e.nodes['#pda-camara'].emitir('click')
  await turno()
  assert.equal(intentos, 2)
  assert.deepEqual(e.llamadas, [])
})

test('ingreso diario solicita solamente DNI y no llama a Auth ni vuelve a vincular', async () => {
  const e = preparar({ vinculado: true })
  await e.iniciar()
  e.nodes['#pda-dni'].value = '12345678'
  e.nodes['#pda-form-ingreso'].emitir('submit')
  await turno()
  assert.deepEqual(e.llamadas, [
    ['loginDni', '12345678'],
    ['ingresar', '12345678']
  ])
})

test('el ingreso recupera el campo de escaneo y el teclado manual del diseño anterior', async () => {
  const e = preparar({ vinculado: true })
  await e.iniciar()
  assert.equal(e.nodes['#pda-card'].classList.contains('pda-card'), false)
  assert.equal(e.nodes['#pda-symbol'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-conexion'].classList.contains('oculto'), false)
  assert.equal(e.nodes['#pda-empresa'].textContent, 'Empresa A')
  assert.equal(e.nodes['#pda-equipo'].textContent, 'PDA Norte')
  assert.equal(e.nodes['#pda-dni'].inputMode, 'none')
  e.nodes['#pda-teclado'].emitir('click')
  assert.equal(e.nodes['#pda-dni'].inputMode, 'numeric')
  e.nodes['#pda-dni'].value = '12345678'
  e.nodes['#pda-dni'].emitir('keydown', { key: 'Enter' })
  await turno()
  assert.equal(e.nodes['#pda-dni'].inputMode, 'none')
  assert.deepEqual(e.llamadas, [
    ['loginDni', '12345678'],
    ['ingresar', '12345678']
  ])
})

test('un PDA nuevo conserva el diseño de vinculación por cámara sin mostrar una empresa ficticia', async () => {
  const e = preparar()
  await e.iniciar()
  assert.equal(e.nodes['#pda-card'].classList.contains('pda-card'), true)
  assert.equal(e.nodes['#pda-symbol'].classList.contains('oculto'), false)
  assert.equal(e.nodes['#pda-conexion'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-empresa'].textContent, '')
  assert.equal(e.nodes['#pda-equipo'].textContent, '')
})
