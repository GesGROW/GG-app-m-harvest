// Respuesta de transporte simulada para caracterizar UI/cola; las pruebas SQL
// ejecutan el RPC real y no usan este helper.
export function respuestaAsignacionHarvest(parametros) {
  const {
    p_campania_id: campaniaId,
    p_codigo_ticket: codigo,
    p_dni_cosechador: trabajadorId,
    p_operacion_id: operacionId
  } = parametros
  const loteId = `LT-${campaniaId}`
  return {
    lote: { id: loteId, campania_id: campaniaId },
    ticket: { codigo, lote_id: loteId, campania_id: campaniaId },
    asignacion: {
      lote_id: loteId,
      campania_id: campaniaId,
      trabajador_id: trabajadorId,
      operacion_id: operacionId
    },
    registro: null
  }
}

export function respuestaRegistroHarvest(parametros) {
  const data = respuestaAsignacionHarvest({
    ...parametros,
    p_dni_cosechador: 'W',
    p_operacion_id: 'ASIGNACION'
  })
  data.registro = {
    id: parametros.p_lectura_id,
    codigo_ticket: parametros.p_codigo_ticket,
    lote_id: data.lote.id,
    campania_id: parametros.p_campania_id,
    trabajador_id: data.asignacion.trabajador_id,
    asignacion_operacion_id: data.asignacion.operacion_id,
    fecha_hora: parametros.p_fecha_hora,
    sesion_id: parametros.p_sesion_id,
    operacion_id: parametros.p_operacion_id
  }
  return data
}
