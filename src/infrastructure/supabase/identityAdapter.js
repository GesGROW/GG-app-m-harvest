import { AccesoDenegado } from '@gesgrow/core/contexts/identity-access/index.js'

// Única frontera para el proveedor de sesión provisional.
export function crearIdentitySupabase(cliente) {
  return Object.freeze({
    async iniciarSesion({ email, password }) {
      const { error } = await cliente.auth.signInWithPassword({ email, password })
      if (error) throw new AccesoDenegado(error.message)
    },
    async obtenerSesion() {
      const { data, error } = await cliente.auth.getUser()
      if (error && error.name !== 'AuthSessionMissingError')
        throw new AccesoDenegado(error.message)
      return data?.user ? { sujeto: data.user.id } : null
    },
    async cerrarSesion() {
      const { error } = await cliente.auth.signOut()
      if (error) throw new AccesoDenegado(error.message)
    }
  })
}
