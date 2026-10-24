export function crearEntitlementsSupabase(cliente) {
  return Object.freeze({
    async puedeUsarModulo(tenantId, modulo) {
      const { data, error } = await cliente.rpc('platform_puede_usar_modulo', {
        p_tenant_id: tenantId,
        p_modulo: modulo
      })
      if (error) throw new Error(error.message)
      return data === true
    }
  })
}
