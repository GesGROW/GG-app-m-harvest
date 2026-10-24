import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Fundo,
  Sector,
  ParcelaAgricola,
  exigirJerarquiaDelTenant,
  crearGestionEstructuraAgricola
} from '@gesgrow/core/contexts/farm-structure/index.js'
import {
  LoteOperativoCampania,
  crearVinculacionParcelas
} from '@gesgrow/core/contexts/campaign-management/index.js'
const dato = { tenantId: 'A', codigo: ' f1 ', nombre: ' Fundo ', activo: true }
test('Fundo, Sector y Parcela son entidades físicas del mismo Tenant, ajenas al ciclo productivo', () => {
  const f = new Fundo({ ...dato, id: 'F' }),
    s = new Sector({ ...dato, id: 'S', fundoId: f.id }),
    p = new ParcelaAgricola({ ...dato, id: 'P', sectorId: s.id })
  assert.equal(f.codigo, 'F1')
  assert.equal(f.nombre, 'Fundo')
  assert.equal(exigirJerarquiaDelTenant(s, f), s)
  assert.equal(exigirJerarquiaDelTenant(p, s), p)
  assert.throws(
    () => exigirJerarquiaDelTenant(p, { ...s, tenantId: 'B' }),
    /cross-tenant/
  )
  assert.throws(() => exigirJerarquiaDelTenant(s, { ...f, id: 'otro' }), /incorrecto/)
  assert.throws(() => new Sector({ ...dato, id: 'S' }), /Fundo/)
  assert.throws(() => new ParcelaAgricola({ ...dato, id: 'P' }), /Sector/)
  assert.ok(Object.isFrozen(p))
})
test('LoteOperativoCampania legacy acepta cero parcelas y no impone relación 1:1', () => {
  const d = { id: 'L', tenantId: 'A', campaniaId: 'C', codigo: 'L1' }
  assert.deepEqual(new LoteOperativoCampania(d).parcelaIds, [])
  assert.deepEqual(
    new LoteOperativoCampania({ ...d, parcelaIds: ['P', 'Q', 'P'] }).parcelaIds,
    ['P', 'Q']
  )
  assert.deepEqual(
    new LoteOperativoCampania({ ...d, id: 'otro', parcelaIds: ['P'] }).parcelaIds,
    ['P']
  )
})
test('casos de uso físicos limitan campos y separan activación de borrado', async () => {
  const calls = [],
    p = Object.fromEntries(
      ['listar', 'guardar', 'estado'].map((k) => [
        k,
        async (...args) => calls.push([k, ...args])
      ])
    )
  const s = crearGestionEstructuraAgricola({ estructuraAgricola: p })
  await s.guardar('A', 'fundos', {
    ...dato,
    tenantId: 'B',
    padreId: 'ajeno',
    propietario: 'B'
  })
  assert.deepEqual(calls[0], [
    'guardar',
    'A',
    'fundos',
    { codigo: 'F1', nombre: 'Fundo', activo: true, id: null, padreId: null }
  ])
  await s.desactivar('A', 'fundos', 'F')
  await s.activar('A', 'fundos', 'F')
  assert.equal(calls[1].at(-1), false)
  assert.equal(calls[2].at(-1), true)
  assert.equal(s.eliminar, undefined)
  assert.throws(() => s.listar('A', 'harvest'), /desconocido/)
})
test('Campaign consume referencias públicas Farm y un puerto de vínculos independiente', async () => {
  const calls = [],
    s = crearVinculacionParcelas({
      referenciasParcelas: { listar: async (t, q) => [t, q] },
      lotesParcelas: Object.fromEntries(
        ['listar', 'vincular', 'desvincular'].map((k) => [
          k,
          async (...a) => calls.push([k, ...a])
        ])
      )
    })
  assert.deepEqual(await s.opciones('A', 'norte'), ['A', 'norte'])
  await s.vincular('A', 'C', 'L', 'P')
  await s.desvincular('A', 'C', 'L', 'P')
  assert.deepEqual(calls, [
    ['vincular', 'A', 'C', 'L', 'P'],
    ['desvincular', 'A', 'C', 'L', 'P']
  ])
})
