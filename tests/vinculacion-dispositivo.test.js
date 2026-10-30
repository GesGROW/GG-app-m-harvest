import assert from 'node:assert/strict'
import test from 'node:test'
import 'fake-indexeddb/auto'
import {
  crearVinculacionDispositivo,
  tokenVinculacion
} from '../src/application/vinculacionDispositivo.js'
import { crearDispositivoIndexedDB } from '../src/infrastructure/indexeddb/dispositivoAdapter.js'
import { crearDispositivoSupabase } from '../src/infrastructure/supabase/dispositivoAdapter.js'
import {
  protegerBackendDispositivo,
  protegerCasosDispositivo
} from '../src/application/protegerDispositivo.js'

const token = 'a'.repeat(64),
  origen = 'https://gg-app-m-harvest.vercel.app'
function escenario() {
  let dato,
    sujeto = null,
    vinculado = false,
    actorDni = null,
    online = true,
    reloj = Date.parse('2026-10-27T18:00:00Z'),
    respuesta,
    fallo,
    pendientes = false
  const llamadas = [],
    bloqueos = []
  const almacen = {
    obtener: async () => structuredClone(dato),
    preparar: async () => {
      dato ??= { id: 'D', credencial: 'b'.repeat(64), estado: 'PENDIENTE' }
      return structuredClone(dato)
    },
    guardar: async (d) => {
      dato = structuredClone(d)
    }
  }
  const contexto = (actor = actorDni ?? sujeto) => ({
    dispositivo: { id: 'D', tenantId: 'A', estado: 'ACTIVO', nombre: 'PDA Norte' },
    contexto: { tenantId: 'A', usuarioId: actor, empresa: 'Empresa A' },
    operador: {
      dni: actor === 'U2' ? '87654321' : '12345678',
      tenant_id: 'A',
      campanias: [{ id: 'C', tenant_id: 'A' }],
      autorizado_para_fecha: '2026-10-27'
    },
    autorizadoHasta: '2026-10-28T05:00:00Z'
  })
  const remoto = {
    sujeto: async () => sujeto,
    iniciarSesion: async () => {
      sujeto = 'U'
    },
    salir: async () => {
      sujeto = null
    },
    vincular: async (d, t, n) => {
      llamadas.push(['vincular', d.id, t, n])
      vinculado = true
      return contexto()
    },
    ingresarConDni: async (d, dni) => {
      llamadas.push(['loginDni', d.id, dni])
      if (fallo) throw fallo
      actorDni = dni === '87654321' ? 'U2' : 'U'
      return respuesta ?? contexto()
    },
    validar: async (d) => {
      llamadas.push(['validar', d.id])
      if (fallo) throw fallo
      if (!vinculado) throw new Error('No vinculado')
      return respuesta ?? contexto()
    }
  }
  const nuevo = () =>
    crearVinculacionDispositivo({
      remoto,
      almacen,
      enLinea: () => online,
      ahora: () => reloj,
      alBloquear: (e) => bloqueos.push(e),
      comprobarDatos: async (_t, _dni, { salir } = {}) => {
        if (pendientes && salir) throw new Error('Hay pendientes')
      }
    })
  return {
    nuevo,
    remoto,
    almacen,
    llamadas,
    bloqueos,
    contexto,
    dato: () => dato,
    sujeto: (s) => {
      sujeto = s
    },
    offline: () => {
      online = false
    },
    hora: (h) => {
      reloj = Date.parse(h)
    },
    respuesta: (r) => {
      respuesta = r
    },
    fallo: (e) => {
      fallo = e
    },
    pendientes: () => {
      pendientes = true
    }
  }
}
async function preparar() {
  const e = escenario(),
    s = e.nuevo()
  await s.restaurar()
  await s.iniciarSesion({ email: 'u@test', password: 'secreto' })
  await s.vincular(token, 'PDA Norte')
  await s.iniciarConDni('12345678')
  await s.continuar()
  return { e, s }
}

