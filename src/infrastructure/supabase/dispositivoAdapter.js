export function crearDispositivoSupabase(cliente) {
  async function rpc(nombre, datos) {
    let respuesta
    try {
      respuesta = await cliente.rpc(nombre, datos)
    } catch {
      throw new Error(
        'No se pudo conectar. Comprueba la conexión e inténtalo de nuevo.'
      )
    }
    if (respuesta.error) {
      const e = respuesta.error
      const error = new Error(
        e.code === 'PGRST202'
          ? 'Falta actualizar las funciones de vinculación de la base de datos.'
          : e.message || 'No se pudo validar el PDA.'
      )
      error.accesoDenegado = e.code === '42501' || [401, 403].includes(e.status)
      throw error
    }
    return respuesta.data
  }
  const parametros = (d) => ({ p_dispositivo_id: d.id, p_credencial: d.credencial })
  return Object.freeze({
    async sujeto({ verificar = true } = {}) {
      if (!verificar)
        return (await cliente.auth.getSession()).data?.session?.user?.id ?? null
      const { data, error } = await cliente.auth.getUser()
      if (error?.name === 'AuthSessionMissingError') return null
      if (error) throw new Error('Vuelve a iniciar sesión para validar este PDA.')
      return data?.user?.id ?? null
    },
    async iniciarSesion({ email, password }) {
      const { error } = await cliente.auth.signInWithPassword({ email, password })
      if (error)
        throw new Error('No se pudo iniciar sesión. Revisa tu correo y contraseña.')
    },
    async salir() {
      const { error } = await cliente.auth.signOut({ scope: 'local' })
      if (error) throw new Error('No se pudo cerrar la sesión. Vuelve a intentarlo.')
    },
    vincular: (d, token, nombre) =>
      rpc('pda_vincular_dispositivo', {
        ...parametros(d),
        p_token: token,
        p_nombre: nombre
      }),
    validar: (d) => rpc('pda_preparar_ingreso', parametros(d))
  })
}
