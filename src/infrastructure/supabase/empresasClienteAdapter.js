import { EmpresaCliente } from '@gesgrow/core/contexts/platform/index.js'

// Se inyecta únicamente un cliente administrativo de confianza; RLS no abre
// gestión de empresas a la PWA anon ni a integraciones de archivos existentes.
export function crearEmpresasClienteSupabase(clienteAdministrativo) {
  return Object.freeze({
    async guardar(empresa) {
      const entidad = new EmpresaCliente(empresa)
      const { error } = await clienteAdministrativo.from('tenants').insert({
        id: entidad.id,
        nombre: entidad.nombre,
        codigo: entidad.codigo,
        estado: entidad.estado,
        created_at: entidad.createdAt
      })
      if (error) throw error
    }
  })
}
