export function crearComercialSupabase(cliente) {
  async function rpc(nombre, parametros) {
    const { data, error } = await cliente.rpc(nombre, parametros)
    if (error) throw new Error(error.message)
    return data
  }
  return Object.freeze({
    puedeAdministrar: (tenantId) =>
      rpc('platform_puede_administrar', { p_tenant_id: tenantId }),
    consultar: (tenantId) =>
      rpc('platform_obtener_comercial', { p_tenant_id: tenantId }),
    solicitarCambio: (cambio) =>
      rpc('platform_solicitar_cambio', {
        p_operacion_id: cambio.operacionId,
        p_tenant_id: cambio.tenantId,
        p_tipo: cambio.tipoEvento,
        p_parametros: cambio.parametros,
        p_motivo: cambio.motivo,
        p_effective_at: cambio.effectiveAt
      })
  })
}
