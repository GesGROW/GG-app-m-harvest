import assert from 'node:assert/strict'
import test from 'node:test'
import { configurarMenuContextual } from '../src/modules/menuContextual.js'

function preparar() {
  const dialogo = new EventTarget()
  const clases = new Set(['oculto'])
  const atributos = new Map([['aria-hidden', 'true']])
  const doc = { activeElement: null }
  function boton() {
    const el = new EventTarget()
    el.isConnected = true
    el.focus = () => {
      doc.activeElement = el
    }
    return el
  }
  const disparador = boton(),
    botonCerrar = boton()
  dialogo.open = false
  dialogo.ownerDocument = doc
  dialogo.classList = {
    add: (c) => clases.add(c),
    remove: (c) => clases.delete(c)
  }
  dialogo.setAttribute = (nombre, valor) => atributos.set(nombre, valor)
  dialogo.showModal = () => {
    dialogo.open = true
  }
  dialogo.close = () => {
    dialogo.open = false
  }
  disparador.focus()
  const menu = configurarMenuContextual({ dialogo, botonCerrar })
  return { menu, dialogo, doc, disparador, botonCerrar, clases, atributos }
}

test('Escape cierra el menú y devuelve el foco al disparador conectado', () => {
  const { menu, dialogo, doc, disparador, botonCerrar, clases, atributos } = preparar()
  menu.abrir()
  assert.equal(dialogo.open, true)
  assert.equal(clases.has('oculto'), false)
  assert.equal(atributos.get('aria-hidden'), 'false')
  assert.equal(doc.activeElement, botonCerrar)
  const cancelacion = new Event('cancel', { cancelable: true })
  dialogo.dispatchEvent(cancelacion)
  assert.equal(cancelacion.defaultPrevented, true)
  assert.equal(dialogo.open, false)
  assert.equal(clases.has('oculto'), true)
  assert.equal(atributos.get('aria-hidden'), 'true')
  assert.equal(doc.activeElement, disparador)
})

test('abrir dos veces conserva el disparador y cerrar dos veces no roba el foco', () => {
  const { menu, doc, disparador, botonCerrar } = preparar()
  menu.abrir()
  menu.abrir()
  botonCerrar.dispatchEvent(new Event('click'))
  assert.equal(doc.activeElement, disparador)
  const siguiente = {}
  doc.activeElement = siguiente
  menu.cerrar()
  assert.equal(doc.activeElement, siguiente)
})

test('cerrar no intenta enfocar un disparador retirado y permite volver a abrir', () => {
  const { menu, dialogo, disparador } = preparar()
  menu.abrir()
  disparador.isConnected = false
  disparador.focus = () => assert.fail('El disparador ya no existe')
  menu.cerrar()
  assert.equal(dialogo.open, false)
  menu.abrir()
  assert.equal(dialogo.open, true)
})

test('el fondo cierra el menú, pero un clic dentro no lo cierra', () => {
  const { menu, dialogo, doc, disparador } = preparar()
  menu.abrir()
  const interior = new Event('click')
  Object.defineProperty(interior, 'target', { value: {} })
  dialogo.dispatchEvent(interior)
  assert.equal(dialogo.open, true)
  dialogo.dispatchEvent(new Event('click'))
  assert.equal(dialogo.open, false)
  assert.equal(doc.activeElement, disparador)
})

test('Tab y Shift+Tab mantienen el foco entre el primer y último control visibles', () => {
  const { menu, dialogo, doc, botonCerrar } = preparar()
  const ultimo = {
    focus: () => {
      doc.activeElement = ultimo
    }
  }
  for (const el of [botonCerrar, ultimo]) {
    el.tabIndex = 0
    el.getClientRects = () => [{}]
  }
  const oculto = { tabIndex: 0, getClientRects: () => [] }
  dialogo.querySelectorAll = () => [botonCerrar, ultimo, oculto]
  menu.abrir()
  const atras = new Event('keydown', { cancelable: true })
  Object.assign(atras, { key: 'Tab', shiftKey: true })
  dialogo.dispatchEvent(atras)
  assert.equal(atras.defaultPrevented, true)
  assert.equal(doc.activeElement, ultimo)
  const adelante = new Event('keydown', { cancelable: true })
  Object.assign(adelante, { key: 'Tab', shiftKey: false })
  dialogo.dispatchEvent(adelante)
  assert.equal(adelante.defaultPrevented, true)
  assert.equal(doc.activeElement, botonCerrar)
})
