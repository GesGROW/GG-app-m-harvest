export function normalizarValorScanner(valor) {
  return String(valor ?? '').trim()
}

export function esDniValido(dni) {
  return /^\d{8}$/.test(dni)
}

function esEnter(event) {
  if (['Enter', '\r', '\n'].includes(event.key)) return true
  // Compatibilidad limitada a teclas sin identificar: no confundir el código
  // 229 de composición de Android ni una tecla de texto con el terminador.
  return (
    (!event.key || event.key === 'Unidentified') &&
    (['Enter', 'NumpadEnter'].includes(event.code) || event.keyCode === 13)
  )
}

function esSaltoDeLinea(event) {
  return (
    ['insertLineBreak', 'insertParagraph'].includes(event.inputType) ||
    (typeof event.data === 'string' && /[\r\n]$/.test(event.data))
  )
}

export function configurarEnvioScanner(formulario, input, procesar) {
  let pendiente = false
  let temporizador
  let operacionActual = null

  function esperarEscritura() {
    clearTimeout(temporizador)
    // Un turno de 0 ms no basta si la escritura del PDA llega en otra tarea.
    // Cada input posterior al terminador reinicia esta pausa de 40 ms.
    temporizador = setTimeout(async () => {
      pendiente = false
      if (input.disabled) return
      const operacion = {}
      operacionActual = operacion
      // Algunos flujos permiten otro escaneo después del guardado local,
      // mientras la sincronización anterior continúa en segundo plano.
      const liberar = () => {
        if (operacionActual === operacion) operacionActual = null
      }
      try {
        await procesar(normalizarValorScanner(input.value), liberar)
      } finally {
        liberar()
      }
    }, 40)
  }

  function enviar(event) {
    event.preventDefault()
    if (pendiente || operacionActual || input.disabled) return
    pendiente = true
    esperarEscritura()
  }

  input.addEventListener('keydown', (event) => {
    if (!esEnter(event) || event.isComposing) return
    event.preventDefault()
    if (!event.repeat) enviar(event)
  })

  input.addEventListener('beforeinput', (event) => {
    if (event.isComposing || !esSaltoDeLinea(event)) return
    // Cancelar únicamente un terminador aislado. Si vienen datos y CR juntos,
    // permitir su escritura y procesarlos desde input, con el DOM actualizado.
    if (!event.data || /^[\r\n]+$/.test(event.data)) enviar(event)
  })

  input.addEventListener('input', (event) => {
    if (!event.isComposing && esSaltoDeLinea(event)) enviar(event)
    if (pendiente) esperarEscritura()
  })

  formulario.addEventListener('submit', enviar)
}
