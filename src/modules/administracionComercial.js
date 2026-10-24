// Vista de Platform: operaciones y hechos obtenidos mediante Application.
export function configurarAdministracionComercial({ vista, comercial }) {
  const buscar = (id) => vista.querySelector('#' + id)
  const boton = buscar('btn-cuenta-comercial')
  const panel = buscar('cuenta-comercial')
  const form = buscar('form-cuenta-comercial')
  const mensaje = buscar('cuenta-comercial-mensaje')
  const resumen = buscar('cuenta-comercial-resumen')
  const historial = buscar('cuenta-comercial-historial')
  const accion = buscar('cuenta-comercial-accion')
  let generacion = 0
  const nuevoId = () => {
    buscar('cuenta-comercial-operacion').value = crypto.randomUUID()
  }
  const error = (e) => {
    mensaje.textContent = e.message
  }
  const fechaLocal = (valor) =>
    valor ? new Date(valor).toLocaleString() : 'Sin vencimiento'
  function campos() {
    for (const nodo of panel.querySelectorAll('[data-acciones]'))
      nodo.classList.toggle(
        'oculto',
        !nodo.dataset.acciones.split(' ').includes(accion.value)
      )
  }
  function mostrarHistorial(datos) {
    const describir = (estado) => {
      const s = estado.suscripcion
      if (!s) return 'Sin suscripción'
      const plan =
        datos.planes.find((p) => p.id === s.plan_id)?.nombre ?? 'Plan histórico'
      const modulos =
        estado.modulos
          ?.filter((m) => m.habilitado)
          .map((m) => m.modulo_codigo)
          .join(', ') || 'Ninguno'
      return `${s.estado} · ${plan} · Hasta: ${fechaLocal(s.hasta)} · Módulos: ${modulos}`
    }
    const table = document.createElement('table'),
      head = document.createElement('thead'),
      body = document.createElement('tbody')
    const fila = (valores, tag = 'td') => {
      const row = document.createElement('tr')
      for (const valor of valores) {
        const celda = document.createElement(tag)
        celda.textContent = valor
        row.append(celda)
      }
      return row
    }
    head.append(
      fila(
        [
          'Fecha',
          'Evento',
          'Resultado',
          'Aplicación prevista',
          'Actor',
          'Estado anterior',
          'Estado nuevo',
          'Motivo'
        ],
        'th'
      )
    )
    for (const e of datos.historial)
      body.append(
        fila([
          fechaLocal(e.fecha_hora),
          e.tipo_evento,
          e.fase,
          fechaLocal(e.effective_at),
          e.actor.usuarioId ?? e.actor.tipo,
          describir(e.estado_anterior),
          describir(e.estado_nuevo),
          e.contexto.rechazo ? `${e.motivo}: ${e.contexto.rechazo}` : e.motivo
        ])
      )
    table.append(head, body)
    historial.replaceChildren(table)
  }
  async function cargar(version = generacion) {
    const datos = await comercial.consultar()
    if (version !== generacion) return
    const s = datos.estado.suscripcion
    const nombrePlan = datos.planes.find((p) => p.id === s?.plan_id)?.nombre ?? ''
    resumen.textContent = s
      ? `${nombrePlan} · ${s.estado} · Hasta: ${fechaLocal(s.hasta)} · ${datos.programados.length} cambios pendientes`
      : 'Esta empresa todavía no tiene suscripción.'
    const planes = buscar('cuenta-comercial-plan')
    const seleccion = planes.value
    planes.replaceChildren()
    for (const p of datos.planes.filter((p) => p.activo !== false)) {
      const option = document.createElement('option')
      option.value = p.id
      option.textContent = p.nombre
      planes.append(option)
    }
    if (datos.planes.some((p) => p.id === seleccion)) planes.value = seleccion
    mostrarHistorial(datos)
  }
  boton.addEventListener('click', async () => {
    const version = generacion
    try {
      await cargar(version)
      if (version === generacion) panel.classList.remove('oculto')
    } catch (e) {
      error(e)
    }
  })
  accion.addEventListener('change', campos)
  buscar('btn-cuenta-comercial-nueva').addEventListener('click', () => {
    nuevoId()
    mensaje.textContent = ''
    buscar('cuenta-comercial-motivo').value = ''
    buscar('cuenta-comercial-effective').value = ''
  })
  buscar('btn-cuenta-comercial-refrescar').addEventListener('click', () =>
    cargar().catch(error)
  )
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const version = generacion
    const submit = buscar('btn-cuenta-comercial-aplicar')
    submit.disabled = true
    mensaje.textContent = ''
    try {
      const iso = (id) =>
        buscar(id).value ? new Date(buscar(id).value).toISOString() : null
      const resultado = await comercial[accion.value]({
        operacionId: buscar('cuenta-comercial-operacion').value,
        motivo: buscar('cuenta-comercial-motivo').value,
        effectiveAt: iso('cuenta-comercial-effective'),
        planId: buscar('cuenta-comercial-plan').value,
        estado: buscar('cuenta-comercial-estado').value,
        hasta: iso('cuenta-comercial-hasta'),
        modulo: buscar('cuenta-comercial-modulo').value,
        origen: buscar('cuenta-comercial-origen').value
      })
      if (version !== generacion) return
      mensaje.textContent =
        resultado.fase === 'PROGRAMADA'
          ? `Cambio programado para ${fechaLocal(resultado.effectiveAt)}.`
          : 'Cambio aplicado y registrado en el historial.'
      await cargar(version)
    } catch (e) {
      if (version === generacion) error(e)
    } finally {
      submit.disabled = false
    }
  })
  campos()
  return Object.freeze({
    async activar() {
      const version = ++generacion
      boton.classList.add('oculto')
      panel.classList.add('oculto')
      mensaje.textContent = ''
      resumen.textContent = ''
      historial.replaceChildren()
      buscar('cuenta-comercial-motivo').value = ''
      buscar('cuenta-comercial-effective').value = ''
      buscar('cuenta-comercial-hasta').value = ''
      nuevoId()
      const permitido = await comercial.puedeAdministrar()
      if (version === generacion && permitido) boton.classList.remove('oculto')
    },
    ocultar() {
      generacion++
      boton.classList.add('oculto')
      panel.classList.add('oculto')
      historial.replaceChildren()
      resumen.textContent = ''
      mensaje.textContent = ''
    }
  })
}
