export function crearDispositivoSupabase(cliente, operativo = cliente) {
  async function rpc(nombre, datos, conexion = cliente) {
    let respuesta
    try {
      respuesta = await conexion.rpc(nombre, datos)
    } catch {
      throw Object.assign(
        new Error('No se pudo conectar. Comprueba la conexión e inténtalo de nuevo.'),
        { temporal: true }
      )
    }
    if (respuesta.error) {
      const e = respuesta.error
      const error = new Error(
        e.code === 'PGRST202'
          ? 'Falta actualizar las funciones de vinculación de la base de datos.'
          : e.message || 'No se pudo validar el PDA.'
      )
      error.accesoDenegado =
        e.code === '42501' || [401, 403].includes(Number(respuesta.status ?? e.status))
      const status = Number(respuesta.status ?? e.status ?? e.code)
      error.temporal =
        !error.accesoDenegado &&
        ([0, 408, 429].includes(status) ||
          (status >= 500 && status < 600) ||
          /fetch|network|timeout/i.test(e.message ?? ''))
      if (error.temporal)
        error.message =
          'No se pudo conectar. Comprueba la conexión e inténtalo de nuevo.'
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
    validar: (d) => rpc('pda_preparar_ingreso', parametros(d)),
    ingresarConDni: (d, dni) =>
      rpc('pda_preparar_ingreso_dni', { ...parametros(d), p_dni: dni }, operativo)
  })
}
