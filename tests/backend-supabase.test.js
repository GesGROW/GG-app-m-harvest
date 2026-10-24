import assert from 'node:assert/strict'
import test from 'node:test'
import { crearSupabaseBackend } from '../src/infrastructure/supabase/backendAdapter.js'
import { ErrorBackend, OperacionNoDisponible } from '@gesgrow/core/backend/errores.js'
import { backend, configurarBackend } from '@gesgrow/core/backend/backend.js'
import { esErrorTemporal } from '../src/offline/errores.js'
import { validarOperadorConFuentes } from '@gesgrow/core/contexts/identity-access/application/authLogic.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/domain/fechaOperativa.js'
import { obtenerProduccionDiaria } from '@gesgrow/core/contexts/harvest/application/reports/produccionDiaria.js'
import { obtenerRankingCosechadores } from '@gesgrow/core/contexts/harvest/application/reports/rankingCosechadores.js'
import {
  respuestaAsignacionHarvest,
  respuestaRegistroHarvest
} from './helpers/asignacionHarvest.js'
import { DatoDeTicketsInvalido } from '@gesgrow/core/contexts/harvest/index.js'

const datos = { ok: true }
function preparar(responder = async () => ({ data: datos, error: null })) {
  const llamadas = []
  const adapter = crearSupabaseBackend({
    async rpc(...args) {
      llamadas.push(args)
      return responder(...args)
    }
  })
  return { adapter, llamadas }
}

// Contratos anteriores a la refactorización, incluidos los parámetros opcionales.
const contratos = [
  [
    'obtenerCacheOperativa',
    'obtener_cache_operativa',
    (adapter, campaniaId) => adapter.obtenerCacheOperativa('12345678', campaniaId),
    { p_dni_operador: '12345678' }
  ],
  [
    'registrarJabero',
    'registrar_jabero',
    (adapter, campaniaId) =>
      adapter.registrarJabero({
        dniOperador: '12345678',
        campaniaId,
        dniTrabajador: '87654321',
        operacionId: 'op-2'
      }),
    { p_dni_operador: '12345678', p_dni_trabajador: '87654321', p_operacion_id: 'op-2' }
  ],
  [
    'iniciarSesionLectura',
    'iniciar_sesion_lectura',
    (adapter, campaniaId) =>
      adapter.iniciarSesionLectura({
        dniOperador: '12345678',
        campaniaId,
        dniJabero: '87654321',
        loteId: 'lote-1',
        sesionId: 'sesion-1',
        variedadId: 'variedad-1'
      }),
    {
      p_dni_operador: '12345678',
      p_dni_jabero: '87654321',
      p_lote_id: 'lote-1',
      p_sesion_id: 'sesion-1',
      p_variedad_id: 'variedad-1'
    }
  ],
  [
    'cerrarSesionLectura',
    'cerrar_sesion_lectura',
    (adapter, campaniaId) =>
      adapter.cerrarSesionLectura({
        dniOperador: '12345678',
        campaniaId,
        sesionId: 'sesion-1',
        operacionId: 'op-4'
      }),
    { p_dni_operador: '12345678', p_sesion_id: 'sesion-1', p_operacion_id: 'op-4' }
  ],
  [
    'obtenerProduccionDiaria',
    'obtener_produccion_diaria',
    (adapter, campaniaId) =>
      adapter.obtenerProduccionDiaria({
        dniOperador: '12345678',
        campaniaId,
        zonaHoraria: 'America/Lima'
      }),
    { p_dni_operador: '12345678', p_zona_horaria: 'America/Lima' }
  ],
  [
    'obtenerProduccionLotes',
    'obtener_produccion_lotes',
    (adapter, campaniaId) =>
      adapter.obtenerProduccionLotes({ dniOperador: '12345678', campaniaId }),
    { p_dni_operador: '12345678' }
  ],
  [
    'obtenerResumenCampania',
    'obtener_resumen_campania',
    (adapter, campaniaId) =>
      adapter.obtenerResumenCampania({
        dniOperador: '12345678',
        campaniaId,
        zonaHoraria: 'America/Lima'
      }),
    { p_dni_operador: '12345678', p_zona_horaria: 'America/Lima' }
  ],
  [
    'obtenerRankingCosechadores',
    'obtener_ranking_cosechadores_periodo',
    (adapter, campaniaId) =>
      adapter.obtenerRankingCosechadores({
        dniOperador: '12345678',
        campaniaId,
        periodo: 'SEMANA'
      }),
    { p_dni_operador: '12345678', p_periodo: 'SEMANA' }
  ]
]