test('las credenciales de transporte no quedan disponibles tras salir, revocación o vencimiento', async () => {
  const { e, s } = await preparar()
  assert.equal(s.credencialesSolicitud().dni, '12345678')
  await s.salir()
  assert.throws(
    () => s.credencialesSolicitud(),
    (e) => e.accesoDenegado
  )
  await s.iniciarConDni('87654321')
  assert.equal(s.credencialesSolicitud().dni, '87654321')
  e.fallo(Object.assign(new Error('Revocado'), { accesoDenegado: true }))
  await assert.rejects(s.validar({ forzar: true }), /Revocado/)
  assert.throws(
    () => s.credencialesSolicitud(),
    (e) => e.accesoDenegado
  )
  const otro = await preparar()
  otro.e.hora('2026-10-28T05:00:01Z')
  assert.throws(() => otro.s.credencialesSolicitud(), /venció/)
})

test('solo acepta el QR del mismo origen o el token del lector; rechaza destinos y parámetros extra', () => {
  assert.equal(tokenVinculacion(`${origen}/#vincular=${token}`, origen), token)
  assert.equal(tokenVinculacion(token, origen), token)
  assert.equal(
    tokenVinculacion(`${origen}/#vincular=${token}`, 'http://127.0.0.1:5173', [origen]),
    token
  )
  for (const url of [
    `https://evil.test/#vincular=${token}`,
    `${origen}/?token=${token}`,
    `${origen}/#vincular=${token}&vincular=${token}`,
    'javascript:alert(1)',
    'abc'
  ])
    assert.throws(() => tokenVinculacion(url, origen), /Escanea/)
})
test('vincula una sola vez, persiste antes del envío y conserva el equipo al salir y recargar', async () => {
  const { e, s } = await preparar()
  assert.equal(s.vista().empresa, 'Empresa A')
  assert.equal(JSON.stringify(e.dato()).includes(token), false)
  await assert.rejects(s.vincular(token, 'Otro'), /ya está vinculado/)
  await s.salir()
  assert.equal(e.dato().estado, 'VINCULADO')
  assert.equal(e.dato().autorizacion, null)
  const recargado = e.nuevo()
  await recargado.restaurar()
  await assert.rejects(recargado.continuar(), /tu DNI/)
  await recargado.iniciarConDni('12345678')
  await recargado.continuar()
  assert.equal(e.llamadas.filter((c) => c[0] === 'vincular').length, 1)
})
test('reutiliza UUID y credencial si se perdió la respuesta; recupera la vinculación aunque el QR ya haya cambiado', async () => {
  const e = escenario(),
    s = e.nuevo()
  await s.restaurar()
  await s.iniciarSesion({})
  const vincular = e.remoto.vincular
  e.remoto.vincular = async (...args) => {
    await vincular(...args)
    throw new Error('Respuesta perdida')
  }
  await assert.rejects(s.vincular(token, 'PDA'), /perdida/)
  const recargado = e.nuevo()
  await recargado.restaurar()
  assert.equal(recargado.vista().empresa, 'Empresa A')
  await assert.rejects(recargado.continuar(), /tu DNI/)
  assert.equal(e.llamadas.filter((c) => c[0] === 'vincular').length, 1)
  assert.equal(e.dato().id, 'D')
})
test('offline admite solo la cuenta validada hoy y rechaza el vencimiento; no hay fallback tras revocación', async () => {
  const { e } = await preparar()
  e.offline()
  const recargado = e.nuevo()
  await recargado.restaurar()
  assert.equal((await recargado.continuar()).operador.dni, '12345678')
  e.hora('2026-10-28T05:00:01Z')
  await assert.rejects(recargado.validar(), /venció/)
  const { e: e2, s } = await preparar()
  e2.fallo(
    Object.assign(new Error('Dispositivo no autorizado'), { accesoDenegado: true })
  )
  await assert.rejects(s.validar({ forzar: true }), /no autorizado/)
  assert.equal(e2.dato().autorizacion, null)
  e2.offline()
  await assert.rejects(s.continuar(), /tu DNI/)
})
test('empresa, campaña o actor ajenos no pueden adoptar la sesión ni enviar operaciones', async () => {
  const { e, s } = await preparar()
  await assert.rejects(
    s.autorizarSolicitud({ dni: '87654321', campaniaId: 'C' }),
    /cuenta/
  )
  await assert.rejects(
    s.autorizarSolicitud({ dni: '12345678', campaniaId: 'OTRA' }),
    /campaña/
  )
  e.respuesta({
    ...e.contexto(),
    dispositivo: { id: 'D', tenantId: 'B', estado: 'ACTIVO' }
  })
  await assert.rejects(s.validar({ forzar: true }), /no corresponde/)
  assert.ok(e.bloqueos.length)
})

