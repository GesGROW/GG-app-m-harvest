export function crearColaIndexedDB(db) {
  return Object.freeze({
    existeTicketPendiente: (codigo) => db.existeTicketPendiente(codigo),
    async inicioSesionRechazado(sesionId) {
      const operaciones = await db.obtenerColaCompleta()
      return operaciones.some(
        (item) =>
          item.tipo === 'INICIAR_SESION' &&
          item.payload.sesionId === sesionId &&
          item.estado === 'ERROR'
      )
    },
    obtenerOperaciones: () => db.obtenerColaCompleta(),
    contarPendientes: () => db.contarPendientes(),
    contarErrores: () => db.contarErrores(),
    reintentarOperacion: (id) => db.reintentarOperacion(id),
    descartarOperacion: (id) => db.descartarOperacion(id)
  })
}
