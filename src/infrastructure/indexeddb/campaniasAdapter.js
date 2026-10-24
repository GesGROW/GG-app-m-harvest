export function crearCampaniasIndexedDB(db) {
  return Object.freeze({
    obtenerActiva: () => db.obtenerCampaniaActiva(),
    seleccionar: (id) => db.seleccionarCampaniaLocal(id),
    obtenerCache: (id) => db.obtenerCacheCampania(id),
    guardarCache: (cache) => db.guardarCache(cache)
  })
}
