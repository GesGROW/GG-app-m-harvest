import { AccesoDenegado } from '@gesgrow/core/contexts/identity-access/index.js'

export function crearAccesoSupabase(cliente) {
  async function consultar(nombre, parametros) {
    const { data, error } = await cliente.rpc(nombre, parametros)
    if (error) throw new AccesoDenegado(error.message)
    return data
  }
  return Object.freeze({
    obtenerIdentidad: () => consultar('iam_obtener_identidad'),
    resolverContexto: (tenantId) =>
      consultar('iam_resolver_tenant_context', { p_tenant_id: tenantId }),
    listarEquipo: (tenantId) =>
      consultar('iam_listar_equipo', { p_tenant_id: tenantId }),
    guardarMembresia: (tenantId, datos) =>
      consultar('iam_guardar_membresia', {
        p_tenant_id: tenantId,
        p_usuario_id: datos.usuarioId,
        p_activo: datos.activo,
        p_roles: datos.roles,
        p_trabajador_id: datos.trabajadorId ?? null
      }),
    consultarEmpresa: (tenantId) =>
      consultar('iam_obtener_empresa', { p_tenant_id: tenantId }),
    guardarEmpresa: (tenantId, nombre) =>
      consultar('iam_guardar_empresa', { p_tenant_id: tenantId, p_nombre: nombre }),
    listarCampanias: (tenantId) =>
      consultar('iam_listar_campanias', { p_tenant_id: tenantId }),
    guardarCampania: (tenantId, datos) =>
      consultar('iam_guardar_campania', {
        p_tenant_id: tenantId,
        p_id: datos.id ?? null,
        p_codigo: datos.codigo,
        p_nombre: datos.nombre,
        p_cultivo_id: datos.cultivoId,
        p_estado: datos.estado
      }),
    listarTrabajadores: (tenantId) =>
      consultar('iam_listar_trabajadores', { p_tenant_id: tenantId }),
    guardarTrabajador: (tenantId, datos) =>
      consultar('iam_guardar_trabajador', {
        p_tenant_id: tenantId,
        p_id: datos.id ?? null,
        p_dni: datos.dni,
        p_nombres: datos.nombres,
        p_apellidos: datos.apellidos,
        p_activo: datos.activo
      }),
    obtenerReporte: (campaniaId, tipo, periodo = 'CAMPANIA') =>
      consultar('iam_obtener_reporte', {
        p_campania_id: campaniaId,
        p_tipo: tipo,
        p_periodo: periodo
      }),
    consultarTicket: (campaniaId, codigo) =>
      consultar('iam_consultar_ticket', {
        p_campania_id: campaniaId,
        p_codigo: codigo
      }),
    recursosCampania: (campaniaId) =>
      consultar('iam_recursos_campania', { p_campania_id: campaniaId }),
    activarHarvest: (campaniaId) =>
      consultar('iam_activar_harvest', { p_campania_id: campaniaId }),
    asignarLote: (datos) =>
      consultar('iam_asignar_lote', {
        p_campania_id: datos.campaniaId,
        p_trabajador_id: datos.trabajadorId,
        p_codigo: datos.codigo,
        p_operacion_id: datos.operacionId
      }),
    iniciarSesionLectura: (datos) =>
      consultar('iam_iniciar_sesion_lectura', {
        p_campania_id: datos.campaniaId,
        p_lote_id: datos.loteId,
        p_variedad_id: datos.variedadId,
        p_jabero_rol_id: datos.jaberoRolId,
        p_id: datos.id
      }),
    registrarCosecha: (datos) =>
      consultar('iam_registrar_cosecha', {
        p_campania_id: datos.campaniaId,
        p_sesion_id: datos.sesionId,
        p_codigo: datos.codigo,
        p_id: datos.id,
        p_operacion_id: datos.operacionId,
        p_fecha: datos.fecha
      }),
    cerrarSesionLectura: (campaniaId, sesionId) =>
      consultar('iam_cerrar_sesion_lectura', {
        p_campania_id: campaniaId,
        p_id: sesionId
      })
  })
}
