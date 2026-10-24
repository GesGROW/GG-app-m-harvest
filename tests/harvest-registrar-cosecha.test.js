import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CatalogoDeTickets,
  LoteDeTickets,
  Ticket,
  RegistroCosecha,
  DatoDeTicketsInvalido,
  ErrorPersistenciaTickets,
  TicketYaUtilizado,
  TicketNoEncontrado,
  LoteSinAsignar,
  SesionCosechaInvalida,
  CampaniaTicketIncorrecta,
  crearRegistrarCosecha
} from '@gesgrow/core/contexts/harvest/index.js'
import { crearSupabaseBackend } from '../src/infrastructure/supabase/backendAdapter.js'
import { crearRepositorioTicketsHarvestSupabase } from '../src/infrastructure/supabase/harvestTicketsAdapter.js'
import { reconstituirCatalogoTicket } from '../src/infrastructure/supabase/harvestTicketsMapper.js'
import { ErrorBackend, OperacionNoDisponible } from '@gesgrow/core/backend/errores.js'
import { esErrorTemporal } from '@gesgrow/core/shared/erroresConexion.js'
import { respuestaRegistroHarvest } from './helpers/asignacionHarvest.js'

const contexto = {
  codigoTicket: 'T',
  operador: { dni: '12345678', campania: { id: 'C' } },
  sesionId: 'S',
  registroId: 'R',
  fechaHora: '2026-10-14T12:00:00Z',
  operacionId: 'OP'
}

function catalogo(consumido = true) {
  const lote = new LoteDeTickets({ id: 'L', campaniaId: 'C' })
  lote.asignar({ trabajadorId: 'TRABAJADOR-DEL-LOTE', operacionId: 'ASIG' })
  const ticket = new Ticket({ codigo: 'T', loteId: lote.id })
  if (consumido)
    ticket.registrarCosecha({
      id: 'R',
      lote,
      fechaHora: contexto.fechaHora,
      sesionId: 'S',
      operacionId: 'OP'
    })
  return new CatalogoDeTickets({ lotes: [lote], tickets: [ticket] })
}

test('RegistrarCosecha pasa solo el contexto operativo y devuelve trabajador derivado del lote', async () => {
  const respuesta = catalogo()
  const llamadas = []
  const caso = crearRegistrarCosecha({
    repositorioTickets: {
      registrarCosecha: async (args) => {
        llamadas.push(args)
        return respuesta
      }
    }
  })
  const resultado = await caso({
    ...contexto,
    trabajadorId: 'CLIENTE-FALSO',
    cosechador: { dni: '87654321' }
  })
  assert.deepEqual(llamadas, [
    {
      codigoTicket: 'T',
      campaniaId: 'C',
      dniOperador: '12345678',
      sesionId: 'S',
      registroId: 'R',
      fechaHora: contexto.fechaHora,
      operacionId: 'OP'
    }
  ])
  assert.ok(resultado.registro instanceof RegistroCosecha)
  assert.equal(resultado.registro.trabajadorId, 'TRABAJADOR-DEL-LOTE')
  assert.equal(resultado.registro.sesionId, 'S')
  assert.equal(resultado.registro.operacionId, 'OP')
  assert.equal(resultado.ticket.estado, 'UTILIZADO')
  assert.strictEqual(resultado.ticket.registroCosecha, resultado.registro)
})

test('la misma operación puede devolver el registro original sin generar un nuevo consumo en Domain', async () => {
  const respuesta = catalogo()
  const caso = crearRegistrarCosecha({
    repositorioTickets: { registrarCosecha: async () => respuesta }
  })
  const original = await caso(contexto)
  const repetido = await caso({
    ...contexto,
    registroId: 'OTRA-PROPUESTA',
    fechaHora: '2026-10-15T00:00:00Z'
  })
  assert.strictEqual(repetido.registro, original.registro)
  assert.equal(repetido.registro.id, 'R')
  assert.equal(repetido.registro.fechaHora, contexto.fechaHora)
})

test('contexto incompleto se rechaza antes del puerto y las confirmaciones sin registro no son éxito', async () => {
  let llamadas = 0
  const caso = crearRegistrarCosecha({
    repositorioTickets: {
      registrarCosecha: async () => {
        llamadas++
        return catalogo(false)
      }
    }
  })
  for (const campo of [
    'codigoTicket',
    'sesionId',
    'registroId',
    'fechaHora',
    'operacionId'
  ])
    await assert.rejects(caso({ ...contexto, [campo]: '' }), DatoDeTicketsInvalido)
  for (const cambio of [{ operador: null }, { campania: {} }])
    await assert.rejects(caso({ ...contexto, ...cambio }), DatoDeTicketsInvalido)
  assert.equal(llamadas, 0)
  await assert.rejects(caso(contexto), ErrorPersistenciaTickets)
})

