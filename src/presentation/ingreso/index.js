import { autorizacionOperadorVigente } from '@gesgrow/core/contexts/identity-access/index.js'
import { esDniValido } from '../../modules/scanner.js'
import { crearSeleccionCampania } from './campanias.js'

export function crearIngreso({
  document,
  casosDeUso,
  configurarScanner,
  desactivarTecladoManual,
  almacenSesion,
  seleccionarCampaniaLocal,
  cerrarSesionDispositivo,
  limpiarFlujos,
  mostrarVista,
  mostrarMenu,
  actualizarEstadoConexion,
  esAutorizacionVigente = autorizacionOperadorVigente,
  avisar = (texto) => globalThis.alert(texto),
  registrarError = (...args) => console.error(...args)
}) {
  const vistaLogin = document.querySelector('#vista-login')
  const formLogin = document.querySelector('#form-login')
  const dniOperadorInput = document.querySelector('#dni-operador')
  const loginMensaje = document.querySelector('#login-mensaje')
  let operador = null,
    revision = 0
  const seleccion = crearSeleccionCampania({
    document,
    obtenerOperador: () => operador,
    ingresarCampania,
    mostrarVista,
    registrarError
  })

  function mostrarError(mensaje) {
    loginMensaje.textContent = mensaje
    loginMensaje.className = 'mensaje error'
  }
  function limpiarMensaje() {
    loginMensaje.textContent = ''
    loginMensaje.className = 'mensaje'
  }

  async function ingresarCampania(campania) {
    const version = revision,
      operadorIngreso = operador
    const resultado = await casosDeUso.ingresarCampania({
      operador: operadorIngreso,
      campania
    })
    if (version !== revision || operador !== operadorIngreso) return
    operador = resultado.operador
    limpiarFlujos()
    almacenSesion.setItem('operador_dni', operador.dni)
    almacenSesion.setItem('campania_id', campania.id)
    mostrarMenu()
    resultado
      .sincronizar()
      .then((intento) => {
        if (intento) return actualizarEstadoConexion()
      })
      .catch(registrarError)
  }

  function autorizarVista(vista) {
    if (!operador || esAutorizacionVigente(operador)) return vista
    revision++
    operador = null
    seleccion.limpiar()
    limpiarFlujos()
    almacenSesion.removeItem('operador_dni')
    mostrarError('La autorización venció. Ingrese con una asignación de hoy.')
    return vistaLogin
  }
  function verificarVigenciaOperador() {
    if (!operador) return false
    if (esAutorizacionVigente(operador)) return true
    mostrarVista(autorizarVista(vistaLogin))
    return false
  }
  function configurarEnvioScanner(formulario, input, procesar) {
    return configurarScanner(formulario, input, async (...argumentos) => {
      if (formulario !== formLogin && !verificarVigenciaOperador()) return
      return procesar(...argumentos)
    })
  }
  configurarEnvioScanner(formLogin, dniOperadorInput, async (dni) => {
    limpiarMensaje()
    if (!esDniValido(dni)) {
      mostrarError('El DNI debe contener 8 dígitos.')
      dniOperadorInput.select()
      return
    }
    const version = ++revision
    try {
      const validado = await casosDeUso.validarOperador(dni)
      if (version !== revision) return
      operador = validado
      desactivarTecladoManual(dniOperadorInput)
      await seleccion.preparar()
    } catch (error) {
      if (version !== revision) return
      mostrarError(error.message)
      if (!vistaLogin.classList.contains('oculto')) dniOperadorInput.select()
    }
  })

  async function cerrarSesion() {
    // Invalida login/restauración pendientes incluso si la salida del PDA tarda.
    revision++
    try {
      await cerrarSesionDispositivo()
    } catch (error) {
      avisar(error.message)
      return
    }
    operador = null
    seleccion.limpiar()
    limpiarFlujos()
    almacenSesion.removeItem('operador_dni')
    almacenSesion.removeItem('campania_id')
    await seleccionarCampaniaLocal('')
    dniOperadorInput.value = ''
    mostrarVista(vistaLogin)
    if (!vistaLogin.classList.contains('oculto')) dniOperadorInput.focus()
  }
  document.querySelector('#btn-salir-menu').addEventListener('click', cerrarSesion)
  document
    .querySelector('#btn-cancelar-cultivo')
    .addEventListener('click', cerrarSesion)

  async function restaurar() {
    const dni = almacenSesion.getItem('operador_dni')
    if (!dni) return
    const version = ++revision
    try {
      const validado = await casosDeUso.validarOperador(dni)
      if (version !== revision) return
      operador = validado
      await seleccion.preparar(almacenSesion.getItem('campania_id'))
    } catch {
      if (version !== revision) return
      operador = null
      seleccion.limpiar()
      almacenSesion.removeItem('operador_dni')
    }
  }
  return Object.freeze({
    obtenerOperador: () => operador,
    configurarEnvioScanner,
    verificarVigenciaOperador,
    autorizarVista,
    restaurar
  })
}
