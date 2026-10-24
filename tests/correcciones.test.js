import 'fake-indexeddb/auto'
import * as lookupDb from '../src/offline/db.js'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ejecutarCola,
  obtenerOperacionesDependientes,
  evaluarDescarteOperacion
} from '../src/offline/cola.js'
import { esErrorTemporal } from '../src/offline/errores.js'
import { validarOperadorConFuentes } from '@gesgrow/core/contexts/identity-access/application/authLogic.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/domain/fechaOperativa.js'
import { crearBuscarCosechadorLocal } from '@gesgrow/core/contexts/workforce/index.js'
import { archivoExcluido, contenidoSensible } from '../scripts/filtros-exportacion.js'
import {
  actualizarOperacion,
  agregarOperacion,
  agregarRolTrabajador,
  cerrarSesionLocal,
  contarLecturasCosechador,
  contarLecturasSesion,
  descartarOperacion,
  guardarAsignacionOffline,
  guardarCache,
  guardarLecturaLocal,
  guardarSesionLocal,
  iniciarSesionOffline,
  registrarLecturaOffline,
  registrarJaberoOffline,
  finalizarSesionOffline,
  limpiarOperacionesSincronizadas,
  marcarJabero,
  marcarOperacionError,
  marcarOperacionSincronizada,
  marcarOperacionTemporal,
  obtenerColaCompleta,
  obtenerSesionesActivas,
  obtenerSesionActivaJabero,
  obtenerTicket,
  obtenerTrabajador,
  reintentarOperacion
} from '../src/offline/db.js'

const buscarCosechadorLocal = crearBuscarCosechadorLocal({
  trabajadores: { obtener: lookupDb.obtenerTrabajador },
  campaignManagement: { obtenerActiva: lookupDb.obtenerCampaniaActiva }
})

test('fallos temporales se reintentan, rechazos quedan en ERROR y bloquean operaciones posteriores', async () => {
  const llamadas = []
  const uno = await agregarOperacion('PRUEBA', { orden: 1 })
  const dos = await agregarOperacion('PRUEBA', { orden: 2 })
  const procesar = async (operacion) => {
    llamadas.push(operacion.payload.orden)
    if (operacion.id === uno.id)
      throw Object.assign(new Error('Failed to fetch'), { status: 503 })
  }
  const fallar = async (operacion, error, temporal) => {
    assert.equal(temporal, true)
    await marcarOperacionTemporal(operacion.id, error.message)
  }
  await ejecutarCola([dos, uno], procesar, () => {}, fallar)
  assert.deepEqual(llamadas, [1])
  assert.equal(
    (await obtenerColaCompleta()).find((op) => op.id === uno.id).estado,
    'PENDIENTE'
  )

  await ejecutarCola(
    [dos, uno],
    async (op) => {
      llamadas.push(op.payload.orden)
      throw Object.assign(new Error('Ticket duplicado'), { status: 409 })
    },
    () => {},
    async (op, error, temporal) => {
      assert.equal(temporal, false)
      await marcarOperacionError(op.id, error.message)
    }
  )
  assert.deepEqual(llamadas, [1, 1])
  assert.equal(
    (await obtenerColaCompleta()).find((op) => op.id === uno.id).estado,
    'ERROR'
  )
  await ejecutarCola(
    await obtenerColaCompleta(),
    () => {
      throw new Error('No debe ejecutarse')
    },
    () => {},
    () => {}
  )
  assert.equal(await reintentarOperacion(uno.id), true)
  assert.equal(
    (await obtenerColaCompleta()).find((op) => op.id === uno.id).estado,
    'PENDIENTE'
  )
  await ejecutarCola(
    await obtenerColaCompleta(),
    async (op) => {
      llamadas.push(op.payload.orden)
    },
    (op) => marcarOperacionSincronizada(op.id),
    () => {}
  )
  assert.deepEqual(llamadas, [1, 1, 1, 2])
  assert.equal(esErrorTemporal({ status: 401, message: 'No autorizado' }), false)
  assert.equal(
    esErrorTemporal({ status: 400, message: 'Network worker inválido' }),
    false
  )
  assert.equal(esErrorTemporal({ status: 408, message: 'Timeout' }), true)
})

