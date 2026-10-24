import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { configurarConfirmacion } from '../src/modules/confirmacion.js'

function crearConfirmacion() {
  const dialogo = new EventTarget()
  dialogo.returnValue = ''
  dialogo.aperturas = 0
  dialogo.showModal = () => {
    dialogo.aperturas++
  }
  dialogo.close = (valor) => {
    if (valor !== undefined) dialogo.returnValue = valor
    dialogo.dispatchEvent(new Event('close'))
  }
  const mensaje = { textContent: '' }
  return {
    dialogo,
    mensaje,
    confirmar: configurarConfirmacion({ dialogo, mensaje })
  }
}

test('la confirmación espera la elección antes de permitir finalizar', async () => {
  const { dialogo, mensaje, confirmar } = crearConfirmacion()
  let resuelta = false
  const resultado = confirmar('¿Finalizar la sesión de lectura?').then((valor) => {
    resuelta = true
    return valor
  })
  await Promise.resolve()
  assert.equal(resuelta, false)
  assert.equal(mensaje.textContent, '¿Finalizar la sesión de lectura?')
  dialogo.close('confirmar')
  assert.equal(await resultado, true)
})

test('Cancelar conserva la sesión activa', async () => {
  const { dialogo, confirmar } = crearConfirmacion()
  const resultado = confirmar('¿Finalizar?')
  dialogo.close('cancelar')
  assert.equal(await resultado, false)
})

test('cerrar con Escape no reutiliza una confirmación anterior', async () => {
  const { dialogo, confirmar } = crearConfirmacion()
  const primera = confirmar('Primera sesión')
  dialogo.close('confirmar')
  assert.equal(await primera, true)
  const segunda = confirmar('Segunda sesión')
  dialogo.close()
  assert.equal(await segunda, false)
})

test('una segunda solicitud no provoca un cierre duplicado', async () => {
  const { dialogo, confirmar } = crearConfirmacion()
  const primera = confirmar('¿Finalizar?')
  assert.equal(await confirmar('Otra solicitud'), false)
  assert.equal(dialogo.aperturas, 1)
  dialogo.close('confirmar')
  assert.equal(await primera, true)
})

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const caminos = [
  {
    nombre: 'Finalizar lectura',
    inicio: "btnFinalizarLectura.addEventListener('click', async () => {",
    fin: '\n})'
  },
  {
    nombre: 'Volver al menú con una sesión activa',
    inicio: "btnVolverMenuLectura.addEventListener('click', async () => {",
    fin: '\n})'
  },
  {
    nombre: 'Finalizar una sesión restaurable',
    inicio: "finalizar.addEventListener('click', async () => {",
    fin: '\n    })'
  }
]

for (const camino of caminos) {
  test(`${camino.nombre} solo cierra la sesión tras confirmar en SCC`, async () => {
    const inicio = main.indexOf(camino.inicio)
    assert.notEqual(inicio, -1)
    const cuerpoInicio = inicio + camino.inicio.length
    const cuerpo = main.slice(cuerpoInicio, main.indexOf(camino.fin, cuerpoInicio))
    const { dialogo, confirmar } = crearConfirmacion()
    let cierres = 0
    const contexto = {
      sesionLectura: { sesion_id: 'sesion-activa' },
      sesion: { sesion_id: 'sesion-restaurable' },
      confirmarFinalizarLectura: confirmar,
      finalizarSesionLectura: async () => {
        cierres++
      },
      mostrarMenu: () => assert.fail('No debe salir al cancelar'),
      mostrarMensajeLectura: () => assert.fail('No debe mostrar un error')
    }
    const manejar = runInNewContext(`(async () => {${cuerpo}\n})`, contexto)
    const cancelacion = manejar()
    assert.equal(cierres, 0)
    dialogo.close('cancelar')
    await cancelacion
    assert.equal(cierres, 0)
    const aceptacion = manejar()
    assert.equal(cierres, 0)
    dialogo.close('confirmar')
    await aceptacion
    assert.equal(cierres, 1)
  })
}