test('E021: un fallo temporal conserva la sesión vigente sin volver al login', async () => {
  const { e, s } = await preparar()
  e.fallo(new TypeError('Failed to fetch'))
  e.hora('2026-10-27T18:02:00Z')
  assert.equal((await s.validar({ forzar: true })).operador.dni, '12345678')
  assert.equal(e.bloqueos.length, 0)
  assert.equal(e.dato().sesionDni.dni, '12345678')
  await s.autorizarSolicitud({ dni: '12345678', campaniaId: 'C' })
  e.fallo(null)
  assert.equal((await s.validar({ forzar: true })).operador.dni, '12345678')
})

test('E021: ni una autorización vencida ni una respuesta inválida admiten fallback de red', async () => {
  const { e, s } = await preparar()
  e.fallo(new TypeError('Failed to fetch'))
  e.hora('2026-10-28T05:00:01Z')
  await assert.rejects(s.validar({ forzar: true }), /renovar la autorización/)
  assert.equal(e.bloqueos.length, 1)
  const otro = await preparar()
  otro.e.respuesta({
    ...otro.e.contexto(),
    dispositivo: { id: 'D', tenantId: 'OTRA', estado: 'ACTIVO' }
  })
  await assert.rejects(otro.s.validar({ forzar: true }), /no corresponde/)
  assert.equal(otro.e.bloqueos.length, 1)
})

test('E021: el adapter reconoce respuestas de transporte y no publica Failed to fetch', async () => {
  for (const r of [
    { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 },
    { data: null, error: { message: 'Gateway timeout' }, status: 504 }
  ]) {
    const adapter = crearDispositivoSupabase({ rpc: async () => r })
    await assert.rejects(
      adapter.ingresarConDni({ id: 'D', credencial: 'K' }, '12345678'),
      (e) => e.temporal === true && !e.accesoDenegado && !/fetch/i.test(e.message)
    )
  }
  const denegado = crearDispositivoSupabase({
    rpc: async () => ({
      data: null,
      error: { message: 'Failed to fetch' },
      status: 403
    })
  })
  await assert.rejects(
    denegado.ingresarConDni({ id: 'D', credencial: 'K' }, '12345678'),
    (e) => e.accesoDenegado && !e.temporal
  )
})
test('no permite cambiar cuenta mientras haya trabajo pendiente y no borra credenciales', async () => {
  const { e, s } = await preparar()
  e.pendientes()
  await assert.rejects(s.salir(), /pendientes/)
  assert.equal((await s.operador()).dni, '12345678')
  assert.equal(e.dato().id, 'D')
})
test('almacenamiento IndexedDB conserva una sola identidad aun con preparación simultánea y reapertura', async () => {
  const nombre = 'pda-' + crypto.randomUUID()
  const a = crearDispositivoIndexedDB({ nombre }),
    b = crearDispositivoIndexedDB({ nombre })
  const [uno, dos] = await Promise.all([a.preparar(), b.preparar()])
  assert.deepEqual(uno, dos)
  assert.match(uno.credencial, /^[0-9a-f]{64}$/)
  await a.guardar({ ...uno, tenantId: 'A', estado: 'VINCULADO' })
  assert.equal((await b.obtener()).tenantId, 'A')
})
test('adapter usa solo el contrato autorizado y cerrar sesión afecta únicamente este dispositivo', async () => {
  const calls = []
  const adapter = crearDispositivoSupabase(
    {
      rpc: async (...a) => {
        assert.notEqual(a[0], 'pda_preparar_ingreso_dni')
        calls.push(a)
        return { data: { ok: true } }
      },
      auth: {
        signOut: async (args) => {
          calls.push(['salir', args])
          return {}
        }
      }
    },
    {
      rpc: async (...a) => {
        assert.equal(a[0], 'pda_preparar_ingreso_dni')
        calls.push(a)
        return { data: { ok: true } }
      }
    }
  )
  const d = { id: 'D', credencial: 'secreto', actor: 'inyectado', tenantId: 'B' }
  await adapter.vincular(d, token, 'PDA')
  await adapter.validar(d)
  await adapter.ingresarConDni(d, '12345678')
  await adapter.salir()
  assert.deepEqual(calls, [
    [
      'pda_vincular_dispositivo',
      {
        p_dispositivo_id: 'D',
        p_credencial: 'secreto',
        p_token: token,
        p_nombre: 'PDA'
      }
    ],
    ['pda_preparar_ingreso', { p_dispositivo_id: 'D', p_credencial: 'secreto' }],
    [
      'pda_preparar_ingreso_dni',
      { p_dispositivo_id: 'D', p_credencial: 'secreto', p_dni: '12345678' }
    ],
    ['salir', { scope: 'local' }]
  ])
})

