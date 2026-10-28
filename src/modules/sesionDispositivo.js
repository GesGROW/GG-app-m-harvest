let salir = async () => {}
let ingreso = null
export function configurarSalidaDispositivo(accion) {
  salir = accion
}
export function cerrarSesionDispositivo() {
  return salir()
}
export function configurarIngresoDispositivo(accion) {
  ingreso = accion
}
export function mostrarIngresoDispositivo() {
  if (!ingreso) return false
  ingreso()
  return true
}
