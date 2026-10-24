export function parametrosCampania(campaniaId, nombre, parametros) {
  return campaniaId
    ? [`${nombre}_campania`, { ...parametros, p_campania_id: campaniaId }]
    : [nombre, parametros]
}
