export function snapshotHarvest({
  campaniaId = 'C',
  operadorDni = '12345678',
  codigos = ['T1', 'T2'],
  loteId = 'LT',
  asignacion = null,
  registros = [],
  cutover
} = {}) {
  return {
    versionContrato: 1,
    tipo: 'SNAPSHOT',
    completo: true,
    snapshotId: crypto.randomUUID(),
    campaniaId,
    operadorDni,
    obtenidoEn: new Date().toISOString(),
    codigosLegacy: [],
    ...(cutover !== undefined ? { cutover } : {}),
    lotesDeTickets: codigos.length
      ? [
          {
            id: loteId,
            campaniaId,
            estado: asignacion ? 'ASIGNADO' : 'DISPONIBLE',
            asignacionOperacionId: asignacion?.operacionId ?? null
          }
        ]
      : [],
    asignacionesDeLote: asignacion ? [{ ...asignacion, loteId, campaniaId }] : [],
    tickets: codigos.map((codigo) => {
      const r = registros.find((r) => r.codigoTicket === codigo)
      return {
        codigo,
        loteId,
        campaniaId,
        estado: r ? 'UTILIZADO' : 'DISPONIBLE',
        registroId: r?.id ?? null,
        consumoOperacionId: r?.operacionId ?? null
      }
    }),
    registrosCosecha: registros.map((r) => ({
      ...r,
      loteId,
      campaniaId,
      trabajadorId: asignacion.trabajadorId,
      asignacionOperacionId: asignacion.operacionId
    }))
  }
}
