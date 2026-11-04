export function crearTecladosManuales({ document, configurarTecladoManual }) {
  const teclados = new Map(
    [
      ['dni-operador', 'numeric'],
      ['dni-cosechador', 'numeric'],
      ['codigo-ticket', 'text'],
      ['dni-jabero', 'numeric'],
      ['dni-jabero-lectura', 'numeric'],
      ['ticket-lectura', 'text']
    ].map(([id, modo]) => {
      const input = document.querySelector(`#${id}`)
      return [
        input,
        configurarTecladoManual(
          input,
          input.parentElement.querySelector('.btn-teclado'),
          modo
        )
      ]
    })
  )
  return Object.freeze({
    desactivar(...inputs) {
      for (const input of inputs.length ? inputs : teclados.keys())
        teclados.get(input)?.()
    }
  })
}
