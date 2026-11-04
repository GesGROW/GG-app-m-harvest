import { lecturaCampo } from './helpers/lecturaCampo.js'
import assert from 'node:assert/strict'
import test from 'node:test'
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

for (const camino of ['finalizar', 'volver', 'restaurable']) {
  test(`${camino} solo cierra la sesión tras confirmar en SCC`, async () => {
    let cierres = 0
    const sesion = { id: 'S', sesion_id: 'S', jabero: 'Ana', estado: 'ACTIVA' }
    const campo = lecturaCampo({
      sesionLectura: sesion,
      obtenerSesionesActivas: async () => [sesion],
      casosDeUso: {
        cerrarSesionLectura: async () => {
          cierres++
          return { sincronizar: async () => false }
        }
      }
    })
    await campo.preparada
    await campo.lectura.mostrarSesionesActivas()
    const boton =
      camino === 'restaurable'
        ? campo.nodo('sesiones-restaurables').children[1].children[3]
        : campo.nodo(
            camino === 'finalizar' ? 'btn-finalizar-lectura' : 'btn-volver-menu-lectura'
          )
    const cancelacion = boton.emitir('click')
    assert.equal(cierres, 0)
    await campo.nodo('confirmacion-lectura').close('cancelar')
    await cancelacion
    assert.equal(cierres, 0)
    assert.equal(campo.lectura.obtenerSesion().sesion_id, 'S')
    const aceptacion = boton.emitir('click')
    assert.equal(cierres, 0)
    await campo.nodo('confirmacion-lectura').close('confirmar')
    await aceptacion
    assert.equal(cierres, 1)
    assert.equal(campo.lectura.obtenerSesion(), null)
  })
}