test('cosechador se valida en caché sin cliente remoto', async () => {
  await guardarCache({
    campania: { nombre: 'Campaña 2026' },
    sincronizado_en: '',
    trabajadores: [
      { dni: '80000001', nombre: 'Ana', roles: ['COSECHADOR'] },
      { dni: '80000002', nombre: 'Luis', roles: [] }
    ],
    lotes: [],
    tickets: []
  })
  assert.equal((await buscarCosechadorLocal('80000001')).campania, 'Campaña 2026')
  await assert.rejects(buscarCosechadorLocal('80000002'))
})

test('sesión activa se restaura y dos lecturas del mismo ticket son dos jabas', async () => {
  await guardarSesionLocal({
    id: 'sesion-restaurada',
    sesion_id: 'sesion-restaurada',
    estado: 'ACTIVA',
    dni_operador: '12345678',
    dni_jabero: '87654321',
    lote_codigo: 'L1',
    variedad: 'Variedad',
    jabero: 'Juan'
  })
  for (const id of ['lectura-1', 'lectura-2']) {
    await guardarLecturaLocal({
      id,
      sesion_id: 'sesion-restaurada',
      codigo_ticket: 'TICKET-1',
      cosechador_dni: '80000001',
      estado_sync: 'PENDIENTE'
    })
  }
  assert.equal((await obtenerSesionesActivas('12345678'))[0].lote_codigo, 'L1')
  assert.equal((await obtenerSesionActivaJabero('87654321')).id, 'sesion-restaurada')
  assert.equal(await contarLecturasSesion('sesion-restaurada'), 2)
  assert.equal(await contarLecturasCosechador('sesion-restaurada', '80000001'), 2)
  await cerrarSesionLocal('sesion-restaurada')
  assert.equal((await obtenerSesionesActivas('12345678')).length, 0)
})

test('jabero pendiente sobrevive la recarga de caché, error revoca rol y reintento lo recupera', async () => {
  await guardarCache({
    campania: '2026',
    sincronizado_en: '',
    trabajadores: [{ dni: '80000003', nombre: 'Eva', roles: [] }],
    lotes: [],
    tickets: []
  })
  const op = await agregarOperacion('REGISTRAR_JABERO', { dniTrabajador: '80000003' })
  await agregarRolTrabajador('80000003', 'JABERO', op.id)
  await guardarCache({
    campania: '2026',
    sincronizado_en: '',
    trabajadores: [{ dni: '80000003', nombre: 'Eva', roles: [] }],
    lotes: [],
    tickets: []
  })
  assert.equal((await obtenerTrabajador('80000003')).estado_sync_jabero, 'PENDIENTE')
  await marcarJabero('80000003', 'ERROR', op.id)
  await marcarOperacionError(op.id, 'Campaña cerrada')
  assert.equal((await obtenerTrabajador('80000003')).roles.includes('JABERO'), false)
  await guardarCache({
    campania: '2026',
    sincronizado_en: '',
    trabajadores: [{ dni: '80000003', nombre: 'Eva', roles: [] }],
    lotes: [],
    tickets: []
  })
  assert.equal((await obtenerTrabajador('80000003')).estado_sync_jabero, 'ERROR')
  await reintentarOperacion(op.id)
  assert.equal((await obtenerTrabajador('80000003')).estado_sync_jabero, 'PENDIENTE')
  assert.equal((await obtenerTrabajador('80000003')).roles.includes('JABERO'), true)
})

test('jabero sincronizado confirmado por servidor conserva el rol al recargar caché', async () => {
  await guardarCache({
    campania: '2026',
    sincronizado_en: '',
    trabajadores: [{ dni: '80000005', nombre: 'Rosa', roles: [] }],
    lotes: [],
    tickets: []
  })
  const op = await agregarOperacion('REGISTRAR_JABERO', { dniTrabajador: '80000005' })
  await agregarRolTrabajador('80000005', 'JABERO', op.id)
  await marcarJabero('80000005', 'SINCRONIZADO', op.id)

  await guardarCache({
    campania: '2026',
    sincronizado_en: '',
    trabajadores: [{ dni: '80000005', nombre: 'Rosa', roles: ['JABERO'] }],
    lotes: [],
    tickets: []
  })

  assert.equal((await obtenerTrabajador('80000005')).roles.includes('JABERO'), true)
})

