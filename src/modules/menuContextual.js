// The native modal keeps background controls inert, including scanner inputs.
export function configurarMenuContextual({ dialogo, botonCerrar }) {
  let disparador = null

  function cerrar() {
    if (!dialogo.open) return
    dialogo.close()
    dialogo.classList.add('oculto')
    dialogo.setAttribute('aria-hidden', 'true')
    if (disparador?.isConnected) disparador.focus()
    disparador = null
  }

  botonCerrar.addEventListener('click', cerrar)
  dialogo.addEventListener('cancel', (event) => {
    event.preventDefault()
    cerrar()
  })
  dialogo.addEventListener('click', (event) => {
    if (event.target === dialogo) cerrar()
  })
  dialogo.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return
    const controles = [
      ...dialogo.querySelectorAll(
        'button, a[href], input, select, textarea, [tabindex]'
      )
    ].filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length)
    const primero = controles[0],
      ultimo = controles.at(-1)
    const actual = dialogo.ownerDocument.activeElement
    if (!primero) return
    if (event.shiftKey && actual === primero) {
      event.preventDefault()
      ultimo.focus()
    } else if (!event.shiftKey && actual === ultimo) {
      event.preventDefault()
      primero.focus()
    }
  })

  return {
    abrir() {
      if (dialogo.open) return
      disparador = dialogo.ownerDocument.activeElement
      dialogo.classList.remove('oculto')
      dialogo.setAttribute('aria-hidden', 'false')
      dialogo.showModal()
      botonCerrar.focus()
    },
    cerrar
  }
}
