import {
  ErrorPersistenciaTickets,
  LoteDeTicketsDuplicado,
  TicketDuplicado,
  TicketNoEncontrado,
  TicketSinLote,
  LoteYaAsignado,
  CampaniaTicketIncorrecta,
  TicketYaUtilizado,
  LoteSinAsignar,
  SesionCosechaInvalida,
  validarSnapshotHarvest,
  EscrituraLegacyRetirada,
  CampaniaSinCutover
} from '@gesgrow/core/contexts/harvest/index.js'
import { ErrorBackend, OperacionNoDisponible } from '@gesgrow/core/backend/errores.js'
import {
  reconstituirCatalogoTicket,
  serializarGeneracionTickets
} from './harvestTicketsMapper.js'

export function crearRepositorioTicketsHarvestSupabase(supabase) {
  async function consultar(nombre, parametros, operativa = false) {
    try {
      const { data, error } = await supabase.rpc(nombre, parametros)
      if (error) throw error
      return data
    } catch (error) {
      if (operativa) {
        if (error?.message === 'harvest_legacy_solo_lectura')
          throw new EscrituraLegacyRetirada()
        if (error?.message === 'harvest_campania_sin_cutover')
          throw new CampaniaSinCutover()
        if (error?.message === 'harvest_ticket_no_encontrado')
          throw new TicketNoEncontrado(parametros.p_codigo_ticket)
        if (error?.message === 'harvest_ticket_sin_lote')
          throw new TicketSinLote(parametros.p_codigo_ticket)
        if (error?.message === 'harvest_campania_incorrecta')
          throw new CampaniaTicketIncorrecta(parametros.p_codigo_ticket)
        if (error?.message === 'harvest_lote_ya_asignado')
          throw new LoteYaAsignado(error.details)
        if (error?.message === 'harvest_ticket_ya_utilizado')
          throw new TicketYaUtilizado(parametros.p_codigo_ticket)
        if (error?.message === 'harvest_lote_sin_asignar')
          throw new LoteSinAsignar(error.details)
        if (error?.message === 'harvest_sesion_invalida')
          throw new SesionCosechaInvalida(parametros.p_sesion_id)
        if (error?.code === 'PGRST202')
          throw new OperacionNoDisponible(
            nombre === 'harvest_registrar_cosecha'
              ? 'El registro de cosecha requiere actualizar el sistema en Supabase.'
              : 'La asignación por lote requiere actualizar el sistema en Supabase.',
            { status: 400 }
          )
        // SQLSTATE numéricos (23505, 23503, etc.) no son estados HTTP.
        const status = Number(error?.status ?? error?.code)
        throw Object.assign(
          new ErrorBackend(error?.message, {
            status:
              status === 0 || (status >= 100 && status <= 599) ? status : undefined
          }),
          {
            accesoDenegado:
              error?.accesoDenegado ||
              error?.code === '42501' ||
              [401, 403].includes(status)
          }
        )
      }
      if (error?.code === '23505' && error.message === 'harvest_ticket_duplicado')
        throw new TicketDuplicado(error.details)
      if (error?.code === '23505' && error.message === 'harvest_lote_duplicado')
        throw new LoteDeTicketsDuplicado(error.details)
      throw new ErrorPersistenciaTickets(
        'No se pudo completar la operación de tickets Harvest.',
        { causa: error }
      )
    }
  }
  return Object.freeze({
    async obtenerSnapshotHarvest(dniOperador, campaniaId) {
      const snapshot = await consultar(
        'harvest_obtener_snapshot',
        { p_campania_id: campaniaId, p_dni_operador: dniOperador },
        true
      )
      validarSnapshotHarvest(snapshot)
      if (snapshot.campaniaId !== campaniaId || snapshot.operadorDni !== dniOperador)
        throw new ErrorPersistenciaTickets(
          'La instantánea no corresponde al contexto solicitado.'
        )
      return snapshot
    },
    async procesarV4(tipo, args, modeloSolicitado) {
      const parametros = {
        p_campania_id: args.campaniaId,
        p_dni_operador: args.dniOperador,
        p_codigo_ticket: args.codigoTicket,
        p_operacion_id: args.operacionId
      }
      if (tipo === 'ASIGNAR_TICKET') parametros.p_dni_cosechador = args.dniCosechador
      else
        Object.assign(parametros, {
          p_sesion_id: args.sesionId,
          p_lectura_id: args.lecturaId,
          p_fecha_hora: args.fechaHora
        })
      const respuesta = await consultar(
        modeloSolicitado === 'LEGACY'
          ? tipo === 'ASIGNAR_TICKET'
            ? 'asignar_ticket_campania'
            : 'registrar_lectura_jaba_campania'
          : tipo === 'ASIGNAR_TICKET'
            ? 'harvest_asignar_v4'
            : 'harvest_registrar_v4',
        parametros,
        true
      )
      const data =
        modeloSolicitado === 'LEGACY'
          ? { modelo: 'LEGACY', resultado: respuesta }
          : respuesta
      if (data?.modelo === 'LEGACY') return { legacy: true, resultado: data.resultado }
      if (data?.modelo !== 'HARVEST')
        throw new ErrorPersistenciaTickets(
          'La respuesta de compatibilidad v4 no tiene un modelo explícito.'
        )
      const catalogo = reconstituirCatalogoTicket(data.resultado, {
        campaniaId: args.campaniaId,
        codigoTicket: args.codigoTicket
      })
      const lote = catalogo.identificarLote(args.codigoTicket)
      const ticket = catalogo.obtenerTicket(args.codigoTicket)
      return {
        catalogo,
        lote,
        ticket,
        asignacion: lote.asignacion,
        registro: ticket.registroCosecha
      }
    },
    async guardarLotesConTickets(generacion) {
      await consultar('harvest_crear_lotes_tickets', {
        p_campania_id: generacion.campaniaId,
        p_lotes: serializarGeneracionTickets(generacion)
      })
    },
    async resolverCatalogoPorCodigo({ campaniaId, codigoTicket }) {
      const data = await consultar('harvest_resolver_ticket', {
        p_campania_id: campaniaId,
        p_codigo: codigoTicket
      })
      if (!data) throw new TicketNoEncontrado(codigoTicket)
      return reconstituirCatalogoTicket(data, { campaniaId, codigoTicket })
    },
    async asignarLoteDesdeTicket({
      campaniaId,
      codigoTicket,
      dniOperador,
      dniCosechador,
      operacionId
    }) {
      const data = await consultar(
        'harvest_asignar_lote_tickets',
        {
          p_campania_id: campaniaId,
          p_codigo_ticket: codigoTicket,
          p_dni_operador: dniOperador,
          p_dni_cosechador: dniCosechador,
          p_operacion_id: operacionId
        },
        true
      )
      return reconstituirCatalogoTicket(data, { campaniaId, codigoTicket })
    },
    async registrarCosecha({
      campaniaId,
      codigoTicket,
      dniOperador,
      sesionId,
      registroId,
      fechaHora,
      operacionId
    }) {
      const data = await consultar(
        'harvest_registrar_cosecha',
        {
          p_campania_id: campaniaId,
          p_codigo_ticket: codigoTicket,
          p_dni_operador: dniOperador,
          p_sesion_id: sesionId,
          p_lectura_id: registroId,
          p_fecha_hora: fechaHora,
          p_operacion_id: operacionId
        },
        true
      )
      const catalogo = reconstituirCatalogoTicket(data, { campaniaId, codigoTicket })
      const registro = catalogo.obtenerTicket(codigoTicket).registroCosecha
      if (
        !registro ||
        registro.sesionId !== sesionId ||
        registro.operacionId !== operacionId
      )
        throw new ErrorPersistenciaTickets(
          'El registro confirmado no corresponde a la operación de cosecha.'
        )
      return catalogo
    }
  })
}
