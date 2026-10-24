export function crearHarvestIndexedDB(db) {
  return Object.freeze({
    reservarAsignacion: (args) => db.reservarAsignacionHarvest(args),
    reservarConsumo: (args) => db.reservarConsumoHarvest(args),
    obtenerModeloOperativo: (campaniaId) => db.obtenerModeloOperativoHarvest(campaniaId)
  })
}
