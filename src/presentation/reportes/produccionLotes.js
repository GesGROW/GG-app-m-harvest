import {
  ORDEN_PRODUCCION_LOTES,
  buscarProduccionLotes,
  esErrorConexionProduccionLotes,
  formatearUltimaLecturaLote,
  ordenarProduccionLotes,
  reemplazarProduccionLotes,
  resumirProduccionLotes
} from '@gesgrow/core/contexts/harvest/index.js'
import { formatearNumero } from './formato.js'

export function crearVistaProduccionLotes({
  document,
  mostrarVista,
  consultar,
  estaEnLinea,
  obtenerLotes
}) {
  const vistaProduccionLotes = document.querySelector('#vista-produccion-lotes')
  const btnActualizarLotes = document.querySelector('#btn-actualizar-lotes')
  const btnReintentarLotes = document.querySelector('#btn-reintentar-lotes')
  const btnOrdenLotesJabas = document.querySelector('#btn-orden-lotes-jabas')
  const btnOrdenLotesAz = document.querySelector('#btn-orden-lotes-az')
  const lotesCampania = document.querySelector('#lotes-campania')
  const lotesBusqueda = document.querySelector('#lotes-busqueda')
  const lotesResumen = document.querySelector('#lotes-resumen')
  const lotesFeedback = document.querySelector('#lotes-feedback')
  const lotesLista = document.querySelector('#lotes-lista')
  const lotesEmpty = document.querySelector('#lotes-empty')

  let produccionLotesActual = []
  let produccionLotesCampaniaActual = ''
  let ordenProduccionLotes = ORDEN_PRODUCCION_LOTES.MAS_JABAS

  async function abrirProduccionLotes() {
    lotesBusqueda.value = ''
    ordenProduccionLotes = ORDEN_PRODUCCION_LOTES.MAS_JABAS
    actualizarControlesOrdenLotes()
    mostrarVista(vistaProduccionLotes)

    if (produccionLotesActual.length > 0) {
      lotesCampania.textContent = produccionLotesCampaniaActual || 'Campaña activa'
      renderProduccionLotes()
    } else {
      lotesCampania.textContent = 'Campaña activa'
      lotesResumen.classList.add('oculto')
      lotesLista.replaceChildren()
      lotesEmpty.classList.add('oculto')
    }

    await cargarProduccionLotes()
    lotesBusqueda.focus()
  }

  async function cargarProduccionLotes() {
    btnActualizarLotes.disabled = true
    btnReintentarLotes.classList.add('oculto')
    mostrarFeedbackLotes('Cargando producción por lote…')

    if (!estaEnLinea()) {
      mostrarFeedbackLotes(
        'No se puede actualizar la producción por lote sin conexión.',
        'error',
        true
      )
      btnActualizarLotes.disabled = false
      return
    }

    try {
      const respuesta = await consultar()
      const lotes = await obtenerLotes()
      const nombresLotes = new Map(lotes.map((lote) => [lote.lote_id, lote.nombre]))
      produccionLotesActual = reemplazarProduccionLotes(
        produccionLotesActual,
        respuesta.produccion.map((fila) => ({
          ...fila,
          lote_nombre:
            nombresLotes.get(fila.lote_id)?.trim() ||
            fila.lote_nombre?.trim() ||
            'Lote sin nombre'
        }))
      )
      produccionLotesCampaniaActual = respuesta.campania.nombre || 'Campaña activa'
      lotesCampania.textContent = produccionLotesCampaniaActual
      ocultarFeedbackLotes()
      renderProduccionLotes()
    } catch (error) {
      const mensaje = esErrorConexionProduccionLotes(error)
        ? 'No se puede actualizar la producción por lote sin conexión.'
        : `No se pudo cargar la producción por lote: ${error.message}`
      mostrarFeedbackLotes(mensaje, 'error', true)

      if (produccionLotesActual.length === 0) {
        lotesResumen.classList.add('oculto')
        lotesLista.replaceChildren()
        lotesEmpty.classList.add('oculto')
      }
    } finally {
      btnActualizarLotes.disabled = false
    }
  }

  function renderProduccionLotes() {
    const resumen = resumirProduccionLotes(produccionLotesActual)
    lotesResumen.textContent = `${formatearNumero(resumen.lotes)} ${
      resumen.lotes === 1 ? 'lote' : 'lotes'
    } · ${formatearNumero(resumen.jabas)} ${resumen.jabas === 1 ? 'jaba' : 'jabas'}`
    lotesResumen.classList.remove('oculto')

    const filtradas = buscarProduccionLotes(produccionLotesActual, lotesBusqueda.value)
    const filas = ordenarProduccionLotes(filtradas, ordenProduccionLotes)
    if (ordenProduccionLotes === ORDEN_PRODUCCION_LOTES.AZ) {
      filas.sort(
        (a, b) =>
          a.lote_nombre.localeCompare(b.lote_nombre, 'es', { sensitivity: 'base' }) ||
          a.variedad.localeCompare(b.variedad, 'es', { sensitivity: 'base' })
      )
    }
    lotesLista.replaceChildren()

    for (const fila of filas) {
      const articulo = document.createElement('article')
      articulo.className = 'lote-report-card'

      const cabecera = document.createElement('div')
      cabecera.className = 'lote-report-card__header'

      const identidad = document.createElement('div')
      identidad.className = 'lote-report-card__identity'
      const nombre = document.createElement('strong')
      nombre.textContent = fila.lote_nombre?.trim() || 'Lote sin nombre'
      const variedad = document.createElement('span')
      variedad.textContent = fila.variedad || 'Variedad no disponible'
      identidad.append(nombre, variedad)

      const produccion = document.createElement('div')
      produccion.className = 'lote-report-card__production'
      const total = document.createElement('strong')
      total.textContent = formatearNumero(fila.total_jabas)
      const unidad = document.createElement('span')
      unidad.textContent = fila.total_jabas === 1 ? 'jaba' : 'jabas'
      produccion.append(total, unidad)

      cabecera.append(identidad, produccion)
      articulo.append(cabecera)

      const metricas = document.createElement('div')
      metricas.className = 'lote-report-card__metrics'
      metricas.append(
        crearMetricaLote('Cosechadores', formatearNumero(fila.total_cosechadores)),
        crearMetricaLote('Sesiones', formatearNumero(fila.total_sesiones)),
        crearMetricaLote('Última', formatearUltimaLecturaLote(fila.ultima_lectura))
      )
      articulo.append(metricas)
      lotesLista.append(articulo)
    }

    if (filas.length > 0) {
      lotesEmpty.classList.add('oculto')
      return
    }

    const hayBusqueda = lotesBusqueda.value.trim().length > 0
    lotesEmpty.querySelector('strong').textContent = hayBusqueda
      ? 'No se encontraron lotes.'
      : 'Aún no hay producción por lote en esta campaña.'
    lotesEmpty.querySelector('p').textContent = hayBusqueda
      ? 'Pruebe con otro lote o variedad.'
      : 'Las lecturas sincronizadas aparecerán aquí.'
    lotesEmpty.classList.remove('oculto')
  }

  function crearMetricaLote(etiqueta, valor) {
    const metrica = document.createElement('div')
    metrica.className = 'lote-report-card__metric'
    const label = document.createElement('span')
    label.textContent = etiqueta
    const contenido = document.createElement('strong')
    contenido.textContent = valor
    metrica.append(label, contenido)
    return metrica
  }

  function actualizarControlesOrdenLotes() {
    const porJabas = ordenProduccionLotes === ORDEN_PRODUCCION_LOTES.MAS_JABAS
    btnOrdenLotesJabas.classList.toggle('selected', porJabas)
    btnOrdenLotesJabas.setAttribute('aria-pressed', String(porJabas))
    btnOrdenLotesAz.classList.toggle('selected', !porJabas)
    btnOrdenLotesAz.setAttribute('aria-pressed', String(!porJabas))
  }

  function cambiarOrdenProduccionLotes(orden) {
    ordenProduccionLotes = orden
    actualizarControlesOrdenLotes()
    renderProduccionLotes()
  }

  function mostrarFeedbackLotes(mensaje, tipo = '', permitirReintento = false) {
    lotesFeedback.textContent = mensaje
    lotesFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
    btnReintentarLotes.classList.toggle('oculto', !permitirReintento)
  }

  function ocultarFeedbackLotes() {
    lotesFeedback.textContent = ''
    lotesFeedback.className = 'resultado ranking-feedback oculto'
    btnReintentarLotes.classList.add('oculto')
  }

  lotesBusqueda.addEventListener('input', renderProduccionLotes)
  btnActualizarLotes.addEventListener('click', cargarProduccionLotes)
  btnReintentarLotes.addEventListener('click', cargarProduccionLotes)
  btnOrdenLotesJabas.addEventListener('click', () =>
    cambiarOrdenProduccionLotes(ORDEN_PRODUCCION_LOTES.MAS_JABAS)
  )
  btnOrdenLotesAz.addEventListener('click', () =>
    cambiarOrdenProduccionLotes(ORDEN_PRODUCCION_LOTES.AZ)
  )

  return {
    abrir: abrirProduccionLotes,
    reiniciar() {
      produccionLotesActual = []
      produccionLotesCampaniaActual = ''
    }
  }
}
