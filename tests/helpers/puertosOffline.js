// Puertos simulados para las fuentes de caracterización de Fase 2. Los casos
// de uso reciben exclusivamente contratos enfocados, nunca la base de datos.
export function puertosOfflineParaFuentes(fuentes) {
  const invocar =
    (nombre) =>
    (...args) =>
      fuentes[nombre](...args)
  return {
    operadores: {
      obtener: invocar('obtenerOperador'),
      guardar: invocar('guardarOperador')
    },
    campanias: {
      obtenerActiva: invocar('obtenerCampaniaActiva'),
      seleccionar: invocar('seleccionarCampaniaLocal'),
      obtenerCache: invocar('obtenerCacheCampania'),
      guardarCache: fuentes.guardarCache ? invocar('guardarCache') : async () => {}
    },
    cosecha: {
      obtenerTrabajador: invocar('obtenerTrabajador'),
      obtenerTicket: invocar('obtenerTicket'),
      obtenerLotes: invocar('obtenerLotes'),
      obtenerSesionActivaJabero: invocar('obtenerSesionActivaJabero'),
      contarLecturasSesion: invocar('contarLecturasSesion'),
      contarLecturasCosechador: invocar('contarLecturasCosechador'),
      guardarAsignacion: invocar('guardarAsignacionOffline'),
      registrarJabero: invocar('registrarJaberoOffline'),
      iniciarSesion: invocar('iniciarSesionOffline'),
      registrarLectura: invocar('registrarLecturaOffline'),
      cerrarSesion: invocar('finalizarSesionOffline')
    },
    cola: {
      existeTicketPendiente: invocar('existeTicketPendiente'),
      async inicioSesionRechazado(sesionId) {
        return (await fuentes.obtenerColaCompleta()).some(
          (item) =>
            item.tipo === 'INICIAR_SESION' &&
            item.payload.sesionId === sesionId &&
            item.estado === 'ERROR'
        )
      },
      obtenerOperaciones: invocar('obtenerColaCompleta'),
      contarPendientes: invocar('contarPendientes'),
      contarErrores: invocar('contarErrores'),
      reintentarOperacion: invocar('reintentarOperacion'),
      descartarOperacion: invocar('descartarOperacion')
    },
    sincronizacion: { sincronizar: invocar('sincronizarPendientes') }
  }
}
