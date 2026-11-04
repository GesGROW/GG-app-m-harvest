export function crearEstadoConexion({
  document,
  obtenerOperador,
  estaEnLinea,
  cola,
  actualizarTotalesLectura,
  registrarError
}) {
  const estado = document.querySelector('#estado-conexion')
  let revision = 0

  async function actualizar() {
    const version = ++revision
    const operador = obtenerOperador()
    const campaniaId = operador?.campania?.id
    const vigente = () =>
      version === revision &&
      obtenerOperador() === operador &&
      obtenerOperador()?.campania?.id === campaniaId
    let pendientes, errores
    try {
      pendientes = await cola.contarPendientes()
      errores = await cola.contarErrores()
      if (vigente()) await actualizarTotalesLectura()
    } catch (error) {
      registrarError('No se pudo consultar la cola de sincronización:', error)
    }
    if (!vigente()) return
    if (!estaEnLinea()) {
      estado.textContent =
        pendientes === undefined
          ? 'Sin conexión'
          : `Sin conexión · ${pendientes} pendientes`
      estado.className = 'estado-conexion offline'
    } else if (errores > 0) {
      estado.textContent = `${errores} ${errores === 1 ? 'error de sincronización' : 'errores de sincronización'}`
      estado.className = 'estado-conexion error-sync'
    } else if (pendientes > 0) {
      estado.textContent = `${pendientes} ${pendientes === 1 ? 'registro pendiente' : 'registros pendientes'}`
      estado.className = 'estado-conexion warning-sync'
    } else {
      estado.textContent = ''
      estado.className = 'estado-conexion oculto'
    }
  }
  return Object.freeze({ actualizar })
}
