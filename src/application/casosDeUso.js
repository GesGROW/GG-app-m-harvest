// Fachada de Application. El bootstrap inyecta los casos ya construidos.
// No resuelve ni importa implementaciones concretas.
let implementacion

export const casosDeUso = Object.freeze({
  buscarCosechadorLocal: (...args) => obtenerCasos().buscarCosechadorLocal(...args),
  validarOperador: (...args) => obtenerCasos().validarOperador(...args),
  ingresarCampania: (...args) => obtenerCasos().ingresarCampania(...args),
  asignarTicket: (...args) => obtenerCasos().asignarTicket(...args),
  registrarJabero: (...args) => obtenerCasos().registrarJabero(...args),
  iniciarSesionLectura: (...args) => obtenerCasos().iniciarSesionLectura(...args),
  registrarLecturaJaba: (...args) => obtenerCasos().registrarLecturaJaba(...args),
  cerrarSesionLectura: (...args) => obtenerCasos().cerrarSesionLectura(...args)
})

export function configurarCasosDeUso(casos) {
  for (const nombre of Object.keys(casosDeUso)) {
    if (typeof casos?.[nombre] !== 'function')
      throw new Error(`Falta el caso de uso: ${nombre}`)
  }
  implementacion = casos
}

function obtenerCasos() {
  if (!implementacion) throw new Error('No se configuraron los casos de uso.')
  return implementacion
}
