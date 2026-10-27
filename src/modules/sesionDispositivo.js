let salir = async () => {}
export function configurarSalidaDispositivo(accion) {
  salir = accion
}
export function cerrarSesionDispositivo() {
  return salir()
}
