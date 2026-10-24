import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'
import * as local from '../src/offline/db.js'
import { snapshotHarvest } from './helpers/snapshotHarvest.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/index.js'
import { migrarOwnershipLocal } from '../src/offline/tenants.js'
import { TENANT_INICIAL_ID } from '@gesgrow/core/contexts/platform/index.js'
import { crearCasosDeUso } from '../src/application/crearCasosDeUso.js'
import { crearAdaptadoresOffline } from '../src/infrastructure/offline/crearAdaptadoresOffline.js'

const T = 'EMPRESA-B',
  OP = '12345678',
  DNI = '87654321'
const campania = {
  id: 'TENANT-B-C',
  tenant_id: T,
  estado: 'ACTIVA',
  nombre: 'Empresa B'
}

test('IndexedDB v5 mantiene DNI independientes por campaña de cada Tenant y payloads actuales', async () => {
  await local.seleccionarCampaniaLocal('SCC-C')
  await local.guardarCache({
    campania: { id: 'SCC-C', estado: 'ACTIVA' },
    trabajadores: [{ dni: DNI, nombre: 'SCC', roles: ['COSECHADOR'], activo: true }],
    lotes: [],
    tickets: []
  })
  await local.seleccionarCampaniaLocal(campania.id)
  await local.guardarOperador({
    dni: OP,
    autorizado_para_fecha: fechaOperativa(),
    campanias: [campania]
  })
  const harvest = { ...snapshotHarvest({ campaniaId: campania.id }), tenantId: T }
  await local.guardarCache({
    campania,
    trabajadores: [
      {
        dni: DNI,
        id: 'WB',
        tenant_id: T,
        nombre: 'Empresa B',
        roles: ['COSECHADOR'],
        activo: true
      }
    ],
    lotes: [],
    tickets: [],
    harvest
  })
  assert.equal((await local.obtenerTrabajador(DNI)).tenant_id, T)
  const op = await local.reservarAsignacionHarvest({
    codigoTicket: 'T1',
    cosechadorDni: DNI,
    dniOperador: OP,
    campaniaId: campania.id,
    tenantId: 'MANIPULADO'
  })
  assert.equal(op.tenant_id, T)
  assert.equal(op.payload.tenantId, undefined)
  assert.equal(op.payload.campaniaId, campania.id)
  await local.seleccionarCampaniaLocal('SCC-C')
  assert.equal((await local.obtenerTrabajador(DNI)).nombre, 'SCC')
  assert.equal((await local.obtenerTrabajador(DNI)).tenant_id, TENANT_INICIAL_ID)
  const db = await openDB('scc', 5)
  assert.equal(db.version, 5)
  const antes = await db.getAll('cola')
  await migrarOwnershipLocal(db)
  assert.deepEqual(await db.getAll('cola'), antes)
  db.close()
})

test('rechaza cache/snapshot/worker/sesión cross-tenant y no crea comandos', async () => {
  await local.seleccionarCampaniaLocal(campania.id)
  const antes = (await local.obtenerColaCompleta()).length
  await assert.rejects(
    local.guardarCache({
      campania,
      trabajadores: [{ dni: DNI, tenant_id: TENANT_INICIAL_ID }],
      lotes: [],
      tickets: []
    }),
    /cross-tenant/
  )
  await assert.rejects(
    local.guardarSnapshotHarvest({
      ...snapshotHarvest({ campaniaId: campania.id }),
      tenantId: TENANT_INICIAL_ID
    }),
    /cross-tenant/
  )
  await assert.rejects(
    local.guardarSesionLocal({
      id: 'CRUZADA',
      campania_id: campania.id,
      tenant_id: TENANT_INICIAL_ID
    }),
    /cross-tenant/
  )
  await assert.rejects(
    local.iniciarSesionOffline(
      {
        id: 'NUEVA-CRUZADA',
        campania_id: campania.id,
        tenant_id: TENANT_INICIAL_ID,
        dni_jabero: DNI
      },
      OP
    ),
    /cross-tenant/
  )
  const corrupto = { ...snapshotHarvest({ campaniaId: campania.id }), tenantId: T }
  corrupto.lotesDeTickets[0].tenantId = TENANT_INICIAL_ID
  await assert.rejects(local.guardarSnapshotHarvest(corrupto), /snapshotHarvest/)
  assert.equal((await local.obtenerColaCompleta()).length, antes)
})

test('migración local aborta sin cambios parciales ante ownership contradictorio', async () => {
  const db = await openDB('platform-migration-atomic', 5, {
    upgrade(d) {
      d.createObjectStore('meta')
      d.createObjectStore('trabajadores', { keyPath: 'id' })
    }
  })
  await db.put('trabajadores', { id: 'A', dni: DNI })
  await db.put('trabajadores', { id: 'B', dni: OP, tenantId: 'B', tenant_id: 'C' })
  await assert.rejects(migrarOwnershipLocal(db), /contradictorio/)
  assert.deepEqual(await db.get('trabajadores', 'A'), { id: 'A', dni: DNI })
  assert.equal(await db.get('meta', 'platform:ownership:v1'), undefined)
  db.close()
})

test('composición contrasta TenantContext persistido sin aceptar owner arbitrario de UI', async () => {
  const crear = (tenantId) =>
    crearCasosDeUso({
      offline: crearAdaptadoresOffline(),
      tenantContext: { obtener: async () => ({ tenantId }) },
      backend: {},
      estaEnLinea: () => false
    })
  const args = {
    operador: { dni: OP, campania },
    cosechador: { dni: DNI, nombre: 'Otra', tenant_id: TENANT_INICIAL_ID },
    codigoTicket: 'T2'
  }
  await assert.rejects(crear(T).asignarTicket(args), /cross-tenant/)
  await assert.rejects(
    crear(TENANT_INICIAL_ID).asignarTicket({ ...args, cosechador: { dni: DNI } }),
    /TenantContext/
  )
})
