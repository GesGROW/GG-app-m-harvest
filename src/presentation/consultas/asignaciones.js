import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'
import {
  filtrarAsignaciones,
  filtrarAsignacionesHoy,
  formatearHoraAsignacion,
  obtenerBadgeEstadoAsignacion
} from '@gesgrow/core/contexts/harvest/index.js'

export function crearConsultaAsignaciones({
  document,
  elementos,
  consultas,
  obtenerConfiguracion
}) {
  const {
    consultaBusqueda,
    consultaChips,
    consultaTablaHead,
    consultaTablaBody,
    consultaEmpty,
    consultaContador
  } = elementos

  let ticketsConsultaActual = []

  async function prepararConsultaAsignadosHoy({ vigente = () => true } = {}) {
    consultaBusqueda.placeholder = 'Buscar DNI, nombre o ticket...'
    const datos = await consultas.asignaciones()
    if (!vigente()) return
    ticketsConsultaActual = datos
    consultaChips.replaceChildren()
    consultaChips.classList.add('oculto')

    consultaTablaHead.replaceChildren()
    const columnaFecha =
      obtenerConfiguracion()?.id === 'buscar-asignacion' ? 'Fecha / hora' : 'Hora'
    for (const columna of ['Cosechador', 'Ticket', columnaFecha]) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = columna
      consultaTablaHead.append(th)
    }

    renderAsignadosHoy()
  }

  function renderAsignadosHoy({ vigente = () => true } = {}) {
    const esBusquedaGeneral = obtenerConfiguracion()?.id === 'buscar-asignacion'
    const filtrar = esBusquedaGeneral ? filtrarAsignaciones : filtrarAsignacionesHoy
    const asignacionesDisponibles = filtrar(ticketsConsultaActual)
    const asignaciones = filtrar(ticketsConsultaActual, {
      busqueda: consultaBusqueda.value
    })

    consultaTablaBody.replaceChildren()

    for (const ticket of asignaciones) {
      const fila = document.createElement('tr')

      const cosechadorCell = document.createElement('td')
      cosechadorCell.className = 'industrial-table__person'
      const nombre = document.createElement('strong')
      nombre.textContent = nombreCosechadorVisible(
        ticket.cosechador,
        ticket.cosechador_dni
      )
      const dni = document.createElement('span')
      dni.textContent = ticket.cosechador_dni || 'DNI no disponible'
      cosechadorCell.append(nombre, dni)

      const ticketCell = document.createElement('td')
      ticketCell.className = 'industrial-table__ticket'
      const codigo = document.createElement('strong')
      codigo.textContent = ticket.codigo_ticket
      ticketCell.append(codigo)

      const badge = obtenerBadgeEstadoAsignacion(ticket.estado_sync)
      if (badge) {
        const estado = document.createElement('span')
        estado.className = `sync-badge ${badge.clase}`
        estado.textContent = badge.etiqueta
        ticketCell.append(estado)
      }

      const horaCell = document.createElement('td')
      horaCell.className = 'industrial-table__numeric industrial-table__time'
      horaCell.textContent = formatearHoraAsignacion(ticket.fecha_asignacion)
      if (esBusquedaGeneral) {
        const fecha = new Date(ticket.fecha_asignacion)
        if (!Number.isNaN(fecha.getTime())) {
          const dia = document.createElement('span')
          dia.textContent = new Intl.DateTimeFormat('es-PE', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }).format(fecha)
          const hora = document.createElement('span')
          hora.textContent = horaCell.textContent
          horaCell.textContent = ''
          horaCell.append(dia, hora)
        }
      }

      fila.append(cosechadorCell, ticketCell, horaCell)
      consultaTablaBody.append(fila)
    }

    const total = asignaciones.length
    consultaContador.textContent = `${total} ${total === 1 ? 'asignación' : 'asignaciones'}`
    consultaContador.classList.remove('oculto')

    if (total > 0) {
      consultaEmpty.classList.add('oculto')
      return
    }

    const sinResultados = asignacionesDisponibles.length > 0
    consultaEmpty.querySelector('strong').textContent = sinResultados
      ? 'No se encontraron asignaciones.'
      : esBusquedaGeneral
        ? 'No hay asignaciones para mostrar.'
        : 'No hay tickets asignados hoy.'
    consultaEmpty.querySelector('p').textContent = sinResultados
      ? 'Pruebe otra búsqueda.'
      : 'Las nuevas asignaciones aparecerán aquí, incluso si se crean sin conexión.'
    consultaEmpty.classList.remove('oculto')
  }

  return { preparar: prepararConsultaAsignadosHoy, render: renderAsignadosHoy }
}
