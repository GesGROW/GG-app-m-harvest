import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EmpresaCliente,
  Tenant,
  crearCrearEmpresaCliente,
  crearResolverTenantContext,
  exigirMismoTenant
} from '@gesgrow/core/contexts/platform/index.js'
import { Campania } from '@gesgrow/core/contexts/campaign-management/index.js'
import { Trabajador } from '@gesgrow/core/contexts/workforce/index.js'

test('crea EmpresaCliente/Tenant con identidad, código y fecha; valida estado', async () => {
  const guardadas = []
  const crear = crearCrearEmpresaCliente({
    empresasCliente: { guardar: async (e) => guardadas.push(e) },
    generarId: () => 'T',
    ahora: () => '2026-10-14T12:00:00Z'
  })
  const e = await crear({ nombre: ' Empresa ', codigo: ' empresa ' })
  assert.ok(e instanceof Tenant)
  assert.ok(e instanceof EmpresaCliente)
  assert.equal(e.codigo, 'EMPRESA')
  assert.equal(e.estado, 'ACTIVA')
  assert.equal(guardadas[0], e)
  assert.throws(() => new Tenant({ ...e, estado: 'DESCONOCIDO' }), /Estado/)
})

test('Campaña y Trabajador requieren owner; DNI es único conceptualmente por Tenant', () => {
  const campania = new Campania({ id: 'C', tenantId: 'T', nombre: 'Actual' })
  const a = new Trabajador({ id: 'A', tenantId: 'T', dni: '12345678' })
  const b = new Trabajador({ id: 'B', tenantId: 'OTRA', dni: '12345678' })
  assert.equal(exigirMismoTenant(campania, a), 'T')
  assert.throws(() => exigirMismoTenant(campania, b), /cross-tenant/)
  assert.throws(() => new Campania({ id: 'C', nombre: 'Actual' }), /Tenant/)
  assert.throws(() => new Trabajador({ id: 'A', dni: '12345678' }), /Tenant/)
})

test('TenantContext viene del puerto y contrasta persistencia; rechaza owner de UI', async () => {
  const resolver = crearResolverTenantContext({
    campanias: { obtenerCache: async () => ({ id: 'C', tenant_id: 'T' }) },
    tenantContext: { obtener: async () => ({ tenantId: 'T' }) }
  })
  assert.deepEqual(await resolver('C'), { tenantId: 'T', campaniaId: 'C' })
  await assert.rejects(resolver('C', { tenantId: 'OTRA' }), /cross-tenant/)
  const sinAcceso = crearResolverTenantContext({
    campanias: { obtenerCache: async () => ({ id: 'C', tenant_id: 'OTRA' }) },
    tenantContext: { obtener: async () => ({ tenantId: 'T' }) }
  })
  await assert.rejects(sinAcceso('C'), /TenantContext/)
})
