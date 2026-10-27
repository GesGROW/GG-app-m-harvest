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
test('primera pantalla procesa el fragmento, lo retira del historial, autentica y vincula antes de ingresar', async () => {
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
  e.nodes['#pda-continuar'].emitir('click')
  await turno()
  assert.deepEqual(
    e.llamadas.map((l) => l[0]),
    ['login', 'vincular', 'ingresar']
  )
  assert.equal(e.nodes['#pda-titulo'].textContent, 'PDA vinculado')
})
test('un equipo conocido omite QR y una cuenta incorrecta nunca habilita el ingreso', async () => {
  const e = preparar({ vinculado: true, fallar: true })
  await e.iniciar()
  assert.equal(e.nodes['#pda-form-qr'].classList.contains('oculto'), true)
  assert.equal(e.nodes['#pda-empresa'].textContent, 'Empresa A · PDA Norte')
  e.nodes['#pda-form-cuenta'].emitir('submit')
  await turno()
  assert.match(e.nodes['#pda-mensaje'].textContent, /Credenciales/)
  assert.equal(e.nodes['#pda-continuar'].classList.contains('oculto'), true)
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
