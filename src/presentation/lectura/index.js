import { esDniValido } from '../../modules/scanner.js'
import { mensajeErrorTickets } from '../../shared/mensajesTickets.js'
import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'
import { configurarConfirmacion } from '../../modules/confirmacion.js'
import {
  mostrarContadorCosechador,
  mostrarEstadoLecturaTicket,
  mostrarSesionLecturaEnVista,
  actualizarTotalesLecturaEnVista
} from '../../modules/vistaSesionLectura.js'
import { crearConfiguracionLectura } from './configuracion.js'
import { crearSesionesRestaurables } from './sesionesRestaurables.js'

export function crearLecturaTickets({
  document,
  casosDeUso,
  obtenerOperador,
  consultas,
  configurarEnvioScanner,
  desactivarTecladoManual,
  actualizarEstadoConexion,
  mostrarVista,
  mostrarMenu
}) {
  const vistaLectura = document.querySelector('#vista-lectura')
  const nodo = (id) => document.querySelector(`#${id}`)
  const ui = Object.fromEntries(
    Object.entries({
      configuracionLectura: 'configuracion-lectura',
      sesionLecturaActiva: 'sesion-lectura-activa',
      sesionJabero: 'sesion-jabero',
      sesionLote: 'sesion-lote',
      sesionVariedad: 'sesion-variedad',
      totalSesion: 'total-sesion',
      etiquetaCosechador: 'etiqueta-cosechador',
      totalCosechador: 'total-cosechador',
      mensajeModuloLectura: 'mensaje-modulo-lectura',
      ticketLectura: 'ticket-lectura',
      estadoLecturaTicket: 'estado-lectura-ticket',
      resultadoLectura: 'resultado-lectura'
    }).map(([nombre, id]) => [nombre, nodo(id)])
  )
  const { ticketLectura, totalSesion, etiquetaCosechador, totalCosechador } = ui
  const dniJaberoLectura = nodo('dni-jabero-lectura')
  const formIniciarLectura = nodo('form-iniciar-lectura')
  const formLecturaTicket = nodo('form-lectura-ticket')
  const loteLectura = nodo('lote-lectura'),
    variedadLectura = nodo('variedad-lectura')
  const dialogo = nodo('confirmacion-lectura')
  const confirmar = configurarConfirmacion({
    dialogo,
    mensaje: nodo('confirmacion-lectura-mensaje')
  })
  let sesionLectura = null,
    revision = 0
  const activa = () => !vistaLectura.classList.contains('oculto')
  function comprobarVigencia() {
    const version = revision,
      operador = obtenerOperador()
    return () => version === revision && obtenerOperador() === operador
  }
  const configuracion = crearConfiguracionLectura({
    document,
    obtenerLotes: consultas.obtenerLotes,
    mostrarMensajeLectura
  })
  const restaurables = crearSesionesRestaurables({
    document,
    obtenerOperador,
    consultas,
    continuar,
    solicitarCierre
  })

  nodo('btn-menu-lectura').addEventListener('click', async () => {
    limpiar()
    const vigente = comprobarVigencia()
    nodo('lectura-operador').textContent = obtenerOperador()?.nombre
    mostrarVista(vistaLectura)
    await configuracion.cargar({ vigente })
    if (!vigente() || !activa()) return
    await restaurables.mostrar()
    if (vigente() && activa() && !sesionLectura) loteLectura.focus()
  })

  configurarEnvioScanner(formIniciarLectura, dniJaberoLectura, async (dni) => {
    if (!dni) {
      mostrarMensajeLectura('Ingresar DNI.', 'error')
      dniJaberoLectura.focus()
      return
    }
    const loteId = loteLectura.value
    if (!loteId) {
      mostrarMensajeLectura('Seleccione un lote.', 'error')
      return
    }
    if (!esDniValido(dni)) {
      mostrarMensajeLectura('El DNI debe contener 8 dígitos.', 'error')
      dniJaberoLectura.select()
      return
    }
    const vigente = comprobarVigencia()
    let resultado
    try {
      resultado = await casosDeUso.iniciarSesionLectura({
        operador: obtenerOperador(),
        dni,
        loteId,
        variedadId: variedadLectura.value
      })
      if (vigente()) {
        sesionLectura = normalizarSesion(resultado.sesion)
        desactivarTecladoManual(dniJaberoLectura)
        await mostrarSesion()
      }
    } catch (error) {
      // El resultado durable todavía debe sincronizarse si falló solo su vista.
      if (vigente()) {
        mostrarMensajeLectura(error.message, 'error')
        if (activa()) dniJaberoLectura.select()
      }
      if (!resultado) return
    }
    await resultado.sincronizar()
    await actualizarEstadoConexion()
  })

  configurarEnvioScanner(formLecturaTicket, ticketLectura, async (codigo, liberar) => {
    if (!sesionLectura || !codigo) return
    const vigente = comprobarVigencia()
    const sesion = sesionLectura
    ticketLectura.disabled = true
    let resultado
    try {
      resultado = await casosDeUso.registrarLecturaJaba({
        operador: obtenerOperador(),
        sesionLectura: sesion,
        codigo
      })
      if (vigente()) {
        const { ticket, total, totalPersona } = resultado
        mostrarEstadoLecturaTicket('', ui)
        totalSesion.textContent = total
        mostrarContadorCosechador(
          nombreCosechadorVisible(ticket.cosechador, ticket.cosechador_dni),
          totalPersona,
          ui
        )
        ticketLectura.value = ''
        ticketLectura.disabled = false
        desactivarTecladoManual(ticketLectura)
        if (activa()) ticketLectura.focus()
      }
    } catch (error) {
      if (vigente()) {
        mostrarEstadoLecturaTicket(mensajeErrorTickets(error, codigo), ui)
        ticketLectura.disabled = false
        if (activa()) ticketLectura.select()
      }
      return
    }
    liberar()
    await resultado.sincronizar()
    await actualizarEstadoConexion()
  })

  nodo('btn-finalizar-lectura').addEventListener(
    'click',
    () => sesionLectura && solicitarCierre(sesionLectura)
  )
  nodo('btn-volver-menu-lectura').addEventListener('click', () => {
    if (!sesionLectura) return mostrarMenu()
    return solicitarCierre(
      sesionLectura,
      'Hay una sesión activa. ¿Desea finalizarla y volver al menú?'
    )
  })

  function normalizarSesion(sesion) {
    return { ...sesion, sesion_id: sesion.sesion_id ?? sesion.id }
  }
  async function continuar(sesion) {
    sesionLectura = normalizarSesion(sesion)
    revision++
    mostrarVista(vistaLectura)
    await mostrarSesion()
  }
  async function solicitarCierre(sesion, texto = '¿Finalizar la sesión de lectura?') {
    const vigente = comprobarVigencia()
    if (!(await confirmar(texto)) || !vigente()) return
    try {
      const resultado = await casosDeUso.cerrarSesionLectura({
        operador: obtenerOperador(),
        sesionLectura: normalizarSesion(sesion)
      })
      if (vigente()) {
        sesionLectura = null
        revision++
        mostrarMenu()
      }
      await resultado.sincronizar()
      await actualizarEstadoConexion()
    } catch (error) {
      if (vigente()) mostrarMensajeLectura(error.message, 'error')
    }
  }
  async function mostrarSesion() {
    if (!sesionLectura) return
    const vigente = comprobarVigencia()
    desactivarTecladoManual(dniJaberoLectura, ticketLectura)
    await mostrarSesionLecturaEnVista(sesionLectura, ui, consultas, {
      vigente: () => vigente() && activa(),
      enfocar: activa
    })
  }
  function mostrarMensajeLectura(mensaje, tipo) {
    ui.mensajeModuloLectura.textContent = mensaje
    ui.mensajeModuloLectura.className = `resultado ${tipo}`
  }
  function limpiar() {
    revision++
    if (dialogo.open) dialogo.close('cancelar')
    desactivarTecladoManual(dniJaberoLectura, ticketLectura)
    sesionLectura = null
    restaurables.limpiar()
    ui.configuracionLectura.classList.remove('oculto')
    ui.sesionLecturaActiva.classList.add('oculto')
    dniJaberoLectura.value = ''
    ticketLectura.value = ''
    ticketLectura.disabled = false
    mostrarEstadoLecturaTicket('', ui)
    mostrarMensajeLectura('', 'oculto')
    totalSesion.textContent = '0'
    mostrarContadorCosechador(null, 0, ui)
  }
  return Object.freeze({
    limpiar,
    obtenerSesion: () => sesionLectura,
    continuar,
    mostrarSesionesActivas: restaurables.mostrar,
    async volverALectura() {
      if (sesionLectura) await mostrarSesion()
      else if (activa()) loteLectura.focus()
    },
    async actualizarTotales() {
      if (!sesionLectura) return
      const vigente = comprobarVigencia()
      await actualizarTotalesLecturaEnVista(
        sesionLectura,
        { totalSesion, etiquetaCosechador, totalCosechador },
        consultas,
        { vigente }
      )
    }
  })
}
