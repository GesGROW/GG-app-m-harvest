export const VERSION_LECTOR = 'L3'

// Conservar la estructura del texto y sus controles, nunca los dígitos del DNI
// o del ticket. JSON.stringify distinguirá CR real (\r) de texto literal (\\r).
function ocultarDigitos(valor) {
  return String(valor ?? '').replace(/\p{N}/gu, '#')
}

export function describirValorScanner(valor) {
  const texto = String(valor ?? '')
  const normalizado = texto.trim()
  return {
    caracteres: texto.length,
    digitos: (texto.match(/[0-9]/g) ?? []).length,
    caracteresTrasTrim: normalizado.length,
    dniValido: /^\d{8}$/.test(normalizado),
    muestra: ocultarDigitos(texto).slice(0, 100),
    extras: [...new Set([...texto].filter((letra) => !/[0-9]/.test(letra)))]
      .slice(0, 20)
      .map((letra) => ({
        caracter: ocultarDigitos(letra),
        codigo: `U+${letra.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
      }))
  }
}

export function crearRegistroScanner(campo, reloj = () => performance.now()) {
  let inicio = reloj()
  let eventos = []
  let ultimaValidacion = null

  return {
    registrar(tipo, valor, event = {}) {
      const entrada = {
        ms: Math.round(reloj() - inicio),
        tipo,
        valor: describirValorScanner(valor)
      }
      if (event.key !== undefined) entrada.key = ocultarDigitos(event.key)
      if (event.code !== undefined) {
        entrada.code = /^(Digit|Numpad)\d$/.test(event.code)
          ? event.code.replace(/\d/g, '#')
          : event.code
      }
      // Los códigos de teclas numéricas también revelan el dígito escaneado.
      if (event.keyCode !== undefined) {
        entrada.keyCode = [0, 13, 229].includes(event.keyCode)
          ? event.keyCode
          : 'omitido'
      }
      if (event.inputType !== undefined) entrada.inputType = event.inputType
      if (event.data !== undefined) {
        entrada.data =
          event.data === null ? null : ocultarDigitos(event.data).slice(0, 100)
      }
      if (event.isComposing !== undefined) entrada.componiendo = event.isComposing
      if (event.repeat !== undefined) entrada.repetido = event.repeat
      eventos.push(entrada)
      eventos = eventos.slice(-80)
      if (tipo === 'procesar') ultimaValidacion = entrada
    },
    obtener() {
      return { version: VERSION_LECTOR, campo, ultimaValidacion, eventos: [...eventos] }
    },
    limpiar() {
      eventos = []
      ultimaValidacion = null
      inicio = reloj()
    }
  }
}
