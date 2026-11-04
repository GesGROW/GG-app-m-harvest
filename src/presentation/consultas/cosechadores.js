import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'
import {
  ORDEN_COSECHADORES_JABAS,
  buscarCosechadoresJabas,
  formatearHoraUltimaLectura,
  ordenarCosechadoresJabas,
  resumirCosechadoresJabas
} from '@gesgrow/core/contexts/harvest/index.js'

export function crearConsultaCosechadores({
  document,
  elementos,
  consultas,
  obtenerSesionLectura
}) {
  const {
    consultaBusqueda,
    consultaChips,
    consultaTablaHead,
    consultaTablaBody,
    consultaEmpty,
    consultaEmptyAccion,
    consultaContador
  } = elementos

  let cosechadoresJabasActual = []
  let ordenCosechadoresJabas = ORDEN_COSECHADORES_JABAS.MAS_JABAS

  async function prepararConsultaCosechadoresJabas({
    conservarFiltros = false,
    vigente = () => true
  } = {}) {
    consultaBusqueda.placeholder = 'Buscar nombre o DNI...'
    consultaChips.classList.add('filter-chips--wrap')
    if (!conservarFiltros) ordenCosechadoresJabas = ORDEN_COSECHADORES_JABAS.MAS_JABAS

    const filtros = [
      ['Más jabas', ORDEN_COSECHADORES_JABAS.MAS_JABAS],
      ['Recientes', ORDEN_COSECHADORES_JABAS.RECIENTES],
      ['A–Z', ORDEN_COSECHADORES_JABAS.AZ]
    ]

    consultaChips.replaceChildren()
    filtros.forEach(([etiqueta, valor]) => {
      const boton = document.createElement('button')
      boton.type = 'button'
      boton.className = `filter-chip${valor === ordenCosechadoresJabas ? ' selected' : ''}`
      boton.textContent = etiqueta
      boton.dataset.orden = valor
      boton.setAttribute('aria-pressed', String(valor === ordenCosechadoresJabas))
      boton.addEventListener('click', () => {
        ordenCosechadoresJabas = valor
        consultaChips.querySelectorAll('.filter-chip').forEach((item) => {
          const seleccionado = item === boton
          item.classList.toggle('selected', seleccionado)
          item.setAttribute('aria-pressed', String(seleccionado))
        })
        renderCosechadoresJabas()
      })
      consultaChips.append(boton)
    })

    consultaTablaHead.replaceChildren()
    for (const columna of ['Cosechador', 'Jabas', 'Última']) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = columna
      consultaTablaHead.append(th)
    }

    if (!obtenerSesionLectura()?.sesion_id) {
      cosechadoresJabasActual = []
      renderCosechadoresJabas()
      return
    }

    const datos = await consultas.cosechadores()
    if (!vigente()) return
    cosechadoresJabasActual = datos
    renderCosechadoresJabas()
  }

  function renderCosechadoresJabas() {
    consultaTablaBody.replaceChildren()

    if (!obtenerSesionLectura()?.sesion_id) {
      consultaBusqueda.disabled = true
      consultaChips.classList.add('oculto')
      consultaContador.classList.add('oculto')
      consultaEmpty.querySelector('strong').textContent =
        'No hay una sesión de lectura activa.'
      consultaEmpty.querySelector('p').textContent =
        'Vuelva a lectura para iniciar o restaurar una sesión.'
      consultaEmptyAccion.classList.remove('oculto')
      consultaEmpty.classList.remove('oculto')
      return
    }

    consultaBusqueda.disabled = false
    consultaChips.classList.remove('oculto')
    consultaEmptyAccion.classList.add('oculto')

    const resumen = resumirCosechadoresJabas(cosechadoresJabasActual)
    consultaContador.textContent = `${resumen.cosechadores} ${
      resumen.cosechadores === 1 ? 'cosechador' : 'cosechadores'
    } · ${resumen.jabas} ${resumen.jabas === 1 ? 'jaba' : 'jabas'}`
    consultaContador.classList.remove('oculto')

    const cosechadores = ordenarCosechadoresJabas(
      buscarCosechadoresJabas(cosechadoresJabasActual, consultaBusqueda.value),
      ordenCosechadoresJabas
    )

    for (const cosechador of cosechadores) {
      const fila = document.createElement('tr')

      const personaCell = document.createElement('td')
      personaCell.className = 'industrial-table__person'
      const nombre = document.createElement('strong')
      nombre.textContent = nombreCosechadorVisible(cosechador.nombre, cosechador.dni)
      const dni = document.createElement('span')
      dni.textContent = cosechador.dni || 'DNI no disponible'
      personaCell.append(nombre, dni)

      const jabasCell = document.createElement('td')
      jabasCell.className = 'industrial-table__numeric industrial-table__count'
      jabasCell.textContent = cosechador.jabas

      const ultimaCell = document.createElement('td')
      ultimaCell.className = 'industrial-table__numeric industrial-table__time'
      ultimaCell.textContent = formatearHoraUltimaLectura(cosechador.ultimaLectura)

      fila.append(personaCell, jabasCell, ultimaCell)
      consultaTablaBody.append(fila)
    }

    if (cosechadores.length > 0) {
      consultaEmpty.classList.add('oculto')
      return
    }

    const hayBusqueda = consultaBusqueda.value.trim().length > 0
    consultaEmpty.querySelector('strong').textContent = hayBusqueda
      ? 'No se encontraron cosechadores.'
      : 'Aún no se han registrado jabas en esta sesión.'
    consultaEmpty.querySelector('p').textContent = hayBusqueda
      ? 'Pruebe con otro nombre o DNI.'
      : 'Las nuevas lecturas aparecerán aquí al volver desde Escanear.'
    consultaEmpty.classList.remove('oculto')
  }

  return {
    preparar: prepararConsultaCosechadoresJabas,
    render: renderCosechadoresJabas
  }
}
