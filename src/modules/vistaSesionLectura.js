import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'

export function mostrarEstadoLecturaTicket(
  mensajeError,
  { estadoLecturaTicket, resultadoLectura }
) {
  const mensaje = String(mensajeError ?? '').trim()
  const tieneError = Boolean(mensaje)
  resultadoLectura.textContent = mensaje
  resultadoLectura.className = tieneError ? 'resultado error' : 'resultado oculto'
  estadoLecturaTicket.classList.toggle('paso-numero--error', tieneError)
  estadoLecturaTicket.setAttribute(
    'aria-label',
    tieneError ? 'Error al leer ticket' : 'Lectura correcta'
  )
  estadoLecturaTicket
    .querySelector('use')
    .setAttribute('href', tieneError ? '#icon-close' : '#icon-check')
}

export function mostrarContadorCosechador(
  nombre,
  cantidad,
  { etiquetaCosechador, totalCosechador }
) {
  etiquetaCosechador.textContent = String(nombre ?? '').trim() || 'Cosechador actual'
  totalCosechador.textContent = cantidad
    ? `${cantidad} ${cantidad === 1 ? 'jaba' : 'jabas'}`
    : '0'
}

async function resolverEtiquetaCosechador(lectura, consultas) {
  if (!lectura) return null
  const dni = String(lectura.cosechador_dni ?? '').trim()
  const nombreReal = (valor) => {
    const nombre = String(valor ?? '').trim()
    return nombre && ![dni, `DNI ${dni}`, 'DNI no disponible'].includes(nombre)
      ? nombre
      : ''
  }
  // Preferir el catálogo actual al nombre guardado al registrar la jaba.
  const trabajador = await consultas.obtenerTrabajador(dni)
  let nombre = nombreReal(trabajador?.nombre)
  if (!nombre && lectura.codigo_ticket) {
    const ticket = await consultas.obtenerTicket?.(lectura.codigo_ticket)
    nombre = nombreReal(ticket?.cosechador)
  }
  return nombreCosechadorVisible(nombre || nombreReal(lectura.cosechador), dni)
}

// Reconciliar contadores no limpia un escaneo en curso ni oculta un rechazo.
export async function actualizarTotalesLecturaEnVista(
  sesion,
  ui,
  consultas,
  { vigente = () => true } = {}
) {
  const total = await consultas.contarLecturasSesion(sesion.sesion_id)
  const ultima = await consultas.obtenerUltimaLecturaSesion(sesion.sesion_id)
  const cantidad = ultima
    ? await consultas.contarLecturasCosechador(sesion.sesion_id, ultima.cosechador_dni)
    : 0
  const nombre = await resolverEtiquetaCosechador(ultima, consultas)
  if (!vigente()) return
  ui.totalSesion.textContent = total
  mostrarContadorCosechador(nombre, cantidad, ui)
}

export async function mostrarSesionLecturaEnVista(
  sesion,
  {
    configuracionLectura,
    sesionLecturaActiva,
    sesionJabero,
    sesionLote,
    sesionVariedad,
    totalSesion,
    etiquetaCosechador,
    totalCosechador,
    mensajeModuloLectura,
    ticketLectura,
    estadoLecturaTicket,
    resultadoLectura
  },
  {
    contarLecturasSesion,
    obtenerUltimaLecturaSesion,
    contarLecturasCosechador,
    obtenerTicket,
    obtenerTrabajador,
    obtenerLotes
  },
  { vigente = () => true, enfocar = () => true } = {}
) {
  const total = await contarLecturasSesion(sesion.sesion_id)
  const ultima = await obtenerUltimaLecturaSesion(sesion.sesion_id)
  const cantidad = ultima
    ? await contarLecturasCosechador(sesion.sesion_id, ultima.cosechador_dni)
    : 0
  const nombre = await resolverEtiquetaCosechador(ultima, {
    obtenerTicket,
    obtenerTrabajador
  })

  const lotes = await obtenerLotes()
  const lote = lotes.find((item) => item.lote_id === sesion.lote_id)

  if (!vigente()) return
  configuracionLectura.classList.add('oculto')
  sesionLecturaActiva.classList.remove('oculto')
  sesionJabero.textContent = sesion.jabero
  sesionLote.textContent =
    lote?.nombre?.trim() || sesion.lote_nombre?.trim() || 'Lote sin nombre'
  sesionVariedad.textContent = sesion.variedad
  totalSesion.textContent = total
  mostrarContadorCosechador(nombre, cantidad, {
    etiquetaCosechador,
    totalCosechador
  })
  mensajeModuloLectura.textContent = ''
  mensajeModuloLectura.className = 'resultado oculto'
  mostrarEstadoLecturaTicket('', { estadoLecturaTicket, resultadoLectura })
  ticketLectura.value = ''
  ticketLectura.disabled = false
  if (enfocar()) ticketLectura.focus()
}
