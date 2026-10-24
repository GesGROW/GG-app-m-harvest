// La presentación ejecuta esta continuación después de mostrar el éxito local
// y liberar el scanner. Sincronizar antes cambiaría el comportamiento offline.
export function sincronizacionPosterior(dependencias, mensajeError) {
  return async () => {
    if (!dependencias.estaEnLinea()) return false
    try {
      await dependencias.offline.sincronizacion.sincronizar()
    } catch (error) {
      if (!mensajeError) throw error
      dependencias.registrarError(mensajeError, error)
    }
    return true
  }
}
