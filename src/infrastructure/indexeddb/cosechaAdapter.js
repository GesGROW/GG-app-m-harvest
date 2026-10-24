export function crearCosechaIndexedDB(db) {
  return Object.freeze({
    obtenerTrabajador: (dni) => db.obtenerTrabajador(dni),
    obtenerTicket: (codigo) => db.obtenerTicket(codigo),
    obtenerLotes: () => db.obtenerLotes(),
    obtenerSesionActivaJabero: (dni) => db.obtenerSesionActivaJabero(dni),
    contarLecturasSesion: (sesionId) => db.contarLecturasSesion(sesionId),
    contarLecturasCosechador: (sesionId, dni) =>
      db.contarLecturasCosechador(sesionId, dni),
    // Cada método delega UNA operación transaccional completa. Nunca se separan
    // las escrituras locales de la creación del trabajo pendiente.
    guardarAsignacion: (asignacion) => db.guardarAsignacionOffline(asignacion),
    registrarJabero: (dniOperador, dniTrabajador) =>
      db.registrarJaberoOffline(dniOperador, dniTrabajador),
    iniciarSesion: (sesion, dniOperador) =>
      db.iniciarSesionOffline(sesion, dniOperador),
    registrarLectura: (lectura, dniOperador) =>
      db.registrarLecturaOffline(lectura, dniOperador),
    cerrarSesion: (sesionId, dniOperador) =>
      db.finalizarSesionOffline(sesionId, dniOperador)
  })
}
