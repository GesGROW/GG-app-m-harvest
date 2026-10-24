export function configurarConfirmacion({ dialogo, mensaje }) {
  let resolverPendiente = null

  dialogo.addEventListener('close', () => {
    const resolver = resolverPendiente
    resolverPendiente = null
    resolver?.(dialogo.returnValue === 'confirmar')
  })

  return function confirmar(texto) {
    if (resolverPendiente) return Promise.resolve(false)
    mensaje.textContent = texto
    dialogo.returnValue = ''
    return new Promise((resolve) => {
      resolverPendiente = resolve
      dialogo.showModal()
    })
  }
}
