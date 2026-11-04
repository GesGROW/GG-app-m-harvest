export function crearTarjetaOperacion({
  document,
  operacion,
  descarte,
  reintentar,
  descartar,
  vigente
}) {
  const card = document.createElement('article')
  card.className = 'card sync-error-card'
  const titulo = document.createElement('h2')
  titulo.textContent = operacion.tipo.replaceAll('_', ' ')
  const detalle = document.createElement('p')
  detalle.className = 'detalle-sync'
  const payload = operacion.payload
  const dato =
    payload.codigoTicket ??
    payload.sesionId ??
    (payload.dniTrabajador ? `DNI terminado en ${payload.dniTrabajador.slice(-4)}` : '')
  const mensaje = String(operacion.error ?? 'Error sin detalle')
    .replace(/\b\d{8}\b/g, '********')
    .replace(/Bearer\s+\S+/gi, 'Bearer [oculto]')
  detalle.textContent = `${new Date(operacion.creado_en).toLocaleString()} · ${dato} · ${mensaje}`
  const acciones = document.createElement('div')
  acciones.className = 'acciones-sync'
  card.append(titulo, detalle, acciones)
  if (operacion.resueltaHarvest) {
    const resuelta = document.createElement('p')
    resuelta.textContent =
      'Conflicto conciliado con el registro del servidor. Se conserva como historial.'
    acciones.append(resuelta)
    return card
  }

  let procesando = false
  const botones = []
  function crearAccion(texto, clase, ejecutar) {
    const boton = document.createElement('button')
    boton.className = clase
    boton.textContent = texto
    botones.push(boton)
    boton.addEventListener('click', async () => {
      if (procesando || !vigente()) return
      procesando = true
      for (const item of botones) item.disabled = true
      try {
        await ejecutar(operacion.id)
      } finally {
        procesando = false
        for (const item of botones) item.disabled = false
      }
    })
    acciones.append(boton)
  }
  crearAccion('Reintentar', 'btn-primary', reintentar)
  if (descarte.permitido) crearAccion('Descartar', 'btn-danger', descartar)
  else {
    const motivo = document.createElement('p')
    motivo.className = 'detalle-sync'
    motivo.textContent = descarte.dependientes
      ? `Esta operación tiene ${descarte.dependientes} ${descarte.dependientes === 1 ? 'operación dependiente' : 'operaciones dependientes'} y no puede descartarse.`
      : 'Esta operación no admite descarte.'
    acciones.append(motivo)
  }
  return card
}
