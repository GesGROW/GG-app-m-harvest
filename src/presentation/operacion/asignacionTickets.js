import { esDniValido } from '../../modules/scanner.js'
import { mensajeErrorTickets } from '../../shared/mensajesTickets.js'
import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'

export function crearAsignacionTickets({
  document,
  casosDeUso,
  obtenerOperador,
  buscarCosechador,
  configurarEnvioScanner,
  desactivarTecladoManual,
  actualizarEstadoConexion,
  obtenerColaCompleta,
  mostrarVista,
  mostrarMenu,
  temporizadores = globalThis
}) {
  const vistaAsignacion = document.querySelector('#vista-asignacion')
  const btnMenuAsignacion = document.querySelector('#btn-menu-asignacion')
  const nombreOperador = document.querySelector('#nombre-operador')
  const btnVolverMenu = document.querySelector('#btn-volver-menu')
  const formCosechador = document.querySelector('#form-cosechador')
  const dniCosechadorInput = document.querySelector('#dni-cosechador')
  const infoCosechador = document.querySelector('#info-cosechador')
  const nombreCosechador = document.querySelector('#nombre-cosechador')
  const campaniaCosechador = document.querySelector('#campania-cosechador')
  const cardTicket = document.querySelector('#card-ticket')
  const formTicket = document.querySelector('#form-ticket')
  const codigoTicketInput = document.querySelector('#codigo-ticket')
  const resultado = document.querySelector('#resultado')
  let cosechador = null
  let revision = 0
  let siguienteCosechador = null
  const activa = () => !vistaAsignacion.classList.contains('oculto')
  function cancelarSiguiente() {
    if (siguienteCosechador !== null) temporizadores.clearTimeout(siguienteCosechador)
    siguienteCosechador = null
  }
  btnMenuAsignacion.addEventListener('click', () => {
    limpiarAsignacion()
    mostrarVista(vistaAsignacion)
    nombreOperador.textContent = obtenerOperador()?.nombre
    if (activa()) dniCosechadorInput.focus()
  })

  btnVolverMenu.addEventListener('click', () => {
    limpiarAsignacion()
    mostrarMenu()
  })

  configurarEnvioScanner(formCosechador, dniCosechadorInput, async (dni) => {
    cancelarSiguiente()
    const version = ++revision
    const operador = obtenerOperador()
    const vigente = () => version === revision && obtenerOperador() === operador
    limpiarResultado()
    if (!esDniValido(dni)) {
      mostrarResultado('El DNI debe contener 8 dígitos.', 'error')
      dniCosechadorInput.select()
      return
    }
    try {
      const encontrado = await buscarCosechador(dni)
      if (!vigente()) return
      cosechador = encontrado
      nombreCosechador.textContent = nombreCosechadorVisible(
        cosechador.nombre,
        cosechador.dni
      )
      campaniaCosechador.textContent = cosechador.campania
      infoCosechador.classList.remove('oculto')
      desactivarTecladoManual(dniCosechadorInput)
      habilitarTicket()
    } catch (error) {
      if (!vigente()) return
      cosechador = null
      deshabilitarTicket()
      mostrarResultado(error.message, 'error')
      dniCosechadorInput.select()
    }
  })

  // ASIGNAR TICKET

  configurarEnvioScanner(
    formTicket,
    codigoTicketInput,
    async (codigoTicket, liberar) => {
      const operador = obtenerOperador()
      const version = revision
      const vigente = () => version === revision && obtenerOperador() === operador
      limpiarResultado()
      if (!operador || !cosechador) {
        return
      }
      if (!codigoTicket) {
        mostrarResultado('Escanee un ticket.', 'error')
        codigoTicketInput.focus()
        return
      }
      codigoTicketInput.disabled = true
      let respuestaAsignacion
      try {
        respuestaAsignacion = await casosDeUso.asignarTicket({
          operador,
          cosechador,
          codigoTicket
        })
      } catch (error) {
        if (!vigente()) return
        mostrarResultado(mensajeErrorTickets(error, codigoTicket), 'error')
        codigoTicketInput.disabled = false
        codigoTicketInput.select()
        return
      }

      const mensajeAsignacion = `Ticket ${codigoTicket} y conjunto de tickets relacionado asignados`
      if (vigente()) {
        mostrarResultado(mensajeAsignacion, 'exito')
        desactivarTecladoManual(codigoTicketInput)
        cancelarSiguiente()
        siguienteCosechador = temporizadores.setTimeout(() => {
          siguienteCosechador = null
          if (vigente()) prepararSiguienteCosechador()
        }, 1200)
      }
      liberar()
      await actualizarEstadoConexion()

      if (await respuestaAsignacion.sincronizar()) {
        await actualizarEstadoConexion()
        const op = (await obtenerColaCompleta()).find(
          (o) => o.id === respuestaAsignacion.operacion?.id
        )
        if (vigente() && resultado.textContent === mensajeAsignacion) {
          if (op?.estado === 'SINCRONIZADA')
            mostrarResultado(
              `Ticket ${codigoTicket} y conjunto de tickets relacionado asignados`,
              'exito'
            )
          else if (op?.estado === 'ERROR') mostrarResultado(op.error, 'error')
        }
      }
    }
  )

  function habilitarTicket() {
    cardTicket.classList.remove('deshabilitado')
    codigoTicketInput.disabled = false
    codigoTicketInput.parentElement.querySelector('.btn-teclado').disabled = false
    codigoTicketInput.value = ''
    if (activa()) codigoTicketInput.focus()
  }

  function deshabilitarTicket() {
    desactivarTecladoManual(codigoTicketInput)
    cardTicket.classList.add('deshabilitado')
    codigoTicketInput.disabled = true
    codigoTicketInput.parentElement.querySelector('.btn-teclado').disabled = true
    codigoTicketInput.value = ''
    infoCosechador.classList.add('oculto')
  }

  function prepararSiguienteCosechador() {
    desactivarTecladoManual(dniCosechadorInput, codigoTicketInput)
    cosechador = null
    dniCosechadorInput.value = ''
    infoCosechador.classList.add('oculto')
    deshabilitarTicket()
    if (activa()) dniCosechadorInput.focus()
  }

  function limpiarAsignacion() {
    revision++
    cancelarSiguiente()
    desactivarTecladoManual(dniCosechadorInput, codigoTicketInput)
    cosechador = null
    dniCosechadorInput.value = ''
    codigoTicketInput.value = ''
    infoCosechador.classList.add('oculto')
    deshabilitarTicket()
    limpiarResultado()
  }

  function mostrarResultado(mensaje, tipo) {
    resultado.textContent = mensaje
    resultado.className = `resultado ${tipo}`
    resultado.classList.remove('oculto')
  }

  function limpiarResultado() {
    resultado.textContent = ''
    resultado.className = 'resultado oculto'
  }

  return Object.freeze({ limpiar: limpiarAsignacion })
}
