import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'
import {
  filtrarJaberosCampania,
  obtenerBadgeEstadoJabero
} from '@gesgrow/core/contexts/workforce/index.js'

export function crearConsultaJaberos({ document, elementos, consultas }) {
  const {
    consultaBusqueda,
    consultaChips,
    consultaTablaHead,
    consultaTablaBody,
    consultaEmpty,
    consultaContador
  } = elementos

  let trabajadoresConsultaActual = []

  async function prepararConsultaJaberosCampania({ vigente = () => true } = {}) {
    consultaBusqueda.placeholder = 'Buscar nombre o DNI...'
    const datos = await consultas.jaberos()
    if (!vigente()) return
    trabajadoresConsultaActual = datos
    consultaChips.replaceChildren()
    consultaChips.classList.add('oculto')

    consultaTablaHead.replaceChildren()
    for (const columna of ['Jabero', 'DNI', 'Estado']) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.textContent = columna
      consultaTablaHead.append(th)
    }

    renderJaberosCampania()
  }

  function renderJaberosCampania({ vigente = () => true } = {}) {
    const jaberos = filtrarJaberosCampania(trabajadoresConsultaActual, {
      busqueda: consultaBusqueda.value
    })

    consultaTablaBody.replaceChildren()

    for (const trabajador of jaberos) {
      const fila = document.createElement('tr')

      const nombreCell = document.createElement('td')
      nombreCell.className = 'industrial-table__person'
      const nombre = document.createElement('strong')
      nombre.textContent = nombreCosechadorVisible(trabajador.nombre, trabajador.dni)
      nombreCell.append(nombre)

      const dniCell = document.createElement('td')
      dniCell.textContent = trabajador.dni || '—'

      const estadoCell = document.createElement('td')
      const badge = obtenerBadgeEstadoJabero(trabajador.estado_sync_jabero) ?? {
        etiqueta: trabajador.activo === false ? 'Inactivo' : 'Activo',
        clase: trabajador.activo === false ? 'sync-badge--error' : 'sync-badge--active'
      }
      const estado = document.createElement('span')
      estado.className = `sync-badge ${badge.clase}`
      estado.textContent = badge.etiqueta
      estadoCell.append(estado)

      fila.append(nombreCell, dniCell, estadoCell)
      consultaTablaBody.append(fila)
    }

    const total = jaberos.length
    consultaContador.textContent = `${total} ${total === 1 ? 'jabero' : 'jaberos'}`
    consultaContador.classList.remove('oculto')

    if (total > 0) {
      consultaEmpty.classList.add('oculto')
      return
    }

    const hayBusqueda = consultaBusqueda.value.trim().length > 0
    let titulo = 'No hay jaberos registrados en esta campaña.'
    let detalle = 'Los jaberos registrados aparecerán aquí, incluso sin conexión.'

    if (hayBusqueda) {
      titulo = 'No se encontraron jaberos.'
      detalle = 'Pruebe con otro nombre o DNI.'
    }

    consultaEmpty.querySelector('strong').textContent = titulo
    consultaEmpty.querySelector('p').textContent = detalle
    consultaEmpty.classList.remove('oculto')
  }

  return { preparar: prepararConsultaJaberosCampania, render: renderJaberosCampania }
}