for (const [operacion, nombre, ejecutar, parametros] of contratos) {
  for (const campaniaId of [undefined, null, '', 'campania-1']) {
    test(`${operacion}: conserva RPC y parámetros con campaña ${campaniaId}`, async () => {
      const { adapter, llamadas } = preparar()
      assert.strictEqual(await ejecutar(adapter, campaniaId), datos)
      assert.deepEqual(llamadas, [
        [
          campaniaId ? `${nombre}_campania` : nombre,
          campaniaId ? { ...parametros, p_campania_id: campaniaId } : parametros
        ]
      ])
    })
  }
}

test('asignarTicket usa AsignarLoteDeTickets, campaña explícita y reconstrucción de dominio', async () => {
  const { adapter, llamadas } = preparar(async (_, parametros) => ({
    data: respuestaAsignacionHarvest(parametros)
  }))
  const resultado = await adapter.asignarTicket({
    dniOperador: '12345678',
    campaniaId: 'C',
    dniCosechador: '87654321',
    codigoTicket: 'T001',
    operacionId: 'OP'
  })
  assert.equal(resultado.lote.estado, 'ASIGNADO')
  assert.equal(resultado.asignacion.trabajadorId, '87654321')
  assert.equal(resultado.asignacion.operacionId, 'OP')
  assert.deepEqual(llamadas, [
    [
      'harvest_asignar_lote_tickets',
      {
        p_campania_id: 'C',
        p_codigo_ticket: 'T001',
        p_dni_operador: '12345678',
        p_dni_cosechador: '87654321',
        p_operacion_id: 'OP'
      }
    ]
  ])
})

test('asignarTicket sin campaña falla sin usar asignación legacy ni inferir campañas', async () => {
  const { adapter, llamadas } = preparar()
  for (const campaniaId of [undefined, null, ''])
    await assert.rejects(
      adapter.asignarTicket({
        dniOperador: '12345678',
        campaniaId,
        dniCosechador: '87654321',
        codigoTicket: 'T001',
        operacionId: 'OP'
      }),
      DatoDeTicketsInvalido
    )
  assert.deepEqual(llamadas, [])
})

test('autenticación y lotes conservan las RPC sin campaña y la aridad original', async () => {
  const { adapter, llamadas } = preparar()
  assert.strictEqual(await adapter.validarOperador('12345678'), datos)
  assert.strictEqual(await adapter.listarLotesActivos(), datos)
  assert.deepEqual(llamadas, [
    ['validar_operador_campanias', { p_dni: '12345678' }],
    ['listar_lotes_activos_v2']
  ])
})

test('iniciar sesión omite variedades vacías y conserva operación sin identificador', async () => {
  const { adapter, llamadas } = preparar()
  for (const variedadId of [undefined, null, '']) {
    await adapter.iniciarSesionLectura({
      dniOperador: '12345678',
      dniJabero: '87654321',
      loteId: 'L',
      sesionId: 'S',
      variedadId
    })
  }
  for (const [, parametros] of llamadas)
    assert.ok(!Object.hasOwn(parametros, 'p_variedad_id'))
  await adapter.registrarJabero({ dniOperador: '12345678', dniTrabajador: '87654321' })
  assert.ok(Object.hasOwn(llamadas.at(-1)[1], 'p_operacion_id'))
  assert.equal(llamadas.at(-1)[1].p_operacion_id, undefined)
})