test('login usa caché únicamente para fallo de red', async () => {
  const local = async () => ({
    dni: '12345678',
    nombre: 'Operador',
    autorizado_para_fecha: fechaOperativa()
  })
  const guardar = async () => {
    throw new Error('No debe guardar')
  }
  const caida = async () => {
    throw new TypeError('Failed to fetch')
  }
  assert.equal(
    (await validarOperadorConFuentes('12345678', caida, local, guardar)).offline,
    true
  )
  const rechazo = async () => {
    throw Object.assign(new Error('No autorizado'), { status: 403 })
  }
  await assert.rejects(
    validarOperadorConFuentes('12345678', rechazo, local, guardar),
    (error) => error.status === 403
  )
  await assert.rejects(
    validarOperadorConFuentes('12345678', async () => null, local, guardar),
    /no autorizó/
  )
})

test('limpieza conserva pendientes y errores y retira solo sincronizadas antiguas', async () => {
  const vieja = await agregarOperacion('LIMPIAR', {})
  await marcarOperacionSincronizada(vieja.id)
  const registro = (await obtenerColaCompleta()).find((op) => op.id === vieja.id)
  registro.sincronizado_en = '2020-01-01T00:00:00.000Z'
  await actualizarOperacion(registro)
  const pendiente = await agregarOperacion('CONSERVAR', {})
  const error = await agregarOperacion('CONSERVAR', {})
  await marcarOperacionError(error.id, 'Negocio')
  assert.equal(await limpiarOperacionesSincronizadas(), 1)
  const ids = (await obtenerColaCompleta()).map((op) => op.id)
  assert.equal(ids.includes(vieja.id), false)
  assert.equal(ids.includes(pendiente.id), true)
  assert.equal(ids.includes(error.id), true)
})

test('descartar un ticket fallido independiente desbloquea y conserva el orden', async () => {
  const fallida = await guardarAsignacionOffline({
    codigoTicket: 'DESCARTAR-INDEPENDIENTE',
    cosechadorDni: '80000001',
    cosechador: 'Ana',
    dniOperador: '12345678'
  })
  const segunda = await agregarOperacion('REGISTRAR_JABA', {
    codigoTicket: 'OTRO-TICKET',
    sesionId: 'otra-sesion'
  })
  const tercera = await agregarOperacion('CERRAR_SESION', { sesionId: 'otra-sesion' })
  const llamadas = []
  const procesar = async (op) => {
    llamadas.push(op.id)
    if (op.id === fallida.id) throw new Error('Ticket rechazado')
  }
  await ejecutarCola(
    [tercera, segunda, fallida],
    procesar,
    (op) => marcarOperacionSincronizada(op.id),
    (op, error) => marcarOperacionError(op.id, error.message)
  )
  assert.deepEqual(llamadas, [fallida.id])
  assert.equal(await descartarOperacion(fallida.id), true)
  assert.equal(await obtenerTicket('DESCARTAR-INDEPENDIENTE'), undefined)
  await ejecutarCola(
    (await obtenerColaCompleta())
      .filter((op) => [segunda.id, tercera.id].includes(op.id))
      .reverse(),
    procesar,
    (op) => marcarOperacionSincronizada(op.id),
    () => assert.fail('No debe fallar')
  )
  assert.deepEqual(llamadas, [fallida.id, segunda.id, tercera.id])
  const cola = await obtenerColaCompleta()
  assert.equal(cola.find((op) => op.id === segunda.id).estado, 'SINCRONIZADA')
  assert.equal(cola.find((op) => op.id === tercera.id).estado, 'SINCRONIZADA')
})

