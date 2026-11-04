import { obtenerVariedadesLote } from '@gesgrow/core/contexts/campaign-management/index.js'

export function crearConfiguracionLectura({
  document,
  obtenerLotes,
  mostrarMensajeLectura
}) {
  const loteLectura = document.querySelector('#lote-lectura')
  const variedadLectura = document.querySelector('#variedad-lectura')
  let lotesLecturaDisponibles = []

  async function cargarLotes({ vigente = () => true } = {}) {
    loteLectura.disabled = true
    lotesLecturaDisponibles = []
    cargarVariedadesLectura()
    loteLectura.innerHTML = '<option value="">Cargando lotes...</option>'
    try {
      const lotes = await obtenerLotes()
      if (!vigente()) return
      lotesLecturaDisponibles = lotes
      loteLectura.innerHTML = '<option value="">Seleccione un lote</option>'
      for (const lote of lotes) {
        const option = document.createElement('option')
        option.value = lote.lote_id
        option.textContent = lote.nombre?.trim() || 'Lote sin nombre'
        loteLectura.appendChild(option)
      }
      loteLectura.disabled = false
    } catch (error) {
      if (!vigente()) return
      mostrarMensajeLectura(error.message, 'error')
    }
  }

  function cargarVariedadesLectura() {
    const lote = lotesLecturaDisponibles.find(
      (item) => item.lote_id === loteLectura.value
    )
    const variedades = obtenerVariedadesLote(lote)
    variedadLectura.replaceChildren()
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = lote
      ? 'Seleccione una variedad'
      : 'Seleccione primero un lote'
    variedadLectura.appendChild(placeholder)
    for (const variedad of variedades) {
      const option = document.createElement('option')
      option.value = variedad.id ?? ''
      option.textContent = variedad.nombre
      variedadLectura.appendChild(option)
      if (variedades.length === 1) option.selected = true
    }
    variedadLectura.disabled = !variedades.length
  }

  loteLectura.addEventListener('change', cargarVariedadesLectura)

  return Object.freeze({ cargar: cargarLotes })
}
