import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { crearClientePda } from '../src/infrastructure/supabase/clientePda.js'

test('el SDK envía credencial y actor por petición sin cambiar los datos ni la autenticación de cuenta', async () => {
  const solicitudes = []
  const cliente = createClient('https://pda.test', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (_url, init) => {
        solicitudes.push({
          headers: new Headers(init.headers),
          datos: JSON.parse(init.body)
        })
        return new Response('null', { headers: { 'Content-Type': 'application/json' } })
      }
    }
  })
  let actual = { id: crypto.randomUUID(), credencial: 'a'.repeat(64), dni: '12345678' }
  const campo = crearClientePda(cliente, () => ({ ...actual }))
  const parametros = {
    p_operacion_id: crypto.randomUUID(),
    p_campania_id: crypto.randomUUID()
  }
  const primera = campo.rpc('harvest_asignar_lote_tickets', parametros)
  actual = { ...actual, dni: '87654321' }
  const segunda = campo.rpc('harvest_obtener_snapshot', parametros)
  await Promise.all([primera, segunda])
  assert.equal(solicitudes[0].headers.get('x-gesgrow-operator-dni'), '12345678')
  assert.equal(solicitudes[1].headers.get('x-gesgrow-operator-dni'), '87654321')
  assert.equal(solicitudes[0].headers.get('x-gesgrow-device-key'), actual.credencial)
  assert.deepEqual(solicitudes[0].datos, parametros)
  assert.deepEqual(solicitudes[1].datos, parametros)
  await cliente.rpc('pda_preparar_ingreso_dni', {})
  assert.equal(solicitudes[2].headers.has('x-gesgrow-device-key'), false)
})
