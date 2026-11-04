import { esDniValido } from '../../modules/scanner.js'
import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'

export function crearRegistroJaberos({
  document,
  casosDeUso,
  obtenerOperador,
  configurarEnvioScanner,
  desactivarTecladoManual,
  actualizarEstadoConexion,
  mostrarVista,
  mostrarMenu
}) {
  const vistaJaberos = document.querySelector('#vista-jaberos')
  const btnMenuJaberos = document.querySelector('#btn-menu-jaberos')
  const btnVolverMenuJaberos = document.querySelector('#btn-volver-menu-jaberos')
  const jaberosOperador = document.querySelector('#jaberos-operador')
  const formJabero = document.querySelector('#form-jabero')
  const dniJaberoInput = document.querySelector('#dni-jabero')
  const resultadoJabero = document.querySelector('#resultado-jabero')
  let revision = 0
  const activa = () => !vistaJaberos.classList.contains('oculto')
  btnMenuJaberos.addEventListener('click', () => {
    limpiarRegistroJabero()
    jaberosOperador.textContent = obtenerOperador()?.nombre
    mostrarVista(vistaJaberos)
    if (activa()) dniJaberoInput.focus()
  })

  btnVolverMenuJaberos.addEventListener('click', () => {
    limpiarRegistroJabero()
    mostrarMenu()
  })

  configurarEnvioScanner(formJabero, dniJaberoInput, async (dni, liberar) => {
    const version = ++revision
    const operador = obtenerOperador()
    const vigente = () => version === revision && obtenerOperador() === operador
    limpiarResultadoJabero()
    if (!esDniValido(dni)) {
      mostrarResultadoJabero('El DNI debe contener 8 dígitos.', 'error')
      dniJaberoInput.select()
      return
    }
    let resultado
    try {
      resultado = await casosDeUso.registrarJabero({ operador, dni })
      const { trabajador } = resultado

      if (vigente()) {
        mostrarResultadoJabero(
          `${nombreCosechadorVisible(trabajador?.nombre, dni)} registrado como jabero`,
          'exito'
        )
        dniJaberoInput.value = ''
        desactivarTecladoManual(dniJaberoInput)
        if (activa()) dniJaberoInput.focus()
      }
    } catch (error) {
      if (!vigente()) return
      mostrarResultadoJabero(error.message, 'error')
      dniJaberoInput.select()
      return
    }

    liberar()
    await resultado.sincronizar()
    await actualizarEstadoConexion()
  })

  function mostrarResultadoJabero(mensaje, tipo) {
    resultadoJabero.textContent = mensaje
    resultadoJabero.className = `resultado ${tipo}`
    resultadoJabero.classList.remove('oculto')
  }

  function limpiarResultadoJabero() {
    resultadoJabero.textContent = ''
    resultadoJabero.className = 'resultado oculto'
  }

  function limpiarRegistroJabero() {
    revision++
    desactivarTecladoManual(dniJaberoInput)
    dniJaberoInput.value = ''
    limpiarResultadoJabero()
  }

  return Object.freeze({ limpiar: limpiarRegistroJabero })
}