test('conserva UUID, hora por defecto de lectura y período HOY', async () => {
  const { adapter, llamadas } = preparar(async (nombre, args) => ({
    data:
      nombre === 'harvest_registrar_cosecha' ? respuestaRegistroHarvest(args) : datos
  }))
  const antes = Date.now()
  await adapter.registrarLecturaJaba({
    dniOperador: '12345678',
    campaniaId: 'C',
    sesionId: 'S',
    codigoTicket: 'T',
    operacionId: 'OP'
  })
  const parametros = llamadas[0][1]
  assert.match(parametros.p_lectura_id, /^[0-9a-f-]{36}$/)
  assert.ok(
    Date.parse(parametros.p_fecha_hora) >= antes &&
      Date.parse(parametros.p_fecha_hora) <= Date.now()
  )
  await adapter.obtenerRankingCosechadores({ dniOperador: '12345678' })
  assert.equal(llamadas[1][1].p_periodo, 'HOY')
})

test('puerto y adapter exponen exactamente operaciones de negocio, sin RPC genérica', async () => {
  const { adapter, llamadas } = preparar()
  configurarBackend(adapter)
  assert.deepEqual(Object.keys(adapter).sort(), Object.keys(backend).sort())
  assert.equal(adapter.rpc, undefined)
  assert.equal(backend.rpc, undefined)
  assert.strictEqual(await backend.validarOperador('12345678'), datos)
  assert.deepEqual(llamadas[0], ['validar_operador_campanias', { p_dni: '12345678' }])
  assert.throws(() => configurarBackend({}), /Falta la operación/)
})

test('todos los errores remotos se convierten a errores neutrales sin códigos del proveedor', async () => {
  for (const error of [
    { code: '23505', message: 'Duplicado', details: 'detalle', hint: 'pista' },
    { code: 'PGRST202', message: 'Operación ausente' },
    { status: 403, message: 'No autorizado' },
    { status: 503, message: 'Servicio no disponible' },
    { code: '408', message: 'Tiempo agotado' },
    new TypeError('Failed to fetch')
  ]) {
    for (const rechazo of [false, true]) {
      const { adapter } = preparar(async () => {
        if (rechazo) throw error
        return { data: null, error }
      })
      await assert.rejects(adapter.validarOperador('12345678'), (neutral) => {
        assert.ok(neutral instanceof ErrorBackend)
        assert.equal(neutral.message, error.message)
        for (const campo of ['code', 'details', 'hint'])
          assert.equal(neutral[campo], undefined)
        assert.equal(esErrorTemporal(neutral), esErrorTemporal(error))
        if (error.code === 'PGRST202')
          assert.ok(neutral instanceof OperacionNoDisponible)
        return true
      })
    }
  }
})

test('authLogic recibe datos, guarda la misma autorización y usa caché solo ante fallos temporales', async () => {
  const operador = {
    dni: '12345678',
    nombre: 'Operador',
    autorizado_para_fecha: fechaOperativa(),
    campanias: [{ id: 'C' }]
  }
  let guardado
  const { adapter } = preparar(async () => ({ data: operador }))
  assert.strictEqual(
    await validarOperadorConFuentes(
      operador.dni,
      adapter.validarOperador,
      async () => null,
      async (o) => {
        guardado = o
      }
    ),
    operador
  )
  assert.deepEqual(guardado.campanias, operador.campanias)
  assert.equal(guardado.autorizado_para_fecha, operador.autorizado_para_fecha)
  for (const [error, temporal] of [
    [{ message: 'Failed to fetch' }, true],
    [{ status: 403, message: 'No autorizado' }, false]
  ]) {
    const { adapter: fallido } = preparar(async () => ({ error }))
    const validar = () =>
      validarOperadorConFuentes(
        operador.dni,
        fallido.validarOperador,
        async () => operador,
        async () => {
          assert.fail('No debe guardar')
        }
      )
    if (temporal) assert.equal((await validar()).offline, true)
    else await assert.rejects(validar(), /No autorizado/)
  }
})

test('reportes conservan mensajes actuales cuando falta la operación remota', async () => {
  const { adapter } = preparar(async () => ({
    error: { code: 'PGRST202', message: 'Could not find the function' }
  }))
  await assert.rejects(
    obtenerProduccionDiaria(
      '12345678',
      adapter.obtenerProduccionDiaria,
      () => 'America/Lima'
    ),
    /Solicite a Administración que habilite el reporte/
  )
  await assert.rejects(
    obtenerRankingCosechadores('12345678', adapter.obtenerRankingCosechadores),
    /El ranking por período requiere actualizar el sistema en Supabase/
  )
})
