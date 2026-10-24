import { puertosOfflineParaFuentes } from './helpers/puertosOffline.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { crearCasosDeUso } from '../src/application/crearCasosDeUso.js'
import { fechaOperativa } from '@gesgrow/core/contexts/identity-access/domain/fechaOperativa.js'

const operador = {
  dni: '12345678',
  campania: { id: 'C' },
  campanias: [{ id: 'C', nombre: 'Actual' }]
}
const cosechador = { dni: '87654321', nombre: 'Ana' }
const trabajador = { dni: '87654322', nombre: 'Juan', roles: ['JABERO'] }
const lote = {
  lote_id: 'L',
  codigo: 'L1',
  variedades: [{ id: 'V', nombre: 'Ventura' }]
}
const sesionLectura = { sesion_id: 'S', dni_jabero: trabajador.dni }
const ticket = { cosechador_dni: cosechador.dni, cosechador: cosechador.nombre }
const fecha = '2026-10-14T12:00:00.000Z'
const operacion = { id: 'operacion-local' }
const cacheRemota = { campania: { id: 'C' }, trabajadores: [], tickets: [], lotes: [] }

function preparar(cambios = {}) {
  const llamadas = []
  const fuente =
    (nombre, valor) =>
    async (...args) => {
      llamadas.push([nombre, ...args])
      return valor
    }
  const dependencias = {
    backend: {
      validarOperador: fuente('validar', {
        ...operador,
        autorizado_para_fecha: fechaOperativa()
      })
    },
    obtenerOperador: fuente('operadorLocal', null),
    guardarOperador: fuente('guardarOperador'),
    seleccionarCampaniaLocal: fuente('seleccionar'),
    obtenerCacheCampania: fuente('cache', { campania: { id: 'C' } }),
    actualizarCacheOperativa: fuente('actualizarCache', cacheRemota),
    guardarCache: fuente('guardarCache'),
    obtenerTicket: fuente('ticket', ticket),
    existeTicketPendiente: fuente('ticketPendiente', false),
    guardarAsignacionOffline: fuente('guardarAsignacion', operacion),
    obtenerTrabajador: fuente('trabajador', trabajador),
    registrarJaberoOffline: fuente('guardarJabero', operacion),
    obtenerSesionActivaJabero: fuente('sesionActiva', null),
    obtenerLotes: fuente('lotes', [lote]),
    iniciarSesionOffline: fuente('guardarSesion', operacion),
    obtenerColaCompleta: fuente('cola', []),
    registrarLecturaOffline: fuente('guardarLectura', operacion),
    contarLecturasSesion: fuente('total', 8),
    contarLecturasCosechador: fuente('totalPersona', 3),
    finalizarSesionOffline: fuente('cerrarSesion', operacion),
    generarId: () => {
      llamadas.push(['uuid'])
      return 'UUID'
    },
    ahora: () => {
      llamadas.push(['hora'])
      return fecha
    },
    estaEnLinea: () => true,
    sincronizarPendientes: fuente('sync'),
    registrarError: (...args) => llamadas.push(['log', ...args]),
    ...cambios
  }
  dependencias.offline = puertosOfflineParaFuentes(dependencias)
  dependencias.backend.obtenerCacheOperativa = (...args) =>
    dependencias.actualizarCacheOperativa(...args)
  return { casos: crearCasosDeUso(dependencias), llamadas, dependencias }
}

test('ValidarOperador entrega los mismos datos y conserva la autorización guardada', async () => {
  const { casos, llamadas } = preparar()
  const resultado = await casos.validarOperador(operador.dni)
  assert.deepEqual(
    llamadas.map(([nombre]) => nombre),
    ['validar', 'guardarOperador']
  )
  assert.equal(resultado.dni, operador.dni)
  const guardado = llamadas[1][1]
  assert.deepEqual(guardado.campanias, operador.campanias)
  assert.equal(guardado.autorizado_para_fecha, fechaOperativa())
  assert.ok(guardado.actualizado_en)
})

