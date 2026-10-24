export function configurarTecladoManual(input, boton, modoManual) {
  let activo = false

  function actualizar(nuevoEstado) {
    activo = nuevoEstado
    input.inputMode = activo ? modoManual : 'none'
    boton.classList.toggle('activo', activo)
    boton.setAttribute('aria-pressed', String(activo))
    boton.setAttribute('aria-label', activo ? 'Ocultar teclado' : 'Mostrar teclado')
  }

  function ocultarTeclado() {
    if (navigator.virtualKeyboard?.hide) navigator.virtualKeyboard.hide()
  }

  boton.addEventListener('click', () => {
    if (activo) {
      actualizar(false)
      ocultarTeclado()
      input.focus()
      return
    }

    actualizar(true)
    // Chrome Android puede necesitar un foco nuevo tras cambiar inputmode.
    input.blur()
    input.focus()
    if (navigator.virtualKeyboard?.show) navigator.virtualKeyboard.show()
  })

  actualizar(false)

  return () => {
    if (!activo) return
    const estabaEnfocado = globalThis.document?.activeElement === input
    actualizar(false)
    if (estabaEnfocado) input.blur()
    ocultarTeclado()
    if (estabaEnfocado) input.focus()
  }
}
