import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openDB } from 'idb'
import { comprobarTrabajoDispositivo } from '../src/offline/db.js'

test('la cola y las sesiones reales bloquean cambio de actor o empresa y nunca se borran al comprobar la vinculación', async () => {
  await comprobarTrabajoDispositivo('A', '12345678')
  const db = await openDB('scc', 5)
  const op = {
    id: 'op-pda',
    tenant_id: 'A',
    estado: 'ERROR',
    payload: { dniOperador: '12345678', campaniaId: 'C' }
  }
  await db.put('cola', op)
  await comprobarTrabajoDispositivo('A', '12345678')
  await assert.rejects(
    comprobarTrabajoDispositivo('B', '12345678'),
    /otra cuenta o empresa/
  )
  await assert.rejects(
    comprobarTrabajoDispositivo('A', '87654321'),
    /otra cuenta o empresa/
  )
  await assert.rejects(
    comprobarTrabajoDispositivo(null, null, { salir: true }),
    /pendientes/
  )
  await db.put('cola', { ...op, estado: 'SINCRONIZADA' })
  await db.put('sesiones', {
    id: 'sesion-pda',
    tenant_id: 'A',
    dni_operador: '12345678',
    estado: 'ACTIVA'
  })
  await assert.rejects(
    comprobarTrabajoDispositivo(null, null, { salir: true }),
    /finaliza/
  )
  await db.put('sesiones', {
    id: 'sesion-pda',
    tenant_id: 'A',
    dni_operador: '12345678',
    estado: 'CERRADA'
  })
  await comprobarTrabajoDispositivo(null, null, { salir: true })
  assert.equal(await db.count('cola'), 1)
  assert.equal(await db.count('sesiones'), 1)
  db.close()
})
