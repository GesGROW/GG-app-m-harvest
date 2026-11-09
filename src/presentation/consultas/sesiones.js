import { describirRecipientes } from '../../application/resumenRecipientes.js'
import {
  FILTROS_SESIONES_LECTURA,
  filtrarSesionesLectura,
  formatearPeriodoSesion,
  obtenerBadgeEstadoSesion
} from '@gesgrow/core/contexts/harvest/index.js'

export function crearConsultaSesiones({
  document,
  elementos,
  consultas,
  abrirDetalleSesionLectura
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

  let sesionesConsultaActual = []
  let filtroSesionesLectura = FILTROS_SESIONES_LECTURA.TODAS

  async function prepararConsultaSesionesLectura({
    conservarFiltros = false,
    vigente = () => true
  } = {}) {
    consultaBusqueda.placeholder = 'Buscar jabero, DNI, lote o variedad...'
    consultaBusqueda.disabled = false
    consultaChips.classList.remove('oculto', 'filter-chips--wrap')
    consultaEmptyAccion.classList.add('oculto')
    if (!conservarFiltros) filtroSesionesLectura = FILTROS_SESIONES_LECTURA.TODAS

    const datos = await consultas.sesiones()
    if (!vigente()) return
    sesionesConsultaActual = datos

    const filtros = [
      ['Todas', FILTROS_SESIONES_LECTURA.TODAS],
      ['Activas', FILTROS_SESIONES_LECTURA.ACTIVAS],
      ['Cerradas', FILTROS_SESIONES_LECTURA.CERRADAS]
    ]

    consultaChips.replaceChildren()
    filtros.forEach(([etiqueta, valor]) => {
      const boton = document.createElement('button')
      boton.type = 'button'
      boton.className = `filter-chip${valor === filtroSesionesLectura ? ' selected' : ''}`
      boton.textContent = etiqueta
      boton.dataset.filtro = valor
      boton.setAttribute('aria-pressed', String(valor === filtroSesionesLectura))
      boton.addEventListener('click', () => {
        filtroSesionesLectura = valor
        consultaChips.querySelectorAll('.filter-chip').forEach((item) => {
          const seleccionado = item === boton
          item.classList.toggle('selected', seleccionado)
          item.setAttribute('aria-pressed', String(seleccionado))
        })
        renderSesionesLectura()
      })
      consultaChips.append(boton)
    })

    consultaTablaHead.replaceChildren()
    for (const columna of ['Jabero / lote', 'Jabas', 'Estado']) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = columna
      consultaTablaHead.append(th)
    }

    renderSesionesLectura()
  }

  function renderSesionesLectura() {
    const busqueda = consultaBusqueda.value.trim().toLocaleLowerCase('es-PE')
    const sesiones = filtrarSesionesLectura(sesionesConsultaActual, {
      filtro: filtroSesionesLectura
    }).filter(
      (sesion) =>
        !busqueda ||
        [sesion.jabero, sesion.dni_jabero, sesion.lote_nombre, sesion.variedad].some(
          (valor) =>
            String(valor ?? '')
              .toLocaleLowerCase('es-PE')
              .includes(busqueda)
        )
    )

    consultaTablaBody.replaceChildren()

    for (const sesion of sesiones) {
      const fila = document.createElement('tr')
      fila.className = 'industrial-table__row--interactive'
      fila.tabIndex = 0
      fila.setAttribute('role', 'button')
      fila.setAttribute(
        'aria-label',
        `Ver sesión de ${sesion.jabero || sesion.dni_jabero || 'jabero sin identificar'}`
      )

      const resumenCell = document.createElement('td')
      resumenCell.className = 'industrial-table__person session-row__summary'
      const jabero = document.createElement('strong')
      jabero.textContent =
        sesion.jabero || sesion.dni_jabero || 'Jabero sin identificar'
      const lote = document.createElement('span')
      lote.textContent =
        [sesion.lote_nombre || 'Lote sin nombre', sesion.variedad]
          .filter(Boolean)
          .join(' · ') || 'Lote no disponible'
      const periodo = document.createElement('span')
      periodo.className = 'session-row__time'
      periodo.textContent = formatearPeriodoSesion(sesion)
      resumenCell.append(jabero, lote, periodo)

      const jabasCell = document.createElement('td')
      jabasCell.className = 'industrial-table__numeric industrial-table__count'
      const r = sesion.recipientes
      jabasCell.textContent = r ? describirRecipientes(r) : sesion.total_jabas

      const estadoCell = document.createElement('td')
      const badge = obtenerBadgeEstadoSesion(sesion.estado)
      if (badge) {
        const estado = document.createElement('span')
        estado.className = `sync-badge ${badge.clase}`
        estado.textContent = badge.etiqueta
        estadoCell.append(estado)
      } else {
        estadoCell.textContent = sesion.estado || '—'
      }

      const abrirDetalle = () => abrirDetalleSesionLectura(sesion)
      fila.addEventListener('click', abrirDetalle)
      fila.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        abrirDetalle()
      })

      fila.append(resumenCell, jabasCell, estadoCell)
      consultaTablaBody.append(fila)
    }

    const total = sesiones.length
    if (filtroSesionesLectura === FILTROS_SESIONES_LECTURA.ACTIVAS) {
      consultaContador.textContent = `${total} ${total === 1 ? 'sesión activa' : 'sesiones activas'}`
    } else if (filtroSesionesLectura === FILTROS_SESIONES_LECTURA.CERRADAS) {
      consultaContador.textContent = `${total} ${total === 1 ? 'sesión cerrada' : 'sesiones cerradas'}`
    } else {
      consultaContador.textContent = `${total} ${total === 1 ? 'sesión' : 'sesiones'}`
    }
    consultaContador.classList.remove('oculto')

    if (total > 0) {
      consultaEmpty.classList.add('oculto')
      return
    }

    const hayBusqueda = consultaBusqueda.value.trim().length > 0
    let titulo = 'No hay sesiones registradas en este dispositivo.'
    let detalle = 'Las sesiones creadas en este PDA aparecerán aquí.'

    if (hayBusqueda) {
      titulo = 'No se encontraron sesiones.'
      detalle = 'Pruebe con otro jabero, DNI, lote o variedad.'
    } else if (
      sesionesConsultaActual.length > 0 &&
      filtroSesionesLectura === FILTROS_SESIONES_LECTURA.ACTIVAS
    ) {
      titulo = 'No hay sesiones activas.'
      detalle = 'Las sesiones activas aparecerán aquí mientras estén abiertas.'
    } else if (
      sesionesConsultaActual.length > 0 &&
      filtroSesionesLectura === FILTROS_SESIONES_LECTURA.CERRADAS
    ) {
      titulo = 'No hay sesiones cerradas.'
      detalle = 'Las sesiones finalizadas aparecerán aquí.'
    }

    consultaEmpty.querySelector('strong').textContent = titulo
    consultaEmpty.querySelector('p').textContent = detalle
    consultaEmpty.classList.remove('oculto')
  }

  return { preparar: prepararConsultaSesionesLectura, render: renderSesionesLectura }
}