test('ValidarOperador conserva el fallback temporal y no usa caché ante rechazo', async () => {
  const local = { ...operador, autorizado_para_fecha: fechaOperativa() }
  for (const [error, temporal] of [
    [new Error('Failed to fetch'), true],
    [new Error('No autorizado'), false]
  ]) {
    const { casos, llamadas } = preparar({
      backend: {
        validarOperador: async () => {
          throw error
        }
      },
      obtenerOperador: async () => local
    })
    if (temporal)
      assert.equal((await casos.validarOperador(operador.dni)).offline, true)
    else await assert.rejects(casos.validarOperador(operador.dni), (e) => e === error)
    assert.deepEqual(llamadas, [])
  }
})

test('IngresarCampania selecciona, consulta caché y refresca antes de entregar el operador', async () => {
  const { casos, llamadas } = preparar()
  const resultado = await casos.ingresarCampania({ operador, campania: { id: 'C' } })
  assert.deepEqual(llamadas, [
    ['seleccionar', 'C'],
    ['cache', 'C'],
    ['actualizarCache', operador.dni, 'C'],
    ['guardarCache', cacheRemota]
  ])
  assert.deepEqual(resultado.operador.campania, operador.campanias[0])
  assert.notStrictEqual(resultado.operador, operador)
  await resultado.sincronizar()
  assert.deepEqual(llamadas.at(-1), ['sync'])
})

test('IngresarCampania no entrega el ingreso antes de confirmar la caché por el puerto', async () => {
  let confirmar
  let ingresoTerminado = false
  let cacheGuardada
  const { casos } = preparar({
    guardarCache: (cache) => {
      cacheGuardada = cache
      return new Promise((resolve) => {
        confirmar = resolve
      })
    }
  })
  const ingreso = casos
    .ingresarCampania({ operador, campania: { id: 'C' } })
    .then((resultado) => {
      ingresoTerminado = true
      return resultado
    })
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(cacheGuardada, cacheRemota)
  assert.equal(ingresoTerminado, false)
  confirmar()
  assert.equal((await ingreso).operador.campania.id, 'C')
})

test('IngresarCampania conserva el rechazo de escritura de caché sin sincronizar', async () => {
  const error = new Error('Escritura de caché rechazada')
  const { casos, llamadas } = preparar({
    guardarCache: async () => {
      throw error
    }
  })
  await assert.rejects(
    casos.ingresarCampania({ operador, campania: { id: 'C' } }),
    (e) => e === error
  )
  assert.ok(!llamadas.some(([nombre]) => nombre === 'sync'))
})

test('IngresarCampania rechaza una campaña ajena antes de cambiar el contexto local', async () => {
  const { casos, llamadas } = preparar()
  await assert.rejects(
    casos.ingresarCampania({ operador, campania: { id: 'AJENA' } }),
    /ya no está asignada/
  )
  assert.deepEqual(llamadas, [])
})

for (const cache of [null, { campania: { id: 'C' } }]) {
  test(`IngresarCampania offline ${cache ? 'usa caché' : 'rechaza campaña sin caché'}`, async () => {
    const { casos, llamadas } = preparar({
      obtenerCacheCampania: async () => cache,
      estaEnLinea: () => false
    })
    const ejecutar = () =>
      casos.ingresarCampania({
        operador: { ...operador, offline: true },
        campania: { id: 'C' }
      })
    if (cache) {
      const resultado = await ejecutar()
      assert.equal(await resultado.sincronizar(), false)
    } else await assert.rejects(ejecutar(), /no está disponible sin conexión/)
    assert.deepEqual(llamadas, [['seleccionar', 'C']])
  })
}

