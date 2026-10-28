export function crearHarvestIndexedDB(db) {
  return Object.freeze({
    reservarAsignacion: (args) => db.reservarAsignacionHarvest(args),
    reservarConsumo: (args) => db.reservarConsumoHarvest(args),
    guardarSnapshot: (snapshot) => db.guardarSnapshotHarvest(snapshot),
    obtenerModeloOperativo: (campaniaId) => db.obtenerModeloOperativoHarvest(campaniaId)
  })
}
