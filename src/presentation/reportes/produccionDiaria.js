import {
  esErrorConexionProduccion,
  formatearFechaCalendario,
  reemplazarProduccionDiaria,
  resumirProduccionDiaria
} from '@gesgrow/core/contexts/harvest/index.js'
import { formatearNumero, formatearKg, totalPaquetes } from './formato.js'

export function crearVistaProduccionDiaria({
  document,
  mostrarVista,
  consultar,
  estaEnLinea
}) {
  const vistaProduccionDiaria = document.querySelector('#vista-produccion-diaria')
  const btnActualizarProduccion = document.querySelector('#btn-actualizar-produccion')
  const btnReintentarProduccion = document.querySelector('#btn-reintentar-produccion')
  const produccionCampania = document.querySelector('#produccion-campania')
  const produccionResumen = document.querySelector('#produccion-resumen')
  const produccionFeedback = document.querySelector('#produccion-feedback')
  const produccionTablaBody = document.querySelector('#produccion-tabla-body')
  const produccionEmpty = document.querySelector('#produccion-empty')

  let produccionDiariaActual = []
  let produccionDiariaCampaniaActual = ''

  async function abrirProduccionDiaria() {
    mostrarVista(vistaProduccionDiaria)

    if (produccionDiariaActual.length > 0) {
      produccionCampania.textContent =
        produccionDiariaCampaniaActual || 'Campaña activa'
      renderProduccionDiaria()
    } else {
      produccionCampania.textContent = 'Campaña activa'
      produccionResumen.classList.add('oculto')
      produccionTablaBody.replaceChildren()
      produccionEmpty.classList.add('oculto')
    }

    await cargarProduccionDiaria()
  }

  async function cargarProduccionDiaria() {
    btnActualizarProduccion.disabled = true
    btnReintentarProduccion.classList.add('oculto')
    mostrarFeedbackProduccion('Cargando producción…')

    if (!estaEnLinea()) {
      mostrarFeedbackProduccion(
        'No se puede actualizar la producción sin conexión.',
        'error',
        true
      )
      btnActualizarProduccion.disabled = false
      return
    }

    try {
      const respuesta = await consultar()
      produccionDiariaActual = reemplazarProduccionDiaria(
        produccionDiariaActual,
        respuesta.produccion
      )
      produccionDiariaCampaniaActual = respuesta.campania.nombre || 'Campaña activa'
      produccionCampania.textContent = produccionDiariaCampaniaActual
      ocultarFeedbackProduccion()
      renderProduccionDiaria()
    } catch (error) {
      const mensaje = esErrorConexionProduccion(error)
        ? 'No se puede actualizar la producción sin conexión.'
        : `No se pudo cargar la producción: ${error.message}`
      mostrarFeedbackProduccion(mensaje, 'error', true)

      if (produccionDiariaActual.length === 0) {
        produccionResumen.classList.add('oculto')
        produccionTablaBody.replaceChildren()
        produccionEmpty.classList.add('oculto')
      }
    } finally {
      btnActualizarProduccion.disabled = false
    }
  }

  function renderProduccionDiaria() {
    const resumen = resumirProduccionDiaria(produccionDiariaActual)
    produccionResumen.textContent = `${formatearNumero(totalPaquetes(produccionDiariaActual))} paquetes | ${formatearNumero(resumen.dias)} ${
      resumen.dias === 1 ? 'día con producción' : 'días con producción'
    }`
    produccionResumen.classList.remove('oculto')
    produccionTablaBody.replaceChildren()

    for (const fila of produccionDiariaActual) {
      const tr = document.createElement('tr')

      const fecha = document.createElement('td')
      fecha.className = 'produccion-table__date'
      const fechaPrincipal = document.createElement('strong')
      fechaPrincipal.textContent = formatearFechaCalendario(fila.fecha)
      const sesiones = document.createElement('span')
      sesiones.textContent = `${formatearNumero(fila.total_sesiones)} ${
        fila.total_sesiones === 1 ? 'sesión' : 'sesiones'
      }`
      fecha.append(fechaPrincipal, sesiones)

      const jabas = document.createElement('td')
      jabas.className = 'industrial-table__numeric produccion-table__metric'
      const totalJabas = document.createElement('strong')
      totalJabas.textContent = formatearNumero(fila.total_jabas)
      jabas.append(totalJabas)

      const cosechadores = document.createElement('td')
      cosechadores.className = 'industrial-table__numeric produccion-table__metric'
      const totalCosechadores = document.createElement('strong')
      totalCosechadores.textContent = formatearNumero(fila.total_cosechadores)
      cosechadores.append(totalCosechadores)

      const metricas = [
        formatearNumero(fila.total_paquetes ?? fila.total_jabas),
        formatearNumero(fila.total_jarras),
        formatearKg(fila.kg_estimados, fila.total_paquetes ?? fila.total_jabas)
      ].map((valor) => {
        const td = document.createElement('td')
        td.className = 'industrial-table__numeric'
        td.textContent = valor
        return td
      })
      tr.append(fecha, metricas[0], jabas, metricas[1], metricas[2], cosechadores)
      produccionTablaBody.append(tr)
    }

    produccionEmpty.classList.toggle('oculto', produccionDiariaActual.length > 0)
  }

  function mostrarFeedbackProduccion(mensaje, tipo = '', permitirReintento = false) {
    produccionFeedback.textContent = mensaje
    produccionFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
    btnReintentarProduccion.classList.toggle('oculto', !permitirReintento)
  }

  function ocultarFeedbackProduccion() {
    produccionFeedback.textContent = ''
    produccionFeedback.className = 'resultado ranking-feedback oculto'
    btnReintentarProduccion.classList.add('oculto')
  }

  btnActualizarProduccion.addEventListener('click', cargarProduccionDiaria)
  btnReintentarProduccion.addEventListener('click', cargarProduccionDiaria)

  return {
    abrir: abrirProduccionDiaria,
    reiniciar() {
      produccionDiariaActual = []
      produccionDiariaCampaniaActual = ''
    }
  }
}
