export function crearSesionesRestaurables({
  document,
  obtenerOperador,
  consultas,
  continuar,
  solicitarCierre
}) {
  const contenedor = document.querySelector('#sesiones-restaurables')
  let revision = 0

  async function mostrar() {
    const version = ++revision
    const operador = obtenerOperador()
    const vigente = () => version === revision && obtenerOperador() === operador
    if (!operador) return
    const sesiones = await consultas.obtenerSesionesActivas(operador.dni)
    const lotes = sesiones.length ? await consultas.obtenerLotes() : []
    const nombresLotes = new Map(lotes.map((lote) => [lote.lote_id, lote.nombre]))
    const filas = await Promise.all(
      sesiones.map(async (sesion) => {
        const total = await consultas.contarLecturasSesion(
          sesion.sesion_id ?? sesion.id
        )
        return { sesion, total }
      })
    )
    if (!vigente()) return
    contenedor.replaceChildren()
    contenedor.classList.toggle('oculto', !filas.length)
    if (!filas.length) return
    const titulo = document.createElement('h2')
    titulo.textContent = 'Sesiones de lectura activas'
    contenedor.append(titulo)
    for (const { sesion, total } of filas) {
      const fila = document.createElement('div')
      fila.className = 'card sesion-restaurable'
      const descripcion = document.createElement('p')
      const nombreLote =
        nombresLotes.get(sesion.lote_id)?.trim() ||
        sesion.lote_nombre?.trim() ||
        'Lote sin nombre'
      descripcion.textContent = `${sesion.jabero} · ${nombreLote} · ${sesion.variedad}`
      const conteo = document.createElement('p')
      conteo.textContent = `${total} jabas locales`
      const botonContinuar = document.createElement('button')
      botonContinuar.className = 'btn-primary'
      botonContinuar.textContent = 'Continuar lectura'
      botonContinuar.addEventListener('click', () => {
        if (vigente()) return continuar(sesion)
      })
      const finalizar = document.createElement('button')
      finalizar.className = 'btn-secondary'
      finalizar.textContent = 'Finalizar sesión'
      finalizar.addEventListener('click', () => {
        if (vigente()) return solicitarCierre(sesion)
      })
      fila.append(descripcion, conteo, botonContinuar, finalizar)
      contenedor.append(fila)
    }
  }

  return Object.freeze({
    mostrar,
    limpiar() {
      revision++
      contenedor.replaceChildren()
      contenedor.classList.add('oculto')
    }
  })
}
