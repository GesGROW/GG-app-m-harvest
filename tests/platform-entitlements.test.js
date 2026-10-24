import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import {
  Plan,
  Modulo,
  Suscripcion,
  ModuloContratado,
  MODULOS,
  MODULOS_FUTUROS,
  crearEntitlements
} from '@gesgrow/core/contexts/platform/index.js'
import { crearAccesoEmpresa } from '../src/application/accesoEmpresa.js'
import { crearEntitlementsSupabase } from '../src/infrastructure/supabase/platformEntitlementsAdapter.js'

const desde = '2026-10-01T00:00:00Z',
  hasta = '2026-11-01T00:00:00Z'
const ahora = '2026-10-14T00:00:00Z'
const suscripcion = (estado = 'ACTIVA', datos = {}) =>
  new Suscripcion({
    id: 'S',
    tenantId: 'A',
    planId: 'P',
    estado,
    desde,
    hasta,
    ...datos
  })
const entitlement = (datos = {}) =>
  new ModuloContratado({
    tenantId: 'A',
    suscripcionId: 'S',
    modulo: 'HARVEST',
    desde,
    ...datos
  })

test('Platform modela sólo módulos reales y reserva futuras capacidades sin implementarlas', () => {
  assert.deepEqual(MODULOS, ['HARVEST', 'CAMPAIGN', 'WORKFORCE', 'FARM_STRUCTURE'])
  assert.deepEqual(MODULOS_FUTUROS, ['INVENTORY', 'MACHINERY', 'IRRIGATION', 'QUALITY'])
  assert.throws(() => new Modulo('INVENTORY'), /no disponible/)
  assert.throws(() => new Modulo('company.manage'), /no disponible/)
  const p = new Plan({
    id: 'P',
    codigo: 'CAMPO',
    nombre: 'Campo',
    modulos: ['HARVEST', 'HARVEST']
  })
  assert.deepEqual(p.modulos, ['HARVEST'])
  assert.ok(Object.isFrozen(p.modulos))
})

test('suscripción activa/trial habilita; suspendida, vencida/cancelada y fechas fuera de vigencia deniegan', () => {
  for (const estado of ['ACTIVA', 'TRIAL', 'SUSPENDIDA', 'VENCIDA', 'CANCELADA'])
    assert.equal(
      entitlement().permite(suscripcion(estado), ahora),
      ['ACTIVA', 'TRIAL'].includes(estado)
    )
  assert.equal(entitlement().permite(suscripcion(), desde), true)
  assert.equal(entitlement().permite(suscripcion(), hasta), false)
  assert.equal(
    entitlement().permite(suscripcion('ACTIVA', { desde: hasta, hasta: null }), ahora),
    false
  )
  assert.throws(() => suscripcion('TRIAL', { hasta: null }), /vencimiento/)
  assert.throws(() => suscripcion('PAGADA'), /Estado/)
  assert.throws(() => entitlement({ hasta: desde }), /Intervalo/)
})

test('add-on independiente del Plan conserva vigencia propia y rechaza suscripciones cross-tenant', () => {
  const plan = new Plan({
    id: 'P',
    codigo: 'PERSONAL',
    nombre: 'Personal',
    modulos: []
  })
  assert.deepEqual(plan.modulos, [])
  const e = entitlement({ origen: 'ADD_ON' })
  assert.equal(e.permite(suscripcion(), ahora), true)
  assert.equal(entitlement({ habilitado: false }).permite(suscripcion(), ahora), false)
  assert.equal(entitlement({ hasta: ahora }).permite(suscripcion(), ahora), false)
  assert.throws(
    () => e.permite(suscripcion('ACTIVA', { tenantId: 'B' }), ahora),
    /cross-tenant/
  )
  assert.throws(
    () => e.permite(suscripcion('ACTIVA', { id: 'OTRA' }), ahora),
    /suscripción/
  )
})