test('ticket fallido con lectura del mismo código no se descarta', async () => {
  const fallida = await agregarOperacion('ASIGNAR_TICKET', {
    codigoTicket: 'DESCARTAR-CON-LECTURA'
  })
  await marcarOperacionError(fallida.id, 'Rechazado')
  const dependiente = await agregarOperacion('REGISTRAR_JABA', {
    codigoTicket: 'DESCARTAR-CON-LECTURA',
    sesionId: 'sesion-dependiente'
  })
  await agregarOperacion('REGISTRAR_JABA', {
    codigoTicket: 'TICKET-DISTINTO',
    sesionId: 'sesion-distinta'
  })
  assert.deepEqual(
    obtenerOperacionesDependientes(fallida, await obtenerColaCompleta()).map(
      (op) => op.id
    ),
    [dependiente.id]
  )
  assert.equal(
    evaluarDescarteOperacion(fallida, await obtenerColaCompleta()).dependientes,
    1
  )
  assert.equal(await descartarOperacion(fallida.id), false)
  assert.ok((await obtenerColaCompleta()).some((op) => op.id === fallida.id))
})

test('jabero fallido con inicio de sesión del mismo DNI no se descarta', async () => {
  const fallida = await agregarOperacion('REGISTRAR_JABERO', {
    dniTrabajador: '81234567'
  })
  await marcarOperacionError(fallida.id, 'Rechazado')
  const inicio = await agregarOperacion('INICIAR_SESION', {
    dniJabero: '81234567',
    sesionId: 'sesion-jabero-dependiente'
  })
  assert.deepEqual(
    obtenerOperacionesDependientes(fallida, await obtenerColaCompleta()).map(
      (op) => op.id
    ),
    [inicio.id]
  )
  assert.equal(await descartarOperacion(fallida.id), false)
})

test('jabero fallido se descarta aunque haya una asignación de ticket posterior', async () => {
  const fallida = await agregarOperacion('REGISTRAR_JABERO', {
    dniTrabajador: '82345678'
  })
  await marcarOperacionError(fallida.id, 'Rechazado')
  const posterior = await agregarOperacion('ASIGNAR_TICKET', {
    codigoTicket: 'TICKET-POSTERIOR'
  })
  const cola = await obtenerColaCompleta()
  assert.equal(
    evaluarDescarteOperacion(
      cola.find((op) => op.id === fallida.id),
      cola
    ).permitido,
    true
  )
  assert.equal(await descartarOperacion(fallida.id), true)
  assert.ok((await obtenerColaCompleta()).some((op) => op.id === posterior.id))
})

test('inicio de sesión reconoce lecturas y cierre de su sesión como dependientes', async () => {
  const inicio = await agregarOperacion('INICIAR_SESION', {
    dniJabero: '83456789',
    sesionId: 'sesion-para-dependencias'
  })
  const lectura = await agregarOperacion('REGISTRAR_JABA', {
    codigoTicket: 'TICKET-SESION',
    sesionId: 'sesion-para-dependencias'
  })
  const cierre = await agregarOperacion('CERRAR_SESION', {
    sesionId: 'sesion-para-dependencias'
  })
  await agregarOperacion('REGISTRAR_JABA', {
    codigoTicket: 'TICKET-SESION',
    sesionId: 'otra-sesion-independiente'
  })
  assert.deepEqual(
    obtenerOperacionesDependientes(inicio, await obtenerColaCompleta())
      .map((op) => op.id)
      .sort(),
    [lectura.id, cierre.id].sort()
  )
})

test('descartar último ticket rechazado quita su dato local', async () => {
  const op = await guardarAsignacionOffline({
    codigoTicket: 'DESCARTAR-1',
    cosechadorDni: '80000001',
    cosechador: 'Ana',
    dniOperador: '12345678'
  })
  await marcarOperacionError(op.id, 'Ticket rechazado')
  assert.equal(await descartarOperacion(op.id), true)
  assert.equal(await obtenerTicket('DESCARTAR-1'), undefined)
})

