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
  etiquetaCosechador.textContent = nombre || 'Cosechador actual'
  totalCosechador.textContent = cantidad
    ? `${cantidad} ${cantidad === 1 ? 'jaba' : 'jabas'}`
    : '0'
}

// Reconciliar contadores no limpia un escaneo en curso ni oculta un rechazo.
export async function actualizarTotalesLecturaEnVista(sesion, ui, consultas) {
  const total = await consultas.contarLecturasSesion(sesion.sesion_id)
  const ultima = await consultas.obtenerUltimaLecturaSesion(sesion.sesion_id)
  const cantidad = ultima
    ? await consultas.contarLecturasCosechador(sesion.sesion_id, ultima.cosechador_dni)
    : 0
  const nombre = ultima
    ? ultima.cosechador ||
      (await consultas.obtenerTrabajador(ultima.cosechador_dni))?.nombre
    : null
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
  }
) {
  const total = await contarLecturasSesion(sesion.sesion_id)
  const ultima = await obtenerUltimaLecturaSesion(sesion.sesion_id)
  const cantidad = ultima
    ? await contarLecturasCosechador(sesion.sesion_id, ultima.cosechador_dni)
    : 0
  const nombre = ultima
    ? ultima.cosechador ||
      (ultima.codigo_ticket &&
        (await obtenerTicket(ultima.codigo_ticket))?.cosechador) ||
      (await obtenerTrabajador(ultima.cosechador_dni))?.nombre
    : null

  const lotes = await obtenerLotes()
  const lote = lotes.find((item) => item.lote_id === sesion.lote_id)

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
  ticketLectura.focus()
}
