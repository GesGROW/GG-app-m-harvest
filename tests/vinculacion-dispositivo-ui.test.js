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
    addEventListener: (e, f) => eventos.set(e, f),
    emitir: (e) => eventos.get(e)?.({ preventDefault() {} })
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
    configurarPin: async (pin) => {
      llamadas.push(['configurarPin', pin])
      return { dni: '12345678' }
    },
    iniciarConPin: async (datos) => {
      llamadas.push(['loginPin', datos.dni])
      if (fallar) throw new Error('DNI o PIN incorrectos')
      return { operador: { dni: datos.dni } }
    },
    haySesionPin: () => false,
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
test('primero escanea, luego valida la cuenta y crea el PIN antes de ingresar; nunca entra solo con correo', async () => {
  const token = 'a'.repeat(64),
    e = preparar({ fragmento: '#vincular=' + token })
  await e.iniciar()
  assert.deepEqual(e.rutas, ['/'])
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), false)
  assert.doesNotMatch(html, /id="pda-enlace"|Leer enlace|pega el enlace/)
  e.nodes['#pda-email'].value = 'supervisor@example.test'
  e.nodes['#pda-password'].value = 'password-test'
  e.nodes['#pda-nombre'].value = 'PDA Norte'
  e.nodes['#pda-form-cuenta'].emitir('submit')
  await turno()
  assert.equal(e.nodes['#pda-password'].value, '')
  assert.equal(e.nodes['#pda-form-configurar-pin'].classList.contains('oculto'), false)
  assert.equal(
    e.llamadas.some((l) => l[0] === 'ingresar'),
    false
  )
  e.nodes['#pda-pin-nuevo'].value = '0427'
  e.nodes['#pda-pin-confirmacion'].value = '0427'
  e.nodes['#pda-form-configurar-pin'].emitir('submit')
  await turno()
  assert.deepEqual(
    e.llamadas.map((l) => l[0]),
    ['login', 'vincular', 'configurarPin', 'loginPin', 'ingresar']
  )
  assert.equal(e.nodes['#pda-titulo'].textContent, 'Sistema de Control de Cosecha')
  assert.equal(e.nodes['#pda-pin-nuevo'].value, '')
  assert.equal(e.nodes['#pda-pin-confirmacion'].value, '')
})
test('un equipo conocido omite QR y una cuenta incorrecta nunca habilita el ingreso', async () => {
  const e = preparar({ vinculado: true, fallar: true })
  await e.iniciar()
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-empresa'].textContent, 'Empresa A · PDA Norte')
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-ingreso'].classList.contains('oculto'), false)
  e.nodes['#pda-dni'].value = '12345678'
  e.nodes['#pda-pin'].value = '9999'
  e.nodes['#pda-form-ingreso'].emitir('submit')
  await turno()
  assert.match(e.nodes['#pda-mensaje'].textContent, /DNI o PIN incorrectos/)
  assert.equal(e.nodes['#pda-pin'].value, '')
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

test('primera apertura muestra exclusivamente QR y no permite ingreso ni configuración sin escanear', async () => {
  const e = preparar()
  await e.iniciar()
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), false)
  for (const id of [
    'pda-form-cuenta',
    'pda-form-configurar-pin',
    'pda-form-ingreso',
    'pda-configurar-acceso'
  ])
    assert.equal(e.nodes['#' + id].classList.contains('oculto'), true, id)
  e.nodes['#pda-configurar-acceso'].emitir('click')
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
  e.nodes['#pda-form-cuenta'].emitir('submit')
  await turno()
  assert.match(e.nodes['#pda-mensaje'].textContent, /Primero escanea/)
  assert.equal(e.llamadas.length, 0)
})

test('ingreso diario con DNI y PIN no consulta correo y recupera PIN solo al pedirlo', async () => {
  const e = preparar({ vinculado: true })
  await e.iniciar()
  e.nodes['#pda-dni'].value = '12345678'
  e.nodes['#pda-pin'].value = '0427'
  e.nodes['#pda-form-ingreso'].emitir('submit')
  await turno()
  assert.deepEqual(
    e.llamadas.map((l) => l[0]),
    ['loginPin', 'ingresar']
  )
  assert.equal(e.nodes['#pda-pin'].value, '')
  e.nodes['#pda-configurar-acceso'].emitir('click')
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), false)
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), true)
  e.nodes['#pda-volver-ingreso'].emitir('click')
  assert.equal(e.nodes['#pda-form-cuenta'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-form-ingreso'].classList.contains('oculto'), false)
})

test('PIN nuevo requiere confirmación coincidente y se limpia aun si hay error', async () => {
  const e = preparar({ vinculado: true })
  await e.iniciar()
  e.nodes['#pda-configurar-acceso'].emitir('click')
  e.nodes['#pda-form-cuenta'].emitir('submit')
  await turno()
  e.nodes['#pda-pin-nuevo'].value = '0427'
  e.nodes['#pda-pin-confirmacion'].value = '1234'
  e.nodes['#pda-form-configurar-pin'].emitir('submit')
  await turno()
  assert.match(e.nodes['#pda-mensaje'].textContent, /no coinciden/)
  assert.equal(e.nodes['#pda-pin-nuevo'].value, '')
  assert.equal(
    e.llamadas.some((l) => l[0] === 'configurarPin' || l[0] === 'ingresar'),
    false
  )
})