test('la protección de casos y sincronización evita envío con otro DNI o campaña y bloqueo durante una escritura', async () => {
  const { e, s } = await preparar(),
    enviados = []
  let terminar
  const casos = protegerCasosDispositivo(
    {
      asignar: async (datos) => {
        enviados.push(datos)
        await new Promise((r) => {
          terminar = r
        })
      }
    },
    s
  )
  const backend = protegerBackendDispositivo(
    { asignar: async (datos) => enviados.push(datos) },
    s
  )
  await assert.rejects(
    backend.asignar({ dniOperador: '87654321', campaniaId: 'C' }),
    /cuenta/
  )
  await assert.rejects(
    casos.asignar({ operador: { dni: '12345678', campania: { id: 'B' } } }),
    /campaña/
  )
  assert.equal(enviados.length, 0)
  const pendiente = casos.asignar({
    operador: { dni: '12345678', campania: { id: 'C' } }
  })
  while (!terminar) await new Promise((r) => setImmediate(r))
  await assert.rejects(s.salir(), /termine la operación/)
  terminar()
  await pendiente
  assert.equal(enviados.length, 1)
  await s.salir()
  assert.equal(e.dato().estado, 'VINCULADO')
})

test('descarta la validación si cambia la cuenta mientras responde el servidor', async () => {
  const { e, s } = await preparar()
  e.respuesta({
    ...e.contexto(),
    contexto: { tenantId: 'A', usuarioId: 'U2', empresa: 'Empresa A' }
  })
  await assert.rejects(s.validar({ forzar: true }), /cuenta cambió/)
  assert.equal(e.dato().autorizacion.sujeto, 'U')
})

test('otro supervisor inicia sesión sin regenerar credenciales ni volver a escanear el QR', async () => {
  const { e, s } = await preparar()
  await s.salir()
  await s.iniciarConDni('87654321')
  await s.continuar()
  assert.equal((await s.operador()).dni, '87654321')
  assert.equal(e.dato().id, 'D')
  assert.equal(e.llamadas.filter((c) => c[0] === 'vincular').length, 1)
})

test('solo DNI inicia la jornada en un equipo vinculado; cuenta inicial y DNI incorrecto no permiten saltarla', async () => {
  const e = escenario(),
    s = e.nuevo()
  await s.restaurar()
  await assert.rejects(s.iniciarConDni('12345678'), /Primero vincula/)
  await s.iniciarSesion({})
  await s.vincular(token, 'PDA')
  await assert.rejects(s.continuar(), /tu DNI/)
  await assert.rejects(s.iniciarConDni('123'), /8 d\u00edgitos/)
  assert.equal(s.haySesionDni(), false)
  await s.iniciarConDni('12345678')
  assert.equal((await s.operador()).dni, '12345678')
})

test('actualizar desde PIN conserva la empresa y credencial y vuelve al ingreso por DNI', async () => {
  const { e, s } = await preparar()
  await s.salir()
  const anterior = e.dato()
  anterior.sesionPin = { token: 'f'.repeat(64), usuarioId: 'U' }
  const recargado = e.nuevo()
  await recargado.restaurar()
  assert.equal(recargado.vista().empresa, 'Empresa A')
  assert.equal(e.dato().credencial, anterior.credencial)
  assert.equal('sesionPin' in e.dato(), false)
  assert.equal(recargado.haySesionDni(), false)
  await recargado.iniciarConDni('12345678')
  assert.equal((await recargado.operador()).dni, '12345678')
})
