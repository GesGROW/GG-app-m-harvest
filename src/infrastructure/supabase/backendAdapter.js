import { ErrorBackend, OperacionNoDisponible } from '@gesgrow/core/backend/errores.js'
import { parametrosCampania } from './campania.js'
import {
  crearAsignarLoteDeTickets,
  crearRegistrarCosecha
} from '@gesgrow/core/contexts/harvest/index.js'
import { crearRepositorioTicketsHarvestSupabase } from './harvestTicketsAdapter.js'

// El cliente se inyecta para poder verificar el contrato de transporte sin SDK.
export function crearSupabaseBackend(supabase) {
  const repositorioTickets = crearRepositorioTicketsHarvestSupabase(supabase)
  const asignarLoteDeTickets = crearAsignarLoteDeTickets({ repositorioTickets })
  const registrarCosecha = crearRegistrarCosecha({ repositorioTickets })
  async function consultar(nombre, parametros, mensajeNoDisponible) {
    try {
      const { data, error } =
        parametros === undefined
          ? await supabase.rpc(nombre)
          : await supabase.rpc(nombre, parametros)
      if (error) throw error
      return data
    } catch (error) {
      const status = Number(error?.status || error?.code)
      if (error?.code === 'PGRST202') {
        throw new OperacionNoDisponible(mensajeNoDisponible || error.message, {
          status
        })
      }
      throw new ErrorBackend(error?.message, { status })
    }
  }

  function consultarCampania(campaniaId, nombre, parametros, mensajeNoDisponible) {
    return consultar(
      ...parametrosCampania(campaniaId, nombre, parametros),
      mensajeNoDisponible
    )
  }

  return Object.freeze({
    validarOperador(dni) {
      return consultar('validar_operador_campanias', { p_dni: dni })
    },
    async obtenerCacheOperativa(dniOperador, campaniaId) {
      const cache = await consultarCampania(campaniaId, 'obtener_cache_operativa', {
        p_dni_operador: dniOperador
      })
      if (
        campaniaId &&
        cache?.campania &&
        Array.isArray(cache.trabajadores) &&
        Array.isArray(cache.tickets) &&
        Array.isArray(cache.lotes)
      )
        return {
          ...cache,
          harvest: await repositorioTickets.obtenerSnapshotHarvest(
            dniOperador,
            campaniaId
          )
        }
      return cache
    },
    obtenerSnapshotHarvest: (dni, campaniaId) =>
      repositorioTickets.obtenerSnapshotHarvest(dni, campaniaId),
    asignarTicket({
      dniOperador,
      campaniaId,
      dniCosechador,
      codigoTicket,
      operacionId,
      compatibilidadV4 = false,
      modeloSolicitado
    }) {
      if (compatibilidadV4 || modeloSolicitado === 'LEGACY')
        return repositorioTickets.procesarV4(
          'ASIGNAR_TICKET',
          {
            dniOperador,
            campaniaId,
            dniCosechador,
            codigoTicket,
            operacionId
          },
          modeloSolicitado
        )
      // Alias de transporte conservado para ASIGNAR_TICKET. Sin fallback a
      // la asignación por ticket ni inferencia de campaña cuando falta contexto.
      return asignarLoteDeTickets({
        operador: { dni: dniOperador },
        campania: { id: campaniaId },
        cosechador: { dni: dniCosechador },
        codigoTicket,
        operacionId
      })
    },
    registrarJabero({ dniOperador, dniTrabajador, operacionId, campaniaId }) {
      return consultarCampania(campaniaId, 'registrar_jabero', {
        p_dni_operador: dniOperador,
        p_dni_trabajador: dniTrabajador,
        p_operacion_id: operacionId
      })
    },
    listarLotesActivos() {
      return consultar('listar_lotes_activos_v2')
    },
    iniciarSesionLectura({
      dniOperador,
      campaniaId,
      dniJabero,
      loteId,
      variedadId,
      sesionId
    }) {
      return consultarCampania(campaniaId, 'iniciar_sesion_lectura', {
        p_dni_operador: dniOperador,
        p_dni_jabero: dniJabero,
        p_lote_id: loteId,
        p_sesion_id: sesionId,
        ...(variedadId ? { p_variedad_id: variedadId } : {})
      })
    },
    registrarLecturaJaba({
      dniOperador,
      campaniaId,
      sesionId,
      codigoTicket,
      lecturaId = crypto.randomUUID(),
      fechaHora = new Date().toISOString(),
      operacionId,
      compatibilidadV4 = false,
      modeloSolicitado
    }) {
      if (compatibilidadV4 || modeloSolicitado === 'LEGACY')
        return repositorioTickets.procesarV4(
          'REGISTRAR_JABA',
          {
            dniOperador,
            campaniaId,
            sesionId,
            codigoTicket,
            lecturaId,
            fechaHora,
            operacionId
          },
          modeloSolicitado
        )
      // REGISTRAR_JABA conserva transporte/payload. Su confirmación ahora es
      // consumo único Harvest; no escribe ni convierte lecturas históricas.
      return registrarCosecha({
        operador: { dni: dniOperador },
        campania: { id: campaniaId },
        sesionId,
        codigoTicket,
        registroId: lecturaId,
        fechaHora,
        operacionId
      })
    },
    cerrarSesionLectura({ dniOperador, sesionId, operacionId, campaniaId }) {
      return consultarCampania(campaniaId, 'cerrar_sesion_lectura', {
        p_dni_operador: dniOperador,
        p_sesion_id: sesionId,
        p_operacion_id: operacionId
      })
    },
    obtenerProduccionDiaria({ dniOperador, zonaHoraria, campaniaId }) {
      return consultarCampania(
        campaniaId,
        'obtener_produccion_diaria',
        {
          p_dni_operador: dniOperador,
          p_zona_horaria: zonaHoraria
        },
        'Producción por día no está disponible. Solicite a Administración que habilite el reporte.'
      )
    },
    obtenerProduccionLotes({ dniOperador, campaniaId }) {
      return consultarCampania(campaniaId, 'obtener_produccion_lotes', {
        p_dni_operador: dniOperador
      })
    },
    obtenerResumenCampania({ dniOperador, zonaHoraria, campaniaId }) {
      return consultarCampania(campaniaId, 'obtener_resumen_campania', {
        p_dni_operador: dniOperador,
        p_zona_horaria: zonaHoraria
      })
    },
    obtenerRankingCosechadores({ dniOperador, periodo = 'HOY', campaniaId }) {
      return consultarCampania(
        campaniaId,
        'obtener_ranking_cosechadores_periodo',
        {
          p_dni_operador: dniOperador,
          p_periodo: periodo
        },
        'El ranking por período requiere actualizar el sistema en Supabase.'
      )
    }
  })
}
