import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'
import { guardarCache, seleccionarCampaniaLocal } from '../src/offline/db.js'
import { snapshotHarvest } from './helpers/snapshotHarvest.js'
import { TENANT_INICIAL_ID } from '@gesgrow/core/contexts/platform/index.js'

test('la carga por lotes conserva los hechos y revierte toda la caché ante una contradicción después del primer lote', async () => {
  const campaniaId = 'C-INGRESO'
  const codigos = Array.from({ length: 300 }, (_, i) => `T-${i}`)
  const harvest = {
    ...snapshotHarvest({ campaniaId, codigos }),
    tenantId: TENANT_INICIAL_ID
  }
  const cache = {
    campania: { id: campaniaId, tenant_id: TENANT_INICIAL_ID },
    trabajadores: [{ dni: '12345678', nombre: 'Nombre confirmado' }],
    tickets: codigos.map((codigo_ticket) => ({ codigo_ticket })),
    lotes: [],
    harvest
  }
  await seleccionarCampaniaLocal(campaniaId)
  await guardarCache(cache)
  // Reabrir y actualizar también debe conservar las identidades confirmadas.
  await guardarCache(cache)
  const db = await openDB('scc', 5)
  const leer = async () => {
    const tx = db.transaction([...db.objectStoreNames], 'readonly')
    const filas = await Promise.all(
      [...db.objectStoreNames].map(async (nombre) => [
        nombre,
        await tx.objectStore(nombre).getAll()
      ])
    )
    await tx.done
    return Object.fromEntries(filas)
  }
  const antes = await leer()
  assert.equal(antes.harvestTickets.length, 300)
  const contradictorio = structuredClone(cache)
  contradictorio.trabajadores[0].nombre = 'No debe confirmarse'
  contradictorio.harvest.snapshotId = crypto.randomUUID()
  contradictorio.harvest.lotesDeTickets.push({
    id: 'LT-OTRO',
    campaniaId,
    estado: 'DISPONIBLE',
    asignacionOperacionId: null
  })
  contradictorio.harvest.tickets[299].loteId = 'LT-OTRO'
  await assert.rejects(guardarCache(contradictorio), /inmutable/)
  assert.deepEqual(await leer(), antes)
  db.close()
})
