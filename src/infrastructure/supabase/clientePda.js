// La credencial pertenece a esta petición; nunca se instala en el cliente Auth
// ni en cabeceras globales que puedan sobrevivir a un cambio de supervisor.
export function crearClientePda(cliente, obtenerCredenciales) {
  return Object.freeze({
    rpc(nombre, parametros) {
      const { id, credencial, dni } = obtenerCredenciales()
      return cliente
        .rpc(nombre, parametros)
        .setHeader('x-gesgrow-device-id', id)
        .setHeader('x-gesgrow-device-key', credencial)
        .setHeader('x-gesgrow-operator-dni', dni)
    }
  })
}