for (const [temporal, cache, permitido] of [
  [true, {}, true],
  [true, null, false],
  [false, {}, false]
]) {
  test(`IngresarCampania conserva fallback temporal=${temporal}, caché=${!!cache}`, async () => {
    const error = new Error(temporal ? 'Failed to fetch' : 'No autorizado')
    const { casos } = preparar({
      obtenerCacheCampania: async () => cache,
      actualizarCacheOperativa: async () => {
        throw error
      }
    })
    const ejecutar = () => casos.ingresarCampania({ operador, campania: { id: 'C' } })
    if (permitido) assert.equal((await ejecutar()).operador.dni, operador.dni)
    else await assert.rejects(ejecutar(), (e) => e === error)
  })
}

test('AsignarTicket consulta ambas fuentes antes de escribir y sincroniza después del éxito local', async () => {
  const { casos, llamadas, dependencias } = preparar()
  dependencias.obtenerTicket = async (codigo) => {
    llamadas.push(['ticket', codigo])
    return null
  }
  const resultado = await casos.asignarTicket({
    operador,
    cosechador,
    codigoTicket: 'T001'
  })
  assert.strictEqual(resultado.operacion, operacion)
  assert.deepEqual(llamadas, [
    ['ticket', 'T001'],
    ['ticketPendiente', 'T001'],
    [
      'guardarAsignacion',
      {
        codigoTicket: 'T001',
        cosechadorDni: cosechador.dni,
        cosechador: cosechador.nombre,
        dniOperador: operador.dni
      }
    ]
  ])
  llamadas.push(['exito'], ['liberarScanner'])
  await resultado.sincronizar()
  assert.deepEqual(llamadas.slice(-3), [['exito'], ['liberarScanner'], ['sync']])
})

for (const [existente, pendiente] of [
  [ticket, false],
  [null, true]
]) {
  test(`AsignarTicket rechaza duplicado existente=${!!existente}, pendiente=${pendiente}`, async () => {
    const { casos, llamadas } = preparar({
      obtenerTicket: async () => existente,
      existeTicketPendiente: async () => pendiente
    })
    await assert.rejects(
      casos.asignarTicket({ operador, cosechador, codigoTicket: 'T001' }),
      /El ticket ya fue asignado/
    )
    assert.deepEqual(llamadas, [])
  })
}

test('RegistrarJabero conserva la consulta previa incluso para trabajadores provisionales', async () => {
  for (const encontrado of [trabajador, null]) {
    const { casos, llamadas } = preparar({ obtenerTrabajador: async () => encontrado })
    const resultado = await casos.registrarJabero({ operador, dni: trabajador.dni })
    assert.strictEqual(resultado.trabajador, encontrado)
    assert.deepEqual(llamadas, [['guardarJabero', operador.dni, trabajador.dni]])
  }
})

test('IniciarSesionLectura conserva UUID, fecha, variedad, campaña y payload local', async () => {
  const { casos, llamadas } = preparar()
  const resultado = await casos.iniciarSesionLectura({
    operador,
    dni: trabajador.dni,
    loteId: 'L',
    variedadId: 'V'
  })
  assert.deepEqual(resultado.sesion, {
    sesion_id: 'UUID',
    jabero: trabajador.nombre,
    lote_id: 'L',
    lote_codigo: 'L1',
    campania_id: 'C',
    variedad_id: 'V',
    variedad: 'Ventura',
    dni_jabero: trabajador.dni,
    dni_operador: operador.dni,
    estado: 'ACTIVA',
    fecha_inicio: fecha
  })
  assert.deepEqual(
    llamadas.map(([nombre]) => nombre),
    ['trabajador', 'sesionActiva', 'lotes', 'uuid', 'hora', 'guardarSesion']
  )
  assert.deepEqual(llamadas.at(-1), [
    'guardarSesion',
    { id: 'UUID', ...resultado.sesion },
    operador.dni
  ])
})

