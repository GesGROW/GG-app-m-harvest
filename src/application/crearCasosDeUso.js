import { validarPuertosOffline } from '../ports/offline/validarPuertosOffline.js'
import { crearValidarOperador } from '@gesgrow/core/contexts/identity-access/index.js'
import {
  crearIngresarCampania,
  seleccionarVariedadLote
} from '@gesgrow/core/contexts/campaign-management/index.js'
import {
  crearRegistrarJabero,
  crearBuscarCosechadorLocal,
  validarJaberoParaInicio,
  validarJaberoParaLectura
} from '@gesgrow/core/contexts/workforce/index.js'
import {
  crearAsignarTicket,
  crearIniciarSesionLectura,
  crearRegistrarLecturaJaba,
  crearCerrarSesionLectura,
  operacionesCosecha,
  crearSolicitarAsignacionHarvest,
  crearSolicitarRegistroCosecha,
  crearOperacionSegunCutover
} from '@gesgrow/core/contexts/harvest/index.js'
import { sincronizacionPosterior } from './useCases/sincronizacionPosterior.js'
import { crearResolverTenantContext } from '@gesgrow/core/contexts/platform/index.js'

// Coordinación del monolito modular: inyecta información pública mínima, sin
// permitir que los contextos importen los internos de otros contextos.
export function crearCasosDeUso(dependencias) {
  validarPuertosOffline(dependencias.offline)
  const { offline } = dependencias
  const resolverTenant = crearResolverTenantContext({
    campanias: offline.campanias,
    tenantContext: dependencias.tenantContext
  })
  const trabajadores = Object.freeze({
    obtener: (...args) => offline.cosecha.obtenerTrabajador(...args),
    registrarJabero: (...args) => offline.cosecha.registrarJabero(...args)
  })
  const cosecha = Object.freeze(
    Object.fromEntries(
      operacionesCosecha.map((nombre) => [
        nombre,
        (...args) => offline.cosecha[nombre](...args)
      ])
    )
  )
  const workforce = Object.freeze({
    obtenerTrabajador: trabajadores.obtener,
    validarJaberoParaInicio,
    validarJaberoParaLectura
  })
  const campaignManagement = Object.freeze({ seleccionarVariedadLote })
  const harvest = {
    cosecha,
    cola: offline.cola,
    workforce,
    campaignManagement,
    harvestLocal: offline.harvest,
    generarId: dependencias.generarId,
    ahora: dependencias.ahora,
    sincronizacionPosterior: (mensaje) => sincronizacionPosterior(dependencias, mensaje)
  }
  const legacyControlado = {
    ...harvest,
    cosecha: {
      ...cosecha,
      guardarAsignacion: (args) =>
        cosecha.guardarAsignacion({ ...args, modeloSolicitado: 'LEGACY' }),
      registrarLectura: (registro, dni) =>
        cosecha.registrarLectura({ ...registro, modelo: 'LEGACY' }, dni)
    }
  }
  const segunCutover = (operarHarvest, operarLegacy) =>
    crearOperacionSegunCutover({
      harvestLocal: offline.harvest,
      operarHarvest,
      operarLegacy
    })
  const casos = {
    validarOperador: crearValidarOperador({
      backend: {
        validarOperador: (...args) => dependencias.backend.validarOperador(...args)
      },
      offline: { operadores: offline.operadores },
      validarConFuentes: dependencias.validarConFuentes
    }),
    ingresarCampania: crearIngresarCampania({
      backend: {
        obtenerCacheOperativa: (...args) =>
          dependencias.backend.obtenerCacheOperativa(...args)
      },
      offline: { campanias: offline.campanias },
      esErrorTemporal: dependencias.esErrorTemporal,
      sincronizacionPosterior: harvest.sincronizacionPosterior
    }),
    registrarJabero: crearRegistrarJabero({
      trabajadores,
      sincronizacionPosterior: harvest.sincronizacionPosterior
    }),
    buscarCosechadorLocal: crearBuscarCosechadorLocal({
      trabajadores,
      campaignManagement: { obtenerActiva: () => offline.campanias.obtenerActiva() }
    }),
    asignarTicket: offline.harvest
      ? segunCutover(
          crearSolicitarAsignacionHarvest(harvest),
          crearAsignarTicket(legacyControlado)
        )
      : crearAsignarTicket(harvest),
    iniciarSesionLectura: crearIniciarSesionLectura(harvest),
    registrarLecturaJaba: offline.harvest
      ? segunCutover(
          crearSolicitarRegistroCosecha(harvest),
          crearRegistrarLecturaJaba(legacyControlado)
        )
      : crearRegistrarLecturaJaba(harvest),
    cerrarSesionLectura: crearCerrarSesionLectura(harvest)
  }
  // Ownership se resuelve desde la campaña persistida. La autoridad remota
  // continúa en los RPC; el puerto Identity de F6.2 podrá reforzar este límite.
  for (const nombre of [
    'asignarTicket',
    'iniciarSesionLectura',
    'registrarLecturaJaba',
    'registrarJabero',
    'cerrarSesionLectura'
  ]) {
    const ejecutar = casos[nombre]
    casos[nombre] = async (args) => {
      const id = args.operador?.campania?.id
      const recursos = [
        args.operador?.campania,
        args.cosechador,
        args.sesionLectura
      ].filter((r) => r && (r.tenantId !== undefined || r.tenant_id !== undefined))
      if (id && (dependencias.tenantContext || recursos.length)) {
        await resolverTenant(id, ...recursos)
      }
      return ejecutar(args)
    }
  }
  return Object.freeze(casos)
}
