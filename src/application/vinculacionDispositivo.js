import { esErrorTemporal } from '@gesgrow/core/shared/erroresConexion.js'

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
  const haySesionDni = () => Boolean(actual?.sesionDni?.dni)
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
      !haySesionDni()
    )
      throw new Error('Valida el acceso de este PDA antes de continuar.')
    if (validacion) return validacion
    validacion = (async () => {
      const version = revision
      let falloConsultaTemporal = false
      try {
        const sujeto = actual.sesionDni.usuarioId
        if (!enLinea()) {
          if (actual.autorizacion?.sujeto !== sujeto)
            throw new Error('Conéctate para validar esta cuenta en el PDA.')
          autorizado = comprobar(actual.autorizacion.datos)
        } else if (
          forzar ||
          !autorizado ||
          ahora() - actual.autorizacion?.comprobadoEn >= 30000
        ) {
          let datos
          try {
            datos = await remoto.ingresarConDni(actual, actual.sesionDni.dni)
          } catch (error) {
            falloConsultaTemporal =
              !error.accesoDenegado && (error.temporal || esErrorTemporal(error))
            throw error
          }
          const respuesta = comprobar(datos)
          if (
            version !== revision ||
            respuesta.contexto.usuarioId !== sujeto ||
            respuesta.operador?.dni !== actual.sesionDni.dni
          )
            throw new Error(
              'La cuenta cambió durante la validación. Ingresa de nuevo con tu DNI.'
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
        if (
          falloConsultaTemporal &&
          actual.autorizacion?.sujeto === actual.sesionDni?.usuarioId &&
          actual.sesionDni?.dni
        ) {
          try {
            const guardado = comprobar(actual.autorizacion.datos)
            if (
              guardado.operador?.dni === actual.sesionDni.dni &&
              guardado.contexto.usuarioId === actual.sesionDni.usuarioId
            ) {
              autorizado = guardado
              return guardado
            }
          } catch {
            /* Una autorización vencida nunca se reutiliza. */
          }
        }
        if (falloConsultaTemporal)
          error.message = 'Conéctate para renovar la autorización de este PDA.'
        autorizado = null
        bloqueado = true
        if (error.accesoDenegado) {
          actual = { ...actual, autorizacion: null, sesionDni: null }
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
    haySesionDni,
    async restaurar() {
      actual = await almacen.obtener()
      // Conservar el vínculo de instalaciones anteriores, sin restaurar el PIN.
      if (actual?.sesionPin) {
        const { sesionPin, ...instalacion } = actual
        actual = { ...instalacion, autorizacion: null }
        await almacen.guardar(actual)
      }
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
      // La cuenta completa solo autoriza la vinculación inicial.
      if (actual?.tenantId) await remoto.validar(actual)
    },
    async iniciarConDni(dni) {
      if (!actual?.tenantId)
        throw new Error('Primero vincula este PDA escaneando el QR de la empresa.')
      if (!/^[0-9]{8}$/.test(dni)) throw new Error('Ingresa tu DNI de 8 dígitos.')
      if (!enLinea()) throw new Error('Conéctate para iniciar sesión con tu DNI.')
      if (ocupado || operaciones)
        throw new Error(
          'Espera a que termine la operación antes de cambiar de supervisor.'
        )
      ocupado = true
      try {
        await comprobarDatos(actual.tenantId, dni)
        const datos = comprobar(await remoto.ingresarConDni(actual, dni))
        if (datos.operador?.dni !== dni)
          throw new Error('La sesión no corresponde al DNI solicitado.')
        revision++
        actual = {
          ...actual,
          sesionDni: { dni, usuarioId: datos.contexto.usuarioId },
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
      if (!haySesionDni()) throw new Error('Ingresa tu DNI para comenzar la jornada.')
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
      actual = { ...actual, autorizacion: null, sesionDni: null }
      await almacen.guardar(actual)
    }
  })
}