for (const [cambios, mensaje] of [
  [{ obtenerTrabajador: async () => null }, /no está disponible localmente/],
  [
    { obtenerTrabajador: async () => ({ roles: [] }) },
    /no está registrado como jabero/
  ],
  [
    { obtenerTrabajador: async () => ({ ...trabajador, estado_sync_jabero: 'ERROR' }) },
    /registro de este jabero fue rechazado/
  ],
  [
    { obtenerSesionActivaJabero: async () => ({ id: 'EXISTENTE' }) },
    /ya tiene una sesión activa/
  ],
  [{ obtenerLotes: async () => [] }, /lote seleccionado no está disponible/],
  [
    { obtenerLotes: async () => [{ ...lote, variedades: [] }] },
    /Seleccione una variedad del lote/
  ]
]) {
  test(`IniciarSesionLectura rechaza ${mensaje} antes de generar UUID o escribir`, async () => {
    const { casos, llamadas } = preparar(cambios)
    await assert.rejects(
      casos.iniciarSesionLectura({
        operador,
        dni: trabajador.dni,
        loteId: 'L',
        variedadId: 'V'
      }),
      mensaje
    )
    assert.ok(
      !llamadas.some(([nombre]) =>
        ['uuid', 'hora', 'guardarSesion', 'sync'].includes(nombre)
      )
    )
  })
}

test('RegistrarLecturaJaba guarda una lectura con identidad estable antes de contar', async () => {
  const { casos, llamadas } = preparar()
  const resultado = await casos.registrarLecturaJaba({
    operador,
    sesionLectura,
    codigo: 'T001'
  })
  assert.deepEqual(
    llamadas.map(([nombre]) => nombre),
    [
      'trabajador',
      'cola',
      'ticket',
      'uuid',
      'hora',
      'guardarLectura',
      'total',
      'totalPersona'
    ]
  )
  assert.deepEqual(llamadas[5], [
    'guardarLectura',
    {
      id: 'UUID',
      sesion_id: 'S',
      codigo_ticket: 'T001',
      cosechador_dni: cosechador.dni,
      cosechador: cosechador.nombre,
      fecha_hora: fecha,
      estado_sync: 'PENDIENTE'
    },
    operador.dni
  ])
  assert.deepEqual([resultado.total, resultado.totalPersona], [8, 3])
  assert.strictEqual(resultado.ticket, ticket)
  await resultado.sincronizar()
  assert.deepEqual(llamadas.at(-1), ['sync'])
})

for (const [cambios, mensaje] of [
  [
    { obtenerTrabajador: async () => ({ estado_sync_jabero: 'ERROR' }) },
    /registro de este jabero fue rechazado/
  ],
  [
    {
      obtenerColaCompleta: async () => [
        { tipo: 'INICIAR_SESION', payload: { sesionId: 'S' }, estado: 'ERROR' }
      ]
    },
    /inicio de esta sesión fue rechazado/
  ],
  [{ obtenerTicket: async () => null }, /ticket no está asignado/],
  [
    { obtenerTicket: async () => ({ ...ticket, estado_sync: 'ERROR' }) },
    /ticket presenta un error de sincronización/
  ]
]) {
  test(`RegistrarLecturaJaba rechaza ${mensaje} antes de crear o guardar lectura`, async () => {
    const { casos, llamadas } = preparar(cambios)
    await assert.rejects(
      casos.registrarLecturaJaba({ operador, sesionLectura, codigo: 'T001' }),
      mensaje
    )
    assert.ok(
      !llamadas.some(([nombre]) =>
        ['uuid', 'hora', 'guardarLectura', 'total', 'sync'].includes(nombre)
      )
    )
  })
}

test('RegistrarLecturaJaba conserva lecturas repetidas y no bloquea por errores de otra sesión', async () => {
  const { casos, llamadas } = preparar({
    obtenerColaCompleta: async () => [
      { tipo: 'INICIAR_SESION', payload: { sesionId: 'OTRA' }, estado: 'ERROR' }
    ]
  })
  await casos.registrarLecturaJaba({ operador, sesionLectura, codigo: 'T001' })
  await casos.registrarLecturaJaba({ operador, sesionLectura, codigo: 'T001' })
  assert.equal(llamadas.filter(([nombre]) => nombre === 'guardarLectura').length, 2)
})

