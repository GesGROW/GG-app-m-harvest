import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { configurarTecladoManual } from '../src/modules/tecladoManual.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('los seis campos de escaneo son editables y parten sin teclado virtual', () => {
  for (const id of [
    'dni-operador',
    'dni-cosechador',
    'codigo-ticket',
    'dni-jabero',
    'dni-jabero-lectura',
    'ticket-lectura'
  ]) {
    const input = html.match(new RegExp(`<input\\s+id="${id}"[\\s\\S]*?/>`))?.[0]
    assert.ok(input, id)
    assert.match(input, /inputmode="none"/)
    assert.match(input, /autocomplete="off"/)
    assert.doesNotMatch(input, /readonly/)
    assert.ok(
      new RegExp(
        `aria-label="Mostrar teclado"\\s+aria-pressed="false"\\s+aria-controls="${id}"`
      ).test(html),
      id
    )
  }
})

function campoSimulado() {
  const clases = new Set()
  const atributos = {}
  let pulsar
  const input = {
    inputMode: '',
    focos: 0,
    desenfoques: 0,
    focus() {
      this.focos++
    },
    blur() {
      this.desenfoques++
    }
  }
  const boton = {
    classList: {
      toggle(clase, activo) {
        if (activo) clases.add(clase)
        else clases.delete(clase)
      }
    },
    setAttribute(nombre, valor) {
      atributos[nombre] = valor
    },
    addEventListener(evento, callback) {
      assert.equal(evento, 'click')
      pulsar = callback
    }
  }
  return { input, boton, clases, atributos, pulsar: () => pulsar() }
}

test('el botón cambia inputmode y estado accesible sin API de Android', () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {}
  })
  try {
    for (const modo of ['numeric', 'text']) {
      const campo = campoSimulado()
      const reiniciar = configurarTecladoManual(campo.input, campo.boton, modo)
      assert.equal(campo.input.inputMode, 'none')
      assert.equal(campo.atributos['aria-pressed'], 'false')

      campo.pulsar()
      assert.equal(campo.input.inputMode, modo)
      assert.equal(campo.atributos['aria-pressed'], 'true')
      assert.equal(campo.atributos['aria-label'], 'Ocultar teclado')
      assert.ok(campo.clases.has('activo'))
      assert.equal(campo.input.focos, 1)
      assert.equal(campo.input.desenfoques, 1)

      campo.pulsar()
      assert.equal(campo.input.inputMode, 'none')
      assert.equal(campo.atributos['aria-pressed'], 'false')
      assert.equal(campo.atributos['aria-label'], 'Mostrar teclado')
      assert.ok(!campo.clases.has('activo'))
      assert.equal(campo.input.focos, 2)

      campo.pulsar()
      reiniciar()
      assert.equal(campo.input.inputMode, 'none')
      assert.equal(campo.atributos['aria-pressed'], 'false')
    }
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'navigator', anterior)
    else delete globalThis.navigator
  }
})

test('usa la API opcional para mostrar y ocultar el teclado', () => {
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let mostrados = 0
  let ocultados = 0
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      virtualKeyboard: {
        show: () => mostrados++,
        hide: () => ocultados++
      }
    }
  })
  try {
    const campo = campoSimulado()
    const reiniciar = configurarTecladoManual(campo.input, campo.boton, 'numeric')
    campo.pulsar()
    assert.equal(mostrados, 1)
    reiniciar()
    assert.equal(ocultados, 1)
    campo.pulsar()
    campo.pulsar()
    assert.equal(ocultados, 2)
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'navigator', anterior)
    else delete globalThis.navigator
  }
})

test('al terminar un escaneo enfocado repone el foco sin modo manual', () => {
  const navegadorAnterior = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const documentoAnterior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {}
  })
  try {
    const campo = campoSimulado()
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { activeElement: campo.input }
    })
    const reiniciar = configurarTecladoManual(campo.input, campo.boton, 'text')
    campo.pulsar()
    reiniciar()
    assert.equal(campo.input.inputMode, 'none')
    assert.equal(campo.input.desenfoques, 2)
    assert.equal(campo.input.focos, 2)
  } finally {
    if (navegadorAnterior)
      Object.defineProperty(globalThis, 'navigator', navegadorAnterior)
    else delete globalThis.navigator
    if (documentoAnterior)
      Object.defineProperty(globalThis, 'document', documentoAnterior)
    else delete globalThis.document
  }
})
