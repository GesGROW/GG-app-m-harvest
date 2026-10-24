import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import * as local from '../src/offline/db.js'
import { ejecutarCola, obtenerOperacionesDependientes } from '../src/offline/cola.js'
import { validarOperadorConFuentes } from '@gesgrow/core/contexts/identity-access/application/authLogic.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/domain/fechaOperativa.js'

const operador = '47480378'
const cache = (id, rol) => ({
  campania: { id, nombre: id, estado: 'ACTIVA' },
  sincronizado_en: new Date().toISOString(),
  trabajadores: [{ dni: '81000001', nombre: 'Compartido', roles: [rol] }],
  lotes: [
    {
      lote_id: `lote-${id}`,
      codigo: 'L1',
      variedades: [{ id: `v-${id}`, nombre: `Variedad ${id}` }]
    }
  ],
  tickets: []
})

test('el mismo PDA conserva cachés de dos campañas sin compartir roles ni tickets', async () => {
  await local.seleccionarCampaniaLocal('A')
  await local.guardarCache(cache('A', 'JABERO'))
  await local.guardarAsignacionOffline({
    codigoTicket: 'T1',
    cosechadorDni: '81000002',
    cosechador: 'Ana A',
    dniOperador: operador
  })
  await local.seleccionarCampaniaLocal('B')
  await local.guardarCache(cache('B', 'COSECHADOR'))
  assert.deepEqual((await local.obtenerTrabajador('81000001')).roles, ['COSECHADOR'])
  assert.equal(await local.obtenerTicket('T1'), undefined)
  await local.guardarAsignacionOffline({
    codigoTicket: 'T1',
    cosechadorDni: '81000003',
    cosechador: 'Ana B',
    dniOperador: operador
  })
  assert.equal((await local.obtenerTicket('T1')).cosechador, 'Ana B')
  await local.seleccionarCampaniaLocal('A')
  assert.equal((await local.obtenerTicket('T1')).cosechador, 'Ana A')
  assert.deepEqual((await local.obtenerTrabajador('81000001')).roles, ['JABERO'])
  assert.equal((await local.obtenerLotes())[0].lote_id, 'lote-A')
  assert.equal((await local.obtenerCampaniaActiva()).id, 'A')
})

test('un refresco o confirmación de otra campaña no reemplaza los datos de la campaña abierta', async () => {
  await local.seleccionarCampaniaLocal('B')
  await local.guardarCache(cache('A', 'JABERO'))
  await local.marcarTicketSincronizado('T1', 'A')
  assert.equal((await local.obtenerTicket('T1')).estado_sync, 'PENDIENTE')
  assert.equal((await local.obtenerTrabajador('81000001')).roles[0], 'COSECHADOR')
  await local.seleccionarCampaniaLocal('A')
  assert.equal((await local.obtenerTicket('T1')).estado_sync, 'SINCRONIZADO')
})

test('sesiones del mismo jabero se separan por campaña, conservando las operaciones al cambiar de cultivo', async () => {
  for (const id of ['A', 'B']) {
    await local.seleccionarCampaniaLocal(id)
    await local.iniciarSesionOffline(
      {
        id: `s-${id}`,
        sesion_id: `s-${id}`,
        dni_jabero: '81000001',
        dni_operador: operador,
        lote_id: `lote-${id}`,
        variedad_id: `v-${id}`,
        estado: 'ACTIVA'
      },
      operador
    )
    await local.registrarLecturaOffline(
      {
        id: `j-${id}`,
        sesion_id: `s-${id}`,
        codigo_ticket: 'T1',
        fecha_hora: new Date().toISOString()
      },
      operador
    )
  }
  assert.deepEqual(
    (await local.obtenerSesionesActivas(operador)).map((s) => s.id),
    ['s-B']
  )
  assert.equal((await local.obtenerSesionActivaJabero('81000001')).id, 's-B')
  assert.equal((await local.obtenerLecturasSesion('s-B'))[0].campania_id, 'B')
  await assert.rejects(
    local.registrarLecturaOffline({ id: 'cruce', sesion_id: 's-A' }, operador),
    /campaña seleccionada/
  )
  await assert.rejects(
    local.finalizarSesionOffline('s-A', operador),
    /campaña seleccionada/
  )
  const ops = await local.obtenerColaCompleta()
  for (const id of ['A', 'B']) {
    assert.equal(
      ops.find((o) => o.payload.sesionId === `s-${id}` && o.tipo === 'REGISTRAR_JABA')
        .payload.campaniaId,
      id
    )
  }
  await local.seleccionarCampaniaLocal('A')
  assert.deepEqual(
    (await local.obtenerSesionesActivas(operador)).map((s) => s.id),
    ['s-A']
  )
  await local.finalizarSesionOffline('s-A', operador)
  assert.equal(
    (await local.obtenerColaCompleta()).find((o) => o.tipo === 'CERRAR_SESION').payload
      .campaniaId,
    'A'
  )
})

test('un error bloquea solo su campaña y las dependencias no cruzan cultivos', async () => {
  const op = (id, campaniaId, tipo, payload = {}) => ({
    id,
    tipo,
    estado: 'PENDIENTE',
    creado_en: `2026-10-11T12:00:0${id}Z`,
    payload: { campaniaId, ...payload }
  })
  const ops = [
    op('1', 'A', 'ASIGNAR_TICKET', { codigoTicket: 'T1' }),
    op('2', 'A', 'REGISTRAR_JABA', { codigoTicket: 'T1' }),
    op('3', 'B', 'ASIGNAR_TICKET', { codigoTicket: 'T1' }),
    op('4', 'B', 'REGISTRAR_JABA', { codigoTicket: 'T1' })
  ]
  assert.deepEqual(
    obtenerOperacionesDependientes(ops[0], ops).map((o) => o.id),
    ['2']
  )
  const procesadas = []
  await ejecutarCola(
    ops,
    async (o) => {
      procesadas.push(o.id)
      if (o.id === '1') throw new Error('Rechazo')
    },
    async () => {},
    async () => {}
  )
  assert.deepEqual(procesadas, ['1', '3', '4'])
})

test('la autorización offline conserva las campañas del login y caduca por día', async () => {
  const remoto = {
    dni: operador,
    nombre: 'Supervisora',
    autorizado_para_fecha: fechaOperativa(),
    campanias: [{ id: 'A' }, { id: 'B' }]
  }
  let guardado
  await validarOperadorConFuentes(
    operador,
    async () => remoto,
    async () => null,
    async (value) => {
      guardado = value
    }
  )
  const offline = await validarOperadorConFuentes(
    operador,
    async () => {
      throw new Error('Failed to fetch')
    },
    async () => guardado,
    async () => {}
  )
  assert.deepEqual(offline.campanias, remoto.campanias)
  guardado.autorizado_para_fecha = '2000-01-01'
  await assert.rejects(
    validarOperadorConFuentes(
      operador,
      async () => {
        throw new Error('Failed to fetch')
      },
      async () => guardado,
      async () => {}
    ),
    /venció/
  )
})