test('CerrarSesionLectura persiste el cierre antes de permitir sincronización', async () => {
  const { casos, llamadas } = preparar()
  const resultado = await casos.cerrarSesionLectura({ operador, sesionLectura })
  assert.deepEqual(llamadas, [['cerrarSesion', 'S', operador.dni]])
  assert.strictEqual(resultado.operacion, operacion)
  llamadas.push(['mostrarMenu'])
  await resultado.sincronizar()
  assert.deepEqual(llamadas.slice(-2), [['mostrarMenu'], ['sync']])
})

test('IngresarCampania mantiene el rechazo de sincronización para el manejador de presentación', async () => {
  const error = new Error('Fallo de sincronización')
  const { casos, llamadas } = preparar({
    sincronizarPendientes: async () => {
      throw error
    }
  })
  const resultado = await casos.ingresarCampania({ operador, campania: { id: 'C' } })
  await assert.rejects(resultado.sincronizar(), (e) => e === error)
  assert.ok(!llamadas.some(([nombre]) => nombre === 'log'))
})

for (const contador of ['contarLecturasSesion', 'contarLecturasCosechador']) {
  test(`RegistrarLecturaJaba propaga fallo de ${contador} sin repetir escritura ni sincronizar`, async () => {
    const error = new Error('No se pudo contar')
    const { casos, llamadas } = preparar({
      [contador]: async () => {
        throw error
      }
    })
    await assert.rejects(
      casos.registrarLecturaJaba({ operador, sesionLectura, codigo: 'T001' }),
      (e) => e === error
    )
    assert.equal(llamadas.filter(([nombre]) => nombre === 'guardarLectura').length, 1)
    assert.ok(!llamadas.some(([nombre]) => nombre === 'sync'))
  })
}

const escrituras = [
  [
    'asignarTicket',
    'guardarAsignacionOffline',
    { operador, cosechador, codigoTicket: 'T001' }
  ],
  ['registrarJabero', 'registrarJaberoOffline', { operador, dni: trabajador.dni }],
  [
    'iniciarSesionLectura',
    'iniciarSesionOffline',
    { operador, dni: trabajador.dni, loteId: 'L', variedadId: 'V' }
  ],
  [
    'registrarLecturaJaba',
    'registrarLecturaOffline',
    { operador, sesionLectura, codigo: 'T001' }
  ],
  ['cerrarSesionLectura', 'finalizarSesionOffline', { operador, sesionLectura }]
]
for (const [nombre, escritura, parametros] of escrituras) {
  test(`${nombre} no devuelve éxito ni sincroniza si falla la escritura local`, async () => {
    const error = new Error('Escritura rechazada')
    const { casos, llamadas } = preparar({
      ...(nombre === 'asignarTicket' ? { obtenerTicket: async () => null } : {}),
      [escritura]: async () => {
        throw error
      }
    })
    await assert.rejects(casos[nombre](parametros), (e) => e === error)
    assert.ok(
      !llamadas.some(([nombre]) => ['sync', 'total', 'totalPersona'].includes(nombre))
    )
  })
  test(`${nombre} conserva éxito local ante error de sincronización y registra el mensaje actual`, async () => {
    const error = new Error('No hay red')
    const { casos, llamadas, dependencias } = preparar({
      ...(nombre === 'asignarTicket' ? { obtenerTicket: async () => null } : {}),
      sincronizarPendientes: async () => {
        throw error
      }
    })
    const resultado = await casos[nombre](parametros)
    dependencias.estaEnLinea = () => false
    assert.equal(await resultado.sincronizar(), false)
    assert.ok(!llamadas.some(([nombre]) => nombre === 'log'))
    dependencias.estaEnLinea = () => true
    assert.equal(await resultado.sincronizar(), true)
    assert.equal(llamadas.at(-1)[0], 'log')
    assert.strictEqual(llamadas.at(-1)[2], error)
    assert.match(llamadas.at(-1)[1], /^No se pudo sincronizar/)
    assert.strictEqual(resultado.operacion, operacion)
  })
}
