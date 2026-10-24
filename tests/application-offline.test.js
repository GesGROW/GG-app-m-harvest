import { snapshotHarvest } from './helpers/snapshotHarvest.js'
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { openDB } from 'idb'
import { casosDeUso, configurarCasosDeUso } from '../src/application/casosDeUso.js'
import { crearCasosDeUso } from '../src/application/crearCasosDeUso.js'
import { crearAdaptadoresOffline } from '../src/infrastructure/offline/crearAdaptadoresOffline.js'
import { backend } from '@gesgrow/core/backend/backend.js'
import { configurarBackend } from '@gesgrow/core/backend/backend.js'
import { crearSupabaseBackend } from '../src/infrastructure/supabase/backendAdapter.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/domain/fechaOperativa.js'
import * as local from '../src/offline/db.js'
import {
  respuestaAsignacionHarvest,
  respuestaRegistroHarvest
} from './helpers/asignacionHarvest.js'

const navigatorOriginal = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true
})
after(() => {
  if (navigatorOriginal)
    Object.defineProperty(globalThis, 'navigator', navigatorOriginal)
  else delete globalThis.navigator
})

test('casos de uso reales conservan escritura local, comandos, UUID, orden y reconexión sin duplicados', async () => {
  const llamadas = []
  const campania = { id: 'C', nombre: 'Actual', estado: 'ACTIVA' }
  configurarBackend(
    crearSupabaseBackend({
      async rpc(nombre, parametros) {
        llamadas.push([nombre, parametros])
        if (['harvest_asignar_v4', 'harvest_registrar_v4'].includes(nombre))
          return { data: { modelo: 'LEGACY', resultado: { ok: true } } }
        if (nombre === 'harvest_obtener_snapshot')
          return {
            data: snapshotHarvest({
              campaniaId: parametros.p_campania_id,
              operadorDni: parametros.p_dni_operador,
              codigos: []
            })
          }
        if (nombre === 'validar_operador_campanias')
          return {
            data: {
              dni: '12345678',
              nombre: 'Operador',
              autorizado_para_fecha: fechaOperativa(),
              campanias: [campania]
            }
          }
        if (nombre === 'obtener_cache_operativa_campania')
          return {
            data: {
              campania,
              trabajadores: [],
              tickets: [],
              lotes: [
                {
                  lote_id: 'L',
                  codigo: 'L1',
                  variedades: [{ id: 'V', nombre: 'Ventura' }]
                }
              ]
            }
          }
        return { data: { ok: true } }
      }
    })
  )
  configurarCasosDeUso(
    crearCasosDeUso({
      backend,
      offline: crearAdaptadoresOffline({ legacy: true }),
      estaEnLinea: () => navigator.onLine,
      generarId: () => crypto.randomUUID(),
      ahora: () => new Date().toISOString(),
      registrarError: (...args) => console.error(...args)
    })
  )
  const validado = await casosDeUso.validarOperador('12345678')
  const ingreso = await casosDeUso.ingresarCampania({ operador: validado, campania })
  const operador = ingreso.operador
  const candidato = await casosDeUso.buscarCosechadorLocal('87654321', {
    permitirProvisional: true
  })
  assert.equal(candidato.dni, '87654321')
  assert.equal(candidato.campania, 'Actual')
  assert.equal(candidato.provisional_local, true)
  await ingreso.sincronizar()
  assert.deepEqual(
    llamadas.map(([nombre]) => nombre),
    [
      'validar_operador_campanias',
      'obtener_cache_operativa_campania',
      'harvest_obtener_snapshot'
    ]
  )
  const db = await openDB('scc', 5)
  assert.equal(db.version, 5)
  db.close()
  navigator.onLine = false
  const asignacion = await casosDeUso.asignarTicket({
    operador,
    cosechador: { dni: '87654321', nombre: 'Ana' },
    codigoTicket: 'T001'
  })
  await assert.rejects(
    casosDeUso.asignarTicket({
      operador,
      cosechador: { dni: '87654321', nombre: 'Ana' },
      codigoTicket: 'T001'
    }),
    /ya fue asignado/
  )
  const jabero = await casosDeUso.registrarJabero({ operador, dni: '87654322' })
  const inicio = await casosDeUso.iniciarSesionLectura({
    operador,
    dni: '87654322',
    loteId: 'L',
    variedadId: 'V'
  })
  const sesionLectura = inicio.sesion
  const primera = await casosDeUso.registrarLecturaJaba({
    operador,
    sesionLectura,
    codigo: 'T001'
  })
  // Caracteriza la proyección local y el transporte simulado. La exclusividad
  // real y el rechazo de esta segunda intención se prueban en SQL/F5.4.
  const segunda = await casosDeUso.registrarLecturaJaba({
    operador,
    sesionLectura,
    codigo: 'T001'
  })
  assert.deepEqual([primera.total, segunda.total, segunda.totalPersona], [1, 2, 2])
  const cierre = await casosDeUso.cerrarSesionLectura({ operador, sesionLectura })
  const resultados = [asignacion, jabero, inicio, primera, segunda, cierre]
  for (const resultado of resultados) assert.equal(await resultado.sincronizar(), false)
  // La API devuelve registros por su clave; sync conserva el orden creado_en.
  const cola = (await local.obtenerColaCompleta()).sort((a, b) =>
    a.creado_en.localeCompare(b.creado_en)
  )
  assert.deepEqual(
    cola.map((op) => op.tipo),
    [
      'ASIGNAR_TICKET',
      'REGISTRAR_JABERO',
      'INICIAR_SESION',
      'REGISTRAR_JABA',
      'REGISTRAR_JABA',
      'CERRAR_SESION'
    ]
  )
  assert.ok(
    cola.every((op) => op.estado === 'PENDIENTE' && op.payload.campaniaId === 'C')
  )
  assert.deepEqual(
    cola.map((op) => op.id),
    resultados.map((resultado) => resultado.operacion.id)
  )
  assert.equal(new Set(cola.map((op) => op.id)).size, 6)
  assert.notEqual(
    primera.operacion.payload.lecturaId,
    segunda.operacion.payload.lecturaId
  )
  assert.equal(cola[2].payload.sesionId, sesionLectura.sesion_id)
  assert.equal(llamadas.length, 3)
  navigator.onLine = true
  await cierre.sincronizar()
  assert.deepEqual(
    llamadas.slice(3).map(([nombre]) => nombre),
    [
      'harvest_asignar_v4',
      'registrar_jabero_campania',
      'iniciar_sesion_lectura_campania',
      'harvest_registrar_v4',
      'harvest_registrar_v4',
      'cerrar_sesion_lectura_campania'
    ]
  )
  for (const [index, operacion] of cola.entries()) {
    const parametros = llamadas[index + 3][1]
    assert.equal(parametros.p_campania_id, 'C')
    assert.equal(parametros.p_dni_operador, operador.dni)
    if (operacion.tipo !== 'INICIAR_SESION')
      assert.equal(parametros.p_operacion_id, operacion.id)
    if (operacion.tipo === 'REGISTRAR_JABA') {
      assert.equal(parametros.p_lectura_id, operacion.payload.lecturaId)
      assert.equal(parametros.p_fecha_hora, operacion.payload.fechaHora)
    }
  }
  assert.ok(
    (await local.obtenerColaCompleta()).every((op) => op.estado === 'SINCRONIZADA')
  )
  assert.equal((await local.obtenerTicket('T001')).estado_sync, 'SINCRONIZADO')
  assert.equal(
    (await local.obtenerTrabajador('87654322')).estado_sync_jabero,
    'SINCRONIZADO'
  )
  assert.ok(
    (await local.obtenerLecturasSesion(sesionLectura.sesion_id)).every(
      (lectura) => lectura.estado_sync === 'SINCRONIZADO'
    )
  )
  await cierre.sincronizar()
  assert.equal(llamadas.length, 9)
})
