// Mantener las peticiones dentro de la transacción, sin una espera por registro.
// Los lotes acotan la memoria; Promise.all observa también los errores de aborto.
export async function procesarEnLotes(filas, procesar) {
  for (let inicio = 0; inicio < filas.length; inicio += 256) {
    await Promise.all(filas.slice(inicio, inicio + 256).map(procesar))
  }
}