test('backend.registrarLecturaJaba confirma RegistrarCosecha con REGISTRAR_JABA sin DTO ni trabajador cliente', async () => {
  const llamadas = []
  const adapter = crearSupabaseBackend({
    rpc: async (nombre, args) => {
      llamadas.push([nombre, args])
      return { data: respuestaRegistroHarvest(args) }
    }
  })
  const resultado = await adapter.registrarLecturaJaba({
    campaniaId: 'C',
    dniOperador: '12345678',
    sesionId: 'S',
    codigoTicket: 'T',
    lecturaId: 'R',
    fechaHora: contexto.fechaHora,
    operacionId: 'OP',
    trabajadorId: 'FALSO'
  })
  assert.equal(resultado.registro.trabajadorId, 'W')
  assert.deepEqual(llamadas, [
    [
      'harvest_registrar_cosecha',
      {
        p_campania_id: 'C',
        p_codigo_ticket: 'T',
        p_dni_operador: '12345678',
        p_sesion_id: 'S',
        p_lectura_id: 'R',
        p_fecha_hora: contexto.fechaHora,
        p_operacion_id: 'OP'
      }
    ]
  ])
})

test('mapper reconstruye consumo y contexto; rechaza metadatos incompletos o confirmaciones ajenas', async () => {
  const args = {
    p_campania_id: 'C',
    p_codigo_ticket: 'T',
    p_sesion_id: 'S',
    p_lectura_id: 'R',
    p_fecha_hora: contexto.fechaHora,
    p_operacion_id: 'OP'
  }
  const data = respuestaRegistroHarvest(args)
  const ticket = reconstituirCatalogoTicket(data, {
    campaniaId: 'C',
    codigoTicket: 'T'
  }).obtenerTicket('T')
  assert.equal(ticket.registroCosecha.sesionId, 'S')
  assert.equal(ticket.registroCosecha.operacionId, 'OP')
  assert.throws(() => ticket.registrarCosecha({ id: 'OTRO' }), TicketYaUtilizado)
  assert.throws(
    () =>
      reconstituirCatalogoTicket(
        { ...data, registro: { ...data.registro, sesion_id: null } },
        { campaniaId: 'C', codigoTicket: 'T' }
      ),
    ErrorPersistenciaTickets
  )
  for (const registro of [
    null,
    { ...data.registro, operacion_id: 'AJENA' },
    { ...data.registro, sesion_id: 'AJENA' }
  ]) {
    const repositorio = crearRepositorioTicketsHarvestSupabase({
      rpc: async () => ({ data: { ...data, registro } })
    })
    await assert.rejects(
      repositorio.registrarCosecha({
        campaniaId: 'C',
        codigoTicket: 'T',
        sesionId: 'S',
        operacionId: 'OP'
      }),
      ErrorPersistenciaTickets
    )
  }
})

test('rechazos de cosecha traducidos y fallos temporales conservan clasificación sin fallback legacy', async () => {
  for (const [error, Tipo, temporal] of [
    [{ message: 'harvest_ticket_ya_utilizado' }, TicketYaUtilizado, false],
    [{ message: 'harvest_ticket_no_encontrado' }, TicketNoEncontrado, false],
    [{ message: 'harvest_lote_sin_asignar', details: 'L' }, LoteSinAsignar, false],
    [{ message: 'harvest_campania_incorrecta' }, CampaniaTicketIncorrecta, false],
    [{ message: 'harvest_sesion_invalida' }, SesionCosechaInvalida, false],
    [{ message: 'Failed to fetch' }, ErrorBackend, true],
    [{ message: 'Disconnected', status: 0 }, ErrorBackend, true],
    [{ message: 'No autorizado', status: 403 }, ErrorBackend, false],
    [{ message: 'Missing', code: 'PGRST202' }, OperacionNoDisponible, false]
  ]) {
    const llamadas = []
    const adapter = crearSupabaseBackend({
      rpc: async (nombre) => {
        llamadas.push(nombre)
        return { error }
      }
    })
    await assert.rejects(
      adapter.registrarLecturaJaba({
        dniOperador: '12345678',
        campaniaId: 'C',
        codigoTicket: 'T',
        sesionId: 'S',
        lecturaId: 'R',
        fechaHora: contexto.fechaHora,
        operacionId: 'OP'
      }),
      (rechazo) => rechazo instanceof Tipo && esErrorTemporal(rechazo) === temporal
    )
    assert.deepEqual(llamadas, ['harvest_registrar_cosecha'])
  }
})
