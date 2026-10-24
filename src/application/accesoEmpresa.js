import {
  crearAccesoAutenticado,
  AccesoDenegado
} from '@gesgrow/core/contexts/identity-access/index.js'
import { crearEntitlements, ModuloNoHabilitado } from '@gesgrow/core/contexts/platform/index.js'

export function crearAccesoEmpresa({ identity, acceso, entitlements }) {
  const sesion = crearAccesoAutenticado({ identity, acceso })
  const capacidades = crearEntitlements({ entitlements })
  const ejecutar = async (permiso, accion, modulo = null) => {
    const contexto = await sesion.autorizar(permiso)
    if (modulo) await capacidades.exigirModulo(contexto.tenantId, modulo)
    return accion(contexto)
  }
  const porCampania = async (permiso, datos, accion) =>
    ejecutar(
      permiso,
      async (contexto) => {
        // Comprobar selección activa aquí; el RPC revalida campaña y membresía.
        const campanias = await acceso.listarCampanias(contexto.tenantId)
        if (!campanias.some((c) => c.id === datos.campaniaId))
          throw new Error('La campaña no pertenece a la empresa seleccionada.')
        return accion()
      },
      'HARVEST'
    )
  return Object.freeze({
    ...sesion,
    tenantContext: Object.freeze({ obtener: sesion.obtener }),
    async modulosHabilitados() {
      return capacidades.modulosHabilitados((await sesion.obtener()).tenantId)
    },
    listarEquipo: () =>
      ejecutar('company.manage', (c) => acceso.listarEquipo(c.tenantId)),
    guardarMembresia: (datos) =>
      ejecutar('company.manage', (c) => acceso.guardarMembresia(c.tenantId, datos)),
    obtenerEmpresa: () =>
      ejecutar('company.manage', (c) => acceso.consultarEmpresa(c.tenantId)),
    guardarEmpresa: (nombre) =>
      ejecutar('company.manage', (c) => acceso.guardarEmpresa(c.tenantId, nombre)),
    async listarCampanias() {
      const c = await sesion.obtener()
      if (
        !['harvest.view', 'campaign.manage', 'reports.view', 'harvest.operate'].some(
          (p) => c.permite(p)
        )
      )
        throw new AccesoDenegado('No tiene permiso para consultar campañas.')
      const gestion =
        c.permite('campaign.manage') &&
        (await capacidades.puedeUsarModulo(c.tenantId, 'CAMPAIGN'))
      const cosecha =
        ['harvest.view', 'harvest.operate', 'reports.view'].some((p) => c.permite(p)) &&
        (await capacidades.puedeUsarModulo(c.tenantId, 'HARVEST'))
      if (!gestion && !cosecha) throw new ModuloNoHabilitado('CAMPAIGN/HARVEST')
      return acceso.listarCampanias(c.tenantId)
    },
    guardarCampania: (datos) =>
      ejecutar(
        'campaign.manage',
        (c) => acceso.guardarCampania(c.tenantId, datos),
        'CAMPAIGN'
      ),
    listarTrabajadores: () =>
      ejecutar(
        'workforce.manage',
        (c) => acceso.listarTrabajadores(c.tenantId),
        'WORKFORCE'
      ),
    guardarTrabajador: (datos) =>
      ejecutar(
        'workforce.manage',
        (c) => acceso.guardarTrabajador(c.tenantId, datos),
        'WORKFORCE'
      ),
    obtenerReporte: (campaniaId, tipo, periodo) =>
      porCampania('reports.view', { campaniaId }, () =>
        acceso.obtenerReporte(campaniaId, tipo, periodo)
      ),
    consultarTicket: (campaniaId, codigo) =>
      porCampania('harvest.view', { campaniaId }, () =>
        acceso.consultarTicket(campaniaId, codigo)
      ),
    recursosCampania: (campaniaId) =>
      porCampania('harvest.view', { campaniaId }, () =>
        acceso.recursosCampania(campaniaId)
      ),
    activarHarvest: (campaniaId) =>
      porCampania('campaign.manage', { campaniaId }, () =>
        acceso.activarHarvest(campaniaId)
      ),
    asignarLote: (datos) =>
      porCampania('harvest.operate', datos, () => acceso.asignarLote(datos)),
    iniciarSesionLectura: (datos) =>
      porCampania('harvest.operate', datos, () => acceso.iniciarSesionLectura(datos)),
    registrarCosecha: (datos) =>
      porCampania('harvest.operate', datos, () => acceso.registrarCosecha(datos)),
    cerrarSesionLectura: (campaniaId, sesionId) =>
      porCampania('harvest.operate', { campaniaId }, () =>
        acceso.cerrarSesionLectura(campaniaId, sesionId)
      )
  })
}
