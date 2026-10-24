import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CambioComercial,
  EventoComercial,
  EVENTOS_COMERCIALES,
  crearAdministracionComercial
} from '@gesgrow/core/contexts/platform/index.js'
import { TenantContext } from '@gesgrow/core/contexts/identity-access/index.js'
import { crearComercialSupabase } from '../src/infrastructure/supabase/platformComercialAdapter.js'

const contexto = (permisos = ['company.manage']) =>
  new TenantContext({ usuarioId: 'U', membresiaId: 'M', tenantId: 'A', permisos })
test('Application expone el ciclo de vida con contexto autorizado, sin actor/Tenant/módulos arbitrarios de UI', async () => {
  const solicitudes = []
  let c = contexto(),
    delegado = true
  const app = crearAdministracionComercial({
    tenantContext: { obtener: async () => c },
    comercial: {
      solicitarCambio: async (d) => {
        solicitudes.push(d)
        return { operacionId: d.operacionId }
      },
      consultar: async (tenant) => tenant,
      puedeAdministrar: async () => delegado
    }
  })
  assert.deepEqual(Object.keys(EVENTOS_COMERCIALES), [
    'crearSuscripcion',
    'cambiarPlan',
    'renovarSuscripcion',
    'suspenderSuscripcion',
    'reactivarSuscripcion',
    'cancelarSuscripcion',
    'habilitarModulo',
    'deshabilitarModulo'
  ])
  assert.equal(await app.puedeAdministrar(), true)
  for (const metodo of Object.keys(EVENTOS_COMERCIALES)) {
    await app[metodo]({
      operacionId: metodo,
      motivo: 'Acuerdo comercial',
      planId: 'P',
      hasta: '2100-01-01T00:00:00Z',
      modulo: 'WORKFORCE',
      tenantId: 'B',
      actor: 'FALSO',
      modulos_plan: ['HARVEST', 'CAMPAIGN']
    })
    const d = solicitudes.at(-1)
    assert.equal(d.tenantId, 'A')
    assert.equal(d.tipoEvento, EVENTOS_COMERCIALES[metodo])
    assert.equal(d.actor, undefined)
    assert.equal(d.parametros.modulos_plan, undefined)
  }
  assert.equal(await app.consultar(), 'A')
  delegado = false
  assert.equal(await app.puedeAdministrar(), false)
  c = contexto(['harvest.view'])
  assert.equal(await app.puedeAdministrar(), false)
  await assert.rejects(
    app.suspenderSuscripcion({ operacionId: 'NO', motivo: 'NO' }),
    /No tiene permiso/
  )
  assert.equal(solicitudes.length, 8)
})

test('modelo comercial exige motivo e idempotencia y distingue intención futura del reloj autorizado', () => {
  const datos = {
    operacionId: 'O',
    tenantId: 'A',
    tipoEvento: 'CAMBIAR_PLAN',
    datos: { planId: 'P' },
    motivo: 'Cambio',
    effectiveAt: '2030-01-01T00:00:00-05:00'
  }
  const c = new CambioComercial(datos)
  assert.equal(c.effectiveAt, '2030-01-01T05:00:00.000Z')
  assert.ok(Object.isFrozen(c.parametros))
  assert.throws(() => new CambioComercial({ ...datos, operacionId: '' }), /idempotente/)
  assert.throws(() => new CambioComercial({ ...datos, motivo: ' ' }), /motivo/)
  assert.throws(
    () => new CambioComercial({ ...datos, tipoEvento: 'COBRAR_TARJETA' }),
    /desconocido/
  )
  assert.throws(
    () =>
      new CambioComercial({
        ...datos,
        tipoEvento: 'CREAR_SUSCRIPCION',
        datos: { planId: 'P', estado: 'TRIAL' }
      }),
    /vencimiento/
  )
  assert.throws(
    () =>
      new CambioComercial({
        ...datos,
        tipoEvento: 'HABILITAR_MODULO',
        datos: { modulo: 'INVENTORY' }
      }),
    /no disponible/
  )
  assert.throws(
    () =>
      new CambioComercial({ ...datos, tipoEvento: 'RENOVAR_SUSCRIPCION', datos: {} }),
    /fecha final/
  )
})

test('EventoComercial reconstituye snapshots inmutables, sin referencias mutables del llamador', () => {
  const anterior = { suscripcion: { estado: 'ACTIVA' }, modulos: [] }
  const evento = new EventoComercial({
    id: 'E',
    tenantId: 'A',
    tipoEvento: 'SUSPENDER_SUSCRIPCION',
    fase: 'APLICADA',
    actor: { tipo: 'USUARIO', usuarioId: 'U' },
    fechaHora: '2026-10-14T00:00:00Z',
    effectiveAt: '2026-10-14T00:00:00Z',
    estadoAnterior: anterior,
    estadoNuevo: { suscripcion: { estado: 'SUSPENDIDA' } },
    motivo: 'Revisión'
  })
  anterior.suscripcion.estado = 'ALTERADO'
  assert.equal(evento.estadoAnterior.suscripcion.estado, 'ACTIVA')
  assert.throws(() => {
    evento.estadoNuevo.suscripcion.estado = 'ACTIVA'
  }, TypeError)
})

test('adapter mantiene ID de operación, no transmite actor ni fechas autoritativas y propaga rechazo', async () => {
  const llamadas = []
  let error = null
  const adapter = crearComercialSupabase({
    rpc: async (nombre, params) => {
      llamadas.push([nombre, params])
      return { data: { ok: true }, error }
    }
  })
  const c = new CambioComercial({
    operacionId: 'O',
    tenantId: 'A',
    tipoEvento: 'SUSPENDER_SUSCRIPCION',
    motivo: 'Revisión'
  })
  await adapter.solicitarCambio(c)
  await adapter.solicitarCambio(c)
  assert.deepEqual(llamadas[0], llamadas[1])
  assert.deepEqual(llamadas[0], [
    'platform_solicitar_cambio',
    {
      p_operacion_id: 'O',
      p_tenant_id: 'A',
      p_tipo: 'SUSPENDER_SUSCRIPCION',
      p_parametros: {},
      p_motivo: 'Revisión',
      p_effective_at: null
    }
  ])
  await adapter.consultar('A')
  await adapter.puedeAdministrar('A')
  error = { message: 'Permiso comercial denegado' }
  await assert.rejects(adapter.solicitarCambio(c), /denegado/)
})
