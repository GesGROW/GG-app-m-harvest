import {
  esErrorConexionResumenCampania,
  formatearFechaInicioCampania,
  formatearNumeroResumen,
  formatearUltimaActividad,
  reemplazarResumenCampania
} from '@gesgrow/core/contexts/harvest/index.js'
import { formatearKg } from './formato.js'

export function crearVistaResumenCampania({
  document,
  mostrarVista,
  consultar,
  estaEnLinea
}) {
  const vistaResumenCampania = document.querySelector('#vista-resumen-campania')
  const btnActualizarResumen = document.querySelector('#btn-actualizar-resumen')
  const btnReintentarResumen = document.querySelector('#btn-reintentar-resumen')
  const resumenCampaniaNombre = document.querySelector('#resumen-campania-nombre')
  const resumenCampaniaFecha = document.querySelector('#resumen-campania-fecha')
  const resumenCampaniaFeedback = document.querySelector('#resumen-campania-feedback')
  const resumenCampaniaContenido = document.querySelector('#resumen-campania-contenido')
  const resumenTotalJabas = document.querySelector('#resumen-total-jabas')
  const resumenTotalPaquetes = document.querySelector('#resumen-total-paquetes')
  const resumenTotalJarras = document.querySelector('#resumen-total-jarras')
  const resumenKgEstimados = document.querySelector('#resumen-kg-estimados')
  const resumenTotalCosechadores = document.querySelector('#resumen-total-cosechadores')
  const resumenTotalLotes = document.querySelector('#resumen-total-lotes')
  const resumenTotalSesiones = document.querySelector('#resumen-total-sesiones')
  const resumenDiasProduccion = document.querySelector('#resumen-dias-produccion')
  const resumenUltimaActividad = document.querySelector('#resumen-ultima-actividad')
  const resumenCampaniaEmpty = document.querySelector('#resumen-campania-empty')

  let resumenCampaniaActual = null

  async function abrirResumenCampania() {
    mostrarVista(vistaResumenCampania)

    if (resumenCampaniaActual) {
      renderResumenCampania()
    } else {
      resumenCampaniaNombre.textContent = 'Campaña activa'
      resumenCampaniaFecha.classList.add('oculto')
      resumenCampaniaContenido.classList.add('oculto')
    }

    await cargarResumenCampania()
  }

  async function cargarResumenCampania() {
    btnActualizarResumen.disabled = true
    btnReintentarResumen.classList.add('oculto')
    mostrarFeedbackResumenCampania('Cargando resumen…')

    if (!estaEnLinea()) {
      mostrarFeedbackResumenCampania(
        'No se puede actualizar el resumen sin conexión.',
        'error',
        true
      )
      btnActualizarResumen.disabled = false
      return
    }

    try {
      const respuesta = await consultar()
      resumenCampaniaActual = reemplazarResumenCampania(
        resumenCampaniaActual,
        respuesta
      )
      ocultarFeedbackResumenCampania()
      renderResumenCampania()
    } catch (error) {
      const mensaje = esErrorConexionResumenCampania(error)
        ? 'No se puede actualizar el resumen sin conexión.'
        : `No se pudo cargar el resumen: ${error.message}`
      mostrarFeedbackResumenCampania(mensaje, 'error', true)

      if (!resumenCampaniaActual) {
        resumenCampaniaContenido.classList.add('oculto')
      }
    } finally {
      btnActualizarResumen.disabled = false
    }
  }

  function renderResumenCampania() {
    if (!resumenCampaniaActual) return

    const { campania, resumen } = resumenCampaniaActual
    resumenCampaniaNombre.textContent = campania.nombre || 'Campaña activa'

    const fechaInicio = formatearFechaInicioCampania(campania.fecha_inicio)
    resumenCampaniaFecha.textContent = fechaInicio ? `Desde ${fechaInicio}` : ''
    resumenCampaniaFecha.classList.toggle('oculto', !fechaInicio)

    resumenTotalJabas.textContent = formatearNumeroResumen(resumen.total_jabas)
    resumenTotalPaquetes.textContent = formatearNumeroResumen(
      resumen.total_paquetes ?? resumen.total_jabas
    )
    resumenTotalJarras.textContent = formatearNumeroResumen(resumen.total_jarras)
    resumenKgEstimados.textContent = formatearKg(
      resumen.kg_estimados,
      resumen.total_paquetes ?? resumen.total_jabas
    )
    resumenTotalCosechadores.textContent = formatearNumeroResumen(
      resumen.total_cosechadores
    )
    resumenTotalLotes.textContent = formatearNumeroResumen(resumen.total_lotes)
    resumenTotalSesiones.textContent = formatearNumeroResumen(resumen.total_sesiones)
    resumenDiasProduccion.textContent = formatearNumeroResumen(
      resumen.dias_con_produccion
    )
    resumenUltimaActividad.textContent = formatearUltimaActividad(
      resumen.ultima_lectura
    )
    resumenCampaniaEmpty.classList.toggle(
      'oculto',
      (resumen.total_paquetes ?? resumen.total_jabas) > 0
    )
    resumenCampaniaContenido.classList.remove('oculto')
  }

  function mostrarFeedbackResumenCampania(
    mensaje,
    tipo = '',
    permitirReintento = false
  ) {
    resumenCampaniaFeedback.textContent = mensaje
    resumenCampaniaFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
    btnReintentarResumen.classList.toggle('oculto', !permitirReintento)
  }

  function ocultarFeedbackResumenCampania() {
    resumenCampaniaFeedback.textContent = ''
    resumenCampaniaFeedback.className = 'resultado ranking-feedback oculto'
    btnReintentarResumen.classList.add('oculto')
  }

  btnActualizarResumen.addEventListener('click', cargarResumenCampania)
  btnReintentarResumen.addEventListener('click', cargarResumenCampania)

  return {
    abrir: abrirResumenCampania,
    reiniciar() {
      resumenCampaniaActual = null
    }
  }
}
