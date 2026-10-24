// Política provisional intercambiable: UUID opaco, sin prefijo ni semántica.
// PostgreSQL sigue siendo la autoridad de unicidad, incluso con otro generador.
export function crearGeneradorCodigoTicketAleatorio({
  generarIdentificador = () => globalThis.crypto.randomUUID()
} = {}) {
  return Object.freeze({ generar: () => generarIdentificador() })
}
