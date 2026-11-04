import { resolverCampaniaOperador } from '@gesgrow/core/contexts/campaign-management/index.js'

export function crearSeleccionCampania({
  document,
  obtenerOperador,
  ingresarCampania,
  mostrarVista,
  registrarError
}) {
  const vista = document.querySelector('#vista-cultivos')
  const opciones = document.querySelector('#opciones-cultivo')
  const mensaje = document.querySelector('#cultivo-mensaje')
  let revision = 0

  async function preparar(idRestaurado) {
    const version = ++revision
    const operador = obtenerOperador()
    const vigente = () => version === revision && obtenerOperador() === operador
    const campania = resolverCampaniaOperador(
      operador,
      operador.campanias?.some((item) => item.id === idRestaurado) ? idRestaurado : null
    )
    if (campania) return ingresarCampania(campania)
    opciones.replaceChildren()
    mensaje.textContent = ''
    for (const opcion of operador.campanias) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'btn-primary'
      button.textContent = `${opcion.cultivo_nombre} · ${opcion.nombre}`
      button.addEventListener('click', async () => {
        if (!vigente() || button.disabled) return
        for (const item of opciones.children) item.disabled = true
        mensaje.textContent = ''
        try {
          await ingresarCampania(opcion)
        } catch (error) {
          if (vigente()) mensaje.textContent = error.message
          else registrarError(error)
        } finally {
          if (vigente()) for (const item of opciones.children) item.disabled = false
        }
      })
      opciones.appendChild(button)
    }
    mostrarVista(vista)
  }
  return Object.freeze({
    preparar,
    limpiar() {
      revision++
      opciones.replaceChildren()
      mensaje.textContent = ''
    }
  })
}
