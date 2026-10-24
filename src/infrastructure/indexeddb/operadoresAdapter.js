export function crearOperadoresIndexedDB(db) {
  return Object.freeze({
    obtener: (dni) => db.obtenerOperador(dni),
    guardar: (operador) => db.guardarOperador(operador)
  })
}
