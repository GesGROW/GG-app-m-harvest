export function configurarEventosCampo({
  window,
  document,
  temporizadores = globalThis,
  obtenerOperador,
  verificarVigenciaOperador,
  sincronizar,
  actualizarEstadoConexion,
  registrarError = (...args) => console.error(...args),
  registrarInfo = (...args) => console.log(...args)
}) {
  async function sincronizarEnLinea() {
    if (obtenerOperador() && !verificarVigenciaOperador()) return
    if (!window.navigator.onLine) return
    try {
      await sincronizar()
      await actualizarEstadoConexion()
    } catch (error) {
      registrarError(error)
    }
  }
  window.addEventListener('online', async () => {
    if (obtenerOperador() && !verificarVigenciaOperador()) return
    registrarInfo('Conexión recuperada')
    try {
      await sincronizar()
    } catch (error) {
      registrarError('No se pudieron sincronizar las operaciones pendientes:', error)
    }
    await actualizarEstadoConexion()
  })
  window.addEventListener('offline', actualizarEstadoConexion)
  window.addEventListener('focus', sincronizarEnLinea)
  temporizadores.setInterval(sincronizarEnLinea, 30000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && obtenerOperador()) verificarVigenciaOperador()
  })
  document.addEventListener(
    'click',
    (event) => {
      if (obtenerOperador() && !verificarVigenciaOperador()) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    true
  )
}
