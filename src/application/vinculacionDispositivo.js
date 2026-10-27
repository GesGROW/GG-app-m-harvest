export function tokenVinculacion(valor, origen, otrosOrigenes = []) {
  const texto = String(valor ?? '').trim()
  if (/^[0-9a-f]{64}$/.test(texto)) return texto
  try {
    const url = new URL(texto)
    if (
      ![origen, ...otrosOrigenes].includes(url.origin) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search
    )
      throw new Error()
    const parametros = new URLSearchParams(url.hash.slice(1))
    const token = parametros.get('vincular')
    if ([...parametros.keys()].length === 1 && /^[0-9a-f]{64}$/.test(token))
      return token
  } catch {
    /* Validar todo el enlace antes de extraer su secreto. */
  }
  throw new Error('Escanea el QR de vinculación generado en el portal de GesGROW.')
}

export function crearVinculacionDispositivo({
  remoto,
  almacen,
  enLinea,
  ahora = () => Date.now(),
  comprobarDatos = async () => {},
  alBloquear = () => {}
}) {
  let actual,
    autorizado,
    sujetoActual,
    validacion,
    operaciones = 0,
    ocupado = false,
    bloqueado = false
  const vista = () =>
    actual?.empresa
      ? { empresa: actual.empresa, nombre: actual.nombre, estado: actual.estado }
      : null
  function comprobar(r) {
    if (
      !r?.dispositivo ||
      r.dispositivo.id !== actual.id ||
      r.dispositivo.estado !== 'ACTIVO' ||
      r.dispositivo.tenantId !== r.contexto?.tenantId ||
      !r.contexto?.usuarioId ||
      (actual.tenantId && actual.tenantId !== r.dispositivo.tenantId) ||
      !Number.isFinite(Date.parse(r.autorizadoHasta)) ||
      Date.parse(r.autorizadoHasta) <= ahora()
    )
      throw new Error('La validación no corresponde a este PDA o ya venció.')
    if (
      r.operador &&
      (r.operador.tenant_id !== r.dispositivo.tenantId ||
        !/^\d{8}$/.test(r.operador.dni) ||
        !Array.isArray(r.operador.campanias) ||
        r.operador.campanias.some((c) => c.tenant_id !== r.dispositivo.tenantId))
    )
      throw new Error('El operador no corresponde a la empresa vinculada.')
    return r
  }
  async function validar({ forzar = false } = {}) {
    if (!actual?.tenantId || actual.estado !== 'VINCULADO' || bloqueado)
      throw new Error('Valida el acceso de este PDA antes de continuar.')
    if (validacion) return validacion
    validacion = (async () => {
      try {
        const sujeto = await remoto.sujeto({ verificar: enLinea() })
        if (!sujeto || (sujetoActual && sujeto !== sujetoActual))
          throw new Error('Inicia sesión con tu cuenta de supervisor.')
        if (!enLinea()) {
          if (actual.autorizacion?.sujeto !== sujeto)
            throw new Error('Conéctate para validar esta cuenta en el PDA.')
          autorizado = comprobar(actual.autorizacion.datos)
        } else if (
          forzar ||
          !autorizado ||
          ahora() - actual.autorizacion?.comprobadoEn >= 30000
        ) {
          autorizado = comprobar(await remoto.validar(actual))
          if ((await remoto.sujeto({ verificar: false })) !== sujeto)
            throw new Error(
              'La cuenta cambió durante la validación. Vuelve a iniciar sesión.'
            )
          await comprobarDatos(actual.tenantId, autorizado.operador?.dni)
          actual = {
            ...actual,
            estado: 'VINCULADO',
            empresa: autorizado.contexto.empresa,
            autorizacion: { sujeto, datos: autorizado, comprobadoEn: ahora() }
          }
          await almacen.guardar(actual)
        }
        comprobar(autorizado)
        sujetoActual = sujeto
        return autorizado
      } catch (error) {
        autorizado = null
        bloqueado = true
        if (error.accesoDenegado) {
          actual = { ...actual, autorizacion: null }
          await almacen.guardar(actual)
        }
        alBloquear(error)
        throw error
      }
    })()
    try {
      return await validacion
    } finally {
      validacion = null
    }
  }
  async function confirmarVinculacion(r) {
    if (
      r?.dispositivo?.id !== actual.id ||
      !r?.contexto?.tenantId ||
      r.dispositivo.tenantId !== r.contexto.tenantId ||
      r.dispositivo.estado !== 'ACTIVO'
    )
      throw new Error('No se pudo confirmar la vinculación de este PDA.')
    actual = {
      ...actual,
      estado: 'VINCULADO',
      tenantId: r.dispositivo.tenantId,
      empresa: r.contexto.empresa,
      nombre: r.dispositivo.nombre
    }
    await almacen.guardar(actual)
  }
  return Object.freeze({
    vista,
    async restaurar() {
      actual = await almacen.obtener()
      if (actual?.estado === 'PENDIENTE' && enLinea()) {
        try {
          if (await remoto.sujeto())
            await confirmarVinculacion(await remoto.validar(actual))
        } catch {
          /* Conservar la identidad pendiente para recuperar o reintentar. */
        }
      }
      return vista()
    },
    async iniciarSesion(credenciales) {
      if (operaciones)
        throw new Error(
          'Espera a que termine la operación antes de iniciar otra sesión.'
        )
      if (!enLinea())
        throw new Error('Necesitas conexión para iniciar una nueva sesión.')
      await remoto.iniciarSesion(credenciales)
      sujetoActual = null
      autorizado = null
      bloqueado = false
      if (actual?.tenantId) return validar({ forzar: true })
    },
    async vincular(token, nombre) {
      if (ocupado) throw new Error('La vinculación está en curso.')
      if (actual?.tenantId)
        throw new Error('Este PDA ya está vinculado. No necesita otro QR.')
      if (!/^[0-9a-f]{64}$/.test(token) || !nombre?.trim() || nombre.trim().length > 80)
        throw new Error('Ingresa un QR válido y un nombre para el PDA.')
      if (!enLinea()) throw new Error('Conéctate a Internet para vincular este PDA.')
      ocupado = true
      try {
        if (!(await remoto.sujeto()))
          throw new Error('Inicia sesión con la cuenta del supervisor para vincular.')
        actual = await almacen.preparar()
        // Recuperar una respuesta perdida antes de necesitar nuevamente el QR.
        let r
        try {
          r = await remoto.validar(actual)
        } catch {
          /* Todavía no vinculado. */
        }
        if (!r) r = await remoto.vincular(actual, token, nombre.trim())
        await confirmarVinculacion(r)
        bloqueado = false
        return vista()
      } finally {
        ocupado = false
      }
    },
    async continuar() {
      bloqueado = false
      return validar({ forzar: true })
    },
    validar,
    async operador(dni) {
      const r = await validar()
      if (!r.operador || (dni && r.operador.dni !== dni))
        throw new Error(
          'Esta cuenta no tiene campañas activas de supervisor asignadas en la empresa.'
        )
      return r.operador
    },
    async autorizarSolicitud({ dni, campaniaId } = {}) {
      const operador = await this.operador(dni)
      if (campaniaId && !operador.campanias.some((c) => c.id === campaniaId))
        throw new Error('La campaña no pertenece a esta sesión y empresa.')
    },
    async ejecutarSolicitud(datos, accion) {
      if (bloqueado) throw new Error('Valida el acceso de este PDA antes de continuar.')
      operaciones++
      try {
        await this.autorizarSolicitud(datos)
        return await accion()
      } finally {
        operaciones--
      }
    },
    async salir() {
      if (operaciones)
        throw new Error(
          'Espera a que termine la operación antes de cambiar de supervisor.'
        )
      const bloqueoAnterior = bloqueado
      bloqueado = true
      try {
        await comprobarDatos(null, null, { salir: true })
      } catch (e) {
        bloqueado = bloqueoAnterior
        throw e
      }
      bloqueado = true
      autorizado = null
      sujetoActual = null
      await remoto.salir()
      actual = { ...actual, autorizacion: null }
      await almacen.guardar(actual)
    }
  })
}
