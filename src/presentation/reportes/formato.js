export function formatearNumero(valor) {
  return Number(valor || 0).toLocaleString('es-PE')
}

export function formatearKg(valor, paquetes) {
  return paquetes === 0 ? '0' : valor == null ? 'N/A' : formatearNumero(valor)
}

export function totalPaquetes(filas) {
  return filas.reduce(
    (total, fila) => total + (fila.total_paquetes ?? fila.total_jabas ?? 0),
    0
  )
}
