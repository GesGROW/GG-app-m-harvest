import {
  buscarRankingCosechadores,
  esErrorConexionRanking,
  formatearUltimaLectura,
  reemplazarRankingCosechadores,
  resumirRankingCosechadores
} from '@gesgrow/core/contexts/harvest/index.js'
import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'
import { formatearNumero } from './formato.js'

export function crearVistaRankingCosechadores({
  document,
  mostrarVista,
  consultar,
  estaEnLinea
}) {
  const vistaRankingCosechadores = document.querySelector('#vista-ranking-cosechadores')
  const btnActualizarRanking = document.querySelector('#btn-actualizar-ranking')
  const rankingCampania = document.querySelector('#ranking-campania')
  const rankingBusqueda = document.querySelector('#ranking-busqueda')
  const rankingPeriodo = document.querySelector('#ranking-periodo')
  const rankingResumen = document.querySelector('#ranking-resumen')
  const rankingFeedback = document.querySelector('#ranking-feedback')
  const rankingTablaBody = document.querySelector('#ranking-tabla-body')
  const rankingEmpty = document.querySelector('#ranking-empty')

  let rankingCosechadoresActual = []

  async function abrirRankingCosechadores() {
    rankingPeriodo.value = 'HOY'
    rankingBusqueda.value = ''
    rankingCosechadoresActual = []
    rankingCampania.textContent = 'Campaña activa'
    rankingResumen.classList.add('oculto')
    rankingTablaBody.replaceChildren()
    rankingEmpty.classList.add('oculto')
    mostrarVista(vistaRankingCosechadores)
    await cargarRankingCosechadores()
    rankingBusqueda.focus()
  }

  async function cargarRankingCosechadores() {
    if (btnActualizarRanking.disabled) return
    btnActualizarRanking.disabled = true
    rankingPeriodo.disabled = true
    mostrarFeedbackRanking('Cargando ranking…')

    if (!estaEnLinea()) {
      mostrarFeedbackRanking('No se puede actualizar el ranking sin conexión.', 'error')
      btnActualizarRanking.disabled = false
      rankingPeriodo.disabled = false
      return
    }

    try {
      const respuesta = await consultar(rankingPeriodo.value)
      rankingCosechadoresActual = reemplazarRankingCosechadores(
        rankingCosechadoresActual,
        respuesta.ranking
      )
      rankingCampania.textContent = respuesta.campania || 'Campaña activa'
      ocultarFeedbackRanking()
      renderRankingCosechadores()
    } catch (error) {
      const mensaje = esErrorConexionRanking(error)
        ? 'No se puede actualizar el ranking sin conexión.'
        : `No se pudo cargar el ranking: ${error.message}`
      mostrarFeedbackRanking(mensaje, 'error')

      if (rankingCosechadoresActual.length === 0) {
        rankingResumen.classList.add('oculto')
        rankingTablaBody.replaceChildren()
        rankingEmpty.classList.add('oculto')
      }
    } finally {
      btnActualizarRanking.disabled = false
      rankingPeriodo.disabled = false
    }
  }

  function renderRankingCosechadores() {
    const resumen = resumirRankingCosechadores(rankingCosechadoresActual)
    rankingResumen.textContent = `${formatearNumero(resumen.cosechadores)} ${
      resumen.cosechadores === 1 ? 'cosechador' : 'cosechadores'
    } · ${formatearNumero(resumen.jabas)} ${resumen.jabas === 1 ? 'jaba' : 'jabas'}`
    rankingResumen.classList.remove('oculto')

    const filas = buscarRankingCosechadores(
      rankingCosechadoresActual,
      rankingBusqueda.value
    )
    rankingTablaBody.replaceChildren()

    for (const fila of filas) {
      const tr = document.createElement('tr')

      const posicion = document.createElement('td')
      posicion.className = 'ranking-table__position'
      posicion.textContent = fila.posicion

      const persona = document.createElement('td')
      persona.className = 'industrial-table__person'
      const nombre = document.createElement('strong')
      nombre.textContent = nombreCosechadorVisible(fila.cosechador, fila.cosechador_dni)
      const dni = document.createElement('span')
      dni.textContent = fila.cosechador_dni || 'DNI no disponible'
      persona.append(nombre, dni)

      const produccion = document.createElement('td')
      produccion.className =
        'industrial-table__numeric industrial-table__count ranking-table__metric'
      const total = document.createElement('strong')
      total.textContent = formatearNumero(fila.total_jabas)
      const ultima = document.createElement('span')
      ultima.textContent = formatearUltimaLectura(fila.ultima_lectura)
      produccion.append(total, ultima)

      tr.append(posicion, persona, produccion)
      rankingTablaBody.append(tr)
    }

    if (filas.length > 0) {
      rankingEmpty.classList.add('oculto')
      return
    }

    const hayBusqueda = rankingBusqueda.value.trim().length > 0
    rankingEmpty.querySelector('strong').textContent = hayBusqueda
      ? 'No se encontraron cosechadores.'
      : 'Aún no hay jabas registradas en este período.'
    rankingEmpty.querySelector('p').textContent = hayBusqueda
      ? 'Pruebe con otro nombre o DNI.'
      : 'Las lecturas sincronizadas aparecerán aquí.'
    rankingEmpty.classList.remove('oculto')
  }

  function mostrarFeedbackRanking(mensaje, tipo = '') {
    rankingFeedback.textContent = mensaje
    rankingFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
  }

  function ocultarFeedbackRanking() {
    rankingFeedback.textContent = ''
    rankingFeedback.className = 'resultado ranking-feedback oculto'
  }

  rankingBusqueda.addEventListener('input', renderRankingCosechadores)
  rankingPeriodo.addEventListener('change', () => {
    rankingCosechadoresActual = []
    rankingResumen.classList.add('oculto')
    rankingTablaBody.replaceChildren()
    rankingEmpty.classList.add('oculto')
    cargarRankingCosechadores()
  })
  btnActualizarRanking.addEventListener('click', cargarRankingCosechadores)

  return {
    abrir: abrirRankingCosechadores,
    reiniciar() {
      rankingCosechadoresActual = []
    }
  }
}
