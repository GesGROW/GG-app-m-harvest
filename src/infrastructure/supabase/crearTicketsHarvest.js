import {
  crearGenerarLotesDeTickets,
  crearResolverCatalogoDeTickets,
  crearAsignarLoteDeTickets,
  crearRegistrarCosecha
} from '@gesgrow/core/contexts/harvest/index.js'
import { crearGeneradorCodigoTicketAleatorio } from '../harvest/generadorCodigoTicket.js'
import { crearRepositorioTicketsHarvestSupabase } from './harvestTicketsAdapter.js'

// Composición optativa e independiente; no altera bootstrap ni los flujos PDA.
export function crearTicketsHarvest({
  supabase,
  generarIdLote = () => globalThis.crypto.randomUUID(),
  generadorCodigoTicket = crearGeneradorCodigoTicketAleatorio()
}) {
  const repositorioTickets = crearRepositorioTicketsHarvestSupabase(supabase)
  return Object.freeze({
    generarLotesDeTickets: crearGenerarLotesDeTickets({
      repositorioTickets,
      generadorCodigoTicket,
      generarIdLote
    }),
    resolverCatalogoDeTickets: crearResolverCatalogoDeTickets({ repositorioTickets }),
    asignarLoteDeTickets: crearAsignarLoteDeTickets({ repositorioTickets }),
    registrarCosecha: crearRegistrarCosecha({ repositorioTickets })
  })
}
