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
    revision = 0,
    validacion,
    operaciones = 0,
    ocupado = false,
    bloqueado = false
  const vista = () =>
    actual?.empresa
      ? { empresa: actual.empresa, nombre: actual.nombre, estado: actual.estado }
      : null
  const haySesionPin = () => Boolean(actual?.sesionPin?.token)
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
    if (
      !actual?.tenantId ||
      actual.estado !== 'VINCULADO' ||
      bloqueado ||
      !haySesionPin()
    )
      throw new Error('Valida el acceso de este PDA antes de continuar.')
    if (validacion) return validacion
    validacion = (async () => {
      const version = revision
      try {
        const sujeto = actual.sesionPin.usuarioId
        if (!enLinea()) {
          if (actual.autorizacion?.sujeto !== sujeto)
            throw new Error('Conéctate para validar esta cuenta en el PDA.')
          autorizado = comprobar(actual.autorizacion.datos)
        } else if (
          forzar ||
          !autorizado ||
          ahora() - actual.autorizacion?.comprobadoEn >= 30000
        ) {
          const respuesta = comprobar(
            await remoto.validarPin(actual, actual.sesionPin.token)
          )
          if (version !== revision || respuesta.contexto.usuarioId !== sujeto)
            throw new Error(
              'La cuenta cambió durante la validación. Ingresa de nuevo con DNI y PIN.'
            )
          autorizado = respuesta
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
        return autorizado
      } catch (error) {
        if (version !== revision) throw error
        autorizado = null
        bloqueado = true
        if (error.accesoDenegado) {
          actual = { ...actual, autorizacion: null, sesionPin: null }
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
    haySesionPin,
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
      // La cuenta completa solo configura el PIN; no abre una jornada operativa.
      if (actual?.tenantId) await remoto.validar(actual)
    },
    async configurarPin(pin) {
      if (!actual?.tenantId)
        throw new Error('Primero vincula este PDA escaneando el QR de la empresa.')
      if (!/^[0-9]{4}$/.test(pin)) throw new Error('El PIN debe contener 4 dígitos.')
      if (!enLinea()) throw new Error('Conéctate para configurar tu PIN.')
      if (operaciones)
        throw new Error('Espera a que termine la operación antes de configurar el PIN.')
      const r = await remoto.configurarPin(actual, pin)
      if (!/^[0-9]{8}$/.test(r?.dni))
        throw new Error('No se pudo confirmar el DNI de la cuenta.')
      revision++
      autorizado = null
      bloqueado = true
      actual = { ...actual, autorizacion: null, sesionPin: null }
      await almacen.guardar(actual)
      await remoto.salir()
      return { dni: r.dni }
    },
    async iniciarConPin({ dni, pin }) {
      if (!actual?.tenantId)
        throw new Error('Primero vincula este PDA escaneando el QR de la empresa.')
      if (!/^[0-9]{8}$/.test(dni) || !/^[0-9]{4}$/.test(pin))
        throw new Error('Ingresa tu DNI de 8 dígitos y PIN de 4 dígitos.')
      if (!enLinea()) throw new Error('Conéctate para iniciar sesión con tu DNI y PIN.')
      if (ocupado || operaciones)
        throw new Error(
          'Espera a que termine la operación antes de cambiar de supervisor.'
        )
      ocupado = true
      try {
        await comprobarDatos(actual.tenantId, dni)
        const r = await remoto.iniciarConPin(actual, { dni, pin })
        if (!r?.ok)
          throw new Error(r?.mensaje ?? 'No se pudo iniciar sesión con DNI y PIN.')
        const datos = comprobar(r.datos)
        if (!/^[0-9a-f]{64}$/.test(r.sesion) || datos.operador?.dni !== dni)
          throw new Error('La sesión no corresponde al DNI solicitado.')
        revision++
        actual = {
          ...actual,
          sesionPin: { token: r.sesion, usuarioId: datos.contexto.usuarioId },
          autorizacion: {
            sujeto: datos.contexto.usuarioId,
            datos,
            comprobadoEn: ahora()
          }
        }
        await almacen.guardar(actual)
        autorizado = datos
        bloqueado = false
        return datos
      } finally {
        ocupado = false
      }
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
      if (!haySesionPin())
        throw new Error('Ingresa tu DNI y PIN para comenzar la jornada.')
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
      if (operaciones || ocupado)
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
      revision++
      if (actual?.sesionPin && enLinea()) {
        try {
          await remoto.salirPin(actual, actual.sesionPin.token)
        } catch (e) {
          if (!e.accesoDenegado) {
            bloqueado = bloqueoAnterior
            throw e
          }
        }
      }
      actual = { ...actual, autorizacion: null, sesionPin: null }
      await almacen.guardar(actual)
    }
  })
}