function escenario(permisos, modulos) {
  const llamadas = [],
    comprobaciones = []
  const servicio = crearAccesoEmpresa({
    identity: {
      iniciarSesion: async () => {},
      cerrarSesion: async () => {},
      obtenerSesion: async () => ({ sujeto: 'SUJETO' })
    },
    acceso: {
      obtenerIdentidad: async () => ({
        usuario: { id: 'U' },
        membresias: [{ id: 'M', usuarioId: 'U', tenantId: 'A' }]
      }),
      resolverContexto: async (tenantId) => {
        assert.equal(tenantId, 'A')
        return { usuarioId: 'U', membresiaId: 'M', tenantId: 'A', permisos }
      },
      listarCampanias: async () => [{ id: 'C', tenant_id: 'A' }],
      asignarLote: async (d) => {
        llamadas.push(d)
        return 'OK'
      },
      guardarTrabajador: async (id) => {
        llamadas.push(id)
        return id
      }
    },
    entitlements: {
      puedeUsarModulo: async (tenant, modulo) => {
        comprobaciones.push([tenant, modulo])
        return modulos.includes(modulo)
      }
    }
  })
  return { servicio, llamadas, comprobaciones }
}

test('permiso sin módulo y módulo sin permiso no ejecutan; UI no concede Tenant ni módulos', async () => {
  const sinModulo = escenario(['harvest.operate'], [])
  await sinModulo.servicio.seleccionarEmpresa('A')
  await assert.rejects(
    sinModulo.servicio.asignarLote({ campaniaId: 'C', modulos: ['HARVEST'] }),
    /no está habilitado/
  )
  assert.deepEqual(sinModulo.llamadas, [])
  const sinPermiso = escenario([], ['HARVEST'])
  await sinPermiso.servicio.seleccionarEmpresa('A')
  await assert.rejects(
    sinPermiso.servicio.asignarLote({ campaniaId: 'C' }),
    /No tiene permiso/
  )
  assert.deepEqual(sinPermiso.comprobaciones, [])
  const ambos = escenario(
    ['harvest.operate', 'workforce.manage'],
    ['HARVEST', 'WORKFORCE']
  )
  await ambos.servicio.seleccionarEmpresa('A')
  assert.equal(
    await ambos.servicio.asignarLote({ campaniaId: 'C', tenantId: 'B' }),
    'OK'
  )
  assert.equal(await ambos.servicio.guardarTrabajador({ tenantId: 'B' }), 'A')
  assert.deepEqual(ambos.comprobaciones, [
    ['A', 'HARVEST'],
    ['A', 'WORKFORCE']
  ])
  await assert.rejects(
    ambos.servicio.asignarLote({ campaniaId: 'OTRA' }),
    /empresa seleccionada/
  )
})

test('puerto Platform falla cerrado y no acepta respuesta truthy ni estado comercial de UI', async () => {
  assert.throws(() => crearEntitlements({}), /puerto/)
  const p = crearEntitlements({
    entitlements: { puedeUsarModulo: async () => ({ habilitado: true }) }
  })
  assert.equal(await p.puedeUsarModulo('A', 'HARVEST'), false)
  await assert.rejects(p.exigirModulo('A', 'HARVEST'), /no está habilitado/)
  await assert.rejects(p.puedeUsarModulo('A', 'QUALITY'), /no disponible/)
})

test('adapter consulta entitlement servidor con selección solicitada y propaga revocación/error', async () => {
  const llamadas = []
  let data = true,
    error = null
  const port = crearEntitlementsSupabase({
    rpc: async (n, args) => {
      llamadas.push([n, args])
      return { data, error }
    }
  })
  assert.equal(await port.puedeUsarModulo('A', 'HARVEST'), true)
  data = false
  assert.equal(await port.puedeUsarModulo('A', 'HARVEST'), false)
  error = { message: 'Membresía revocada' }
  await assert.rejects(port.puedeUsarModulo('B', 'HARVEST'), /revocada/)
  assert.deepEqual(llamadas[0], [
    'platform_puede_usar_modulo',
    { p_tenant_id: 'A', p_modulo: 'HARVEST' }
  ])
})

test('BC operativos e Identity no conocen nombres de Plan ni Suscripción comercial', () => {
  for (const bc of ['harvest', 'campaign-management', 'workforce', 'identity-access']) {
    const dir = new URL('./', import.meta.resolve('@gesgrow/core/contexts/' + bc + '/index.js'))
    for (const file of readdirSync(dir, { recursive: true }).filter((f) =>
      f.endsWith('.js')
    ))
      assert.doesNotMatch(
        readFileSync(new URL(file.replaceAll('\\', '/'), dir), 'utf8'),
        /PILOTO_SCC|OPERACION_CAMPO|\bPlan\b|\bSuscripcion\b|platform_planes/
      )
  }
})
