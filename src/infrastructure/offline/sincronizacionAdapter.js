export function crearSincronizacionAdapter(sincronizarPendientes) {
  return Object.freeze({ sincronizar: () => sincronizarPendientes() })
}
