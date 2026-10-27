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
  const contexto = () => ({
    dispositivo: { id: 'D', tenantId: 'A', estado: 'ACTIVO', nombre: 'PDA Norte' },
    contexto: { tenantId: 'A', usuarioId: sujeto, empresa: 'Empresa A' },
    operador: {
      dni: sujeto === 'U2' ? '87654321' : '12345678',
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
  await s.continuar()
  return { e, s }
}

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
  await assert.rejects(recargado.continuar(), /Inicia sesión/)
  await recargado.iniciarSesion({})
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
  await recargado.continuar()
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
  await assert.rejects(s.continuar(), /Conéctate/)
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
  const adapter = crearDispositivoSupabase({
    rpc: async (...a) => {
      calls.push(a)
      return { data: { ok: true } }
    },
    auth: {
      signOut: async (args) => {
        calls.push(['salir', args])
        return {}
      }
    }
  })
  const d = { id: 'D', credencial: 'secreto', actor: 'inyectado', tenantId: 'B' }
  await adapter.vincular(d, token, 'PDA')
  await adapter.validar(d)
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
  e.remoto.validar = async () => {
    const r = e.contexto()
    e.sujeto('U2')
    return r
  }
  await assert.rejects(s.validar({ forzar: true }), /cuenta cambió/)
  assert.equal(e.dato().autorizacion.sujeto, 'U')
})

test('otro supervisor inicia sesión sin regenerar credenciales ni volver a escanear el QR', async () => {
  const { e, s } = await preparar()
  await s.salir()
  e.remoto.iniciarSesion = async () => {
    e.sujeto('U2')
  }
  await s.iniciarSesion({})
  await s.continuar()
  assert.equal((await s.operador()).dni, '87654321')
  assert.equal(e.dato().id, 'D')
  assert.equal(e.llamadas.filter((c) => c[0] === 'vincular').length, 1)
})