test('exportador omite entorno, secretos, generados y enlaces', () => {
  for (const nombre of [
    '.git',
    'node_modules',
    'dist',
    '.env',
    '.env.production',
    'service_role.key',
    'credentials.json',
    'arbol-y-contenido.txt'
  ]) {
    assert.equal(archivoExcluido(nombre), true, nombre)
  }
  assert.equal(archivoExcluido('index.html'), false)
  assert.equal(archivoExcluido('enlace', true), true)
  const encabezado = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ')
  const pie = ['-----END', 'PRIVATE KEY-----'].join(' ')
  assert.equal(contenidoSensible(`${encabezado}\n${'x'.repeat(64)}\n${pie}`), true)
  assert.equal(contenidoSensible('sb_secret_' + 'abcdefghijklmnopqrstuvwxyz'), true)
  assert.equal(
    contenidoSensible('import { createClient } from "@supabase/supabase-js"'),
    false
  )
})

test('un reintento de lectura conserva el mismo UUID local', async () => {
  const operacion = await agregarOperacion('REGISTRAR_JABA', {
    sesionId: 'sesion-1',
    codigoTicket: 'TICKET-1',
    lecturaId: crypto.randomUUID()
  })
  const recibidos = new Set()
  const procesar = async (item) => {
    const id = item.payload.lecturaId
    recibidos.add(id)
    if (recibidos.size === 1 && !item.reintentada) {
      item.reintentada = true
      throw new TypeError('Failed to fetch')
    }
  }
  await ejecutarCola(
    [operacion],
    procesar,
    () => {},
    () => {}
  )
  await ejecutarCola(
    [operacion],
    procesar,
    () => {},
    () => {}
  )
  assert.equal(recibidos.size, 1)
})

test('asignación, inicio, lectura y cierre guardan dato y operación juntos', async () => {
  const asignacion = await guardarAsignacionOffline({
    codigoTicket: 'TX-1',
    cosechadorDni: '80000001',
    cosechador: 'Ana',
    dniOperador: '12345678'
  })
  assert.equal((await obtenerTicket('TX-1')).operacion_id, asignacion.id)
  await assert.rejects(
    guardarAsignacionOffline({
      codigoTicket: 'TX-1',
      cosechadorDni: '80000001',
      cosechador: 'Ana',
      dniOperador: '12345678'
    })
  )
  const sesion = {
    id: 'tx-sesion',
    sesion_id: 'tx-sesion',
    estado: 'ACTIVA',
    dni_jabero: '87650000',
    lote_id: 'lote-1',
    dni_operador: '12345678'
  }
  await iniciarSesionOffline(sesion, '12345678')
  await assert.rejects(
    iniciarSesionOffline(
      { ...sesion, id: 'tx-sesion-2', sesion_id: 'tx-sesion-2' },
      '12345678'
    )
  )
  await registrarLecturaOffline(
    {
      id: 'tx-lectura',
      sesion_id: 'tx-sesion',
      codigo_ticket: 'TX-1',
      fecha_hora: '2026-09-29T00:00:00Z',
      cosechador_dni: '80000001',
      estado_sync: 'PENDIENTE'
    },
    '12345678'
  )
  assert.equal(await contarLecturasSesion('tx-sesion'), 1)
  await finalizarSesionOffline('tx-sesion', '12345678')
  assert.equal(await obtenerSesionActivaJabero('87650000'), undefined)
  assert.equal(
    (await obtenerColaCompleta()).filter((op) => op.payload.sesionId === 'tx-sesion')
      .length,
    3
  )
})

test('registro de jabero crea rol pendiente y operación en una transacción', async () => {
  await guardarCache({
    campania: '2026',
    sincronizado_en: '',
    trabajadores: [{ dni: '80000004', nombre: 'Rosa', roles: [] }],
    lotes: [],
    tickets: []
  })
  const op = await registrarJaberoOffline('12345678', '80000004')
  const trabajador = await obtenerTrabajador('80000004')
  assert.equal(trabajador.estado_sync_jabero, 'PENDIENTE')
  assert.equal(trabajador.operacion_jabero_id, op.id)
  await assert.rejects(registrarJaberoOffline('12345678', '80000004'))
})
