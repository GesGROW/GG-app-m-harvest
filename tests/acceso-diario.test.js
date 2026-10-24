import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  fechaOperativa,
  autorizacionOperadorVigente
} from '@gesgrow/core/contexts/identity-access/domain/fechaOperativa.js'
import { validarOperadorConFuentes } from '@gesgrow/core/contexts/identity-access/application/authLogic.js'

const dni = '12345678'
const hoy = () => ({ dni, nombre: 'Jabero', autorizado_para_fecha: fechaOperativa() })
const sinRed = async () => {
  throw new TypeError('Failed to fetch')
}

test('la autorización vence a medianoche de Lima, incluso con fecha UTC diferente', () => {
  const operador = { dni, autorizado_para_fecha: '2026-10-03' }
  assert.equal(fechaOperativa(new Date('2026-10-04T04:59:59Z')), '2026-10-03')
  assert.equal(
    autorizacionOperadorVigente(operador, new Date('2026-10-04T04:59:59Z')),
    true
  )
  assert.equal(
    autorizacionOperadorVigente(operador, new Date('2026-10-04T05:00:00Z')),
    false
  )
})

test('sin conexión rechaza cachés antiguas, futuras o sin fecha autorizada', async () => {
  for (const fecha of [undefined, '2020-01-01', '2099-01-01']) {
    await assert.rejects(
      validarOperadorConFuentes(
        dni,
        sinRed,
        async () => ({ dni, autorizado_para_fecha: fecha }),
        async () => {}
      ),
      /autorización guardada venció/
    )
  }
  const resultado = await validarOperadorConFuentes(
    dni,
    sinRed,
    async () => hoy(),
    async () => {}
  )
  assert.equal(resultado.offline, true)
})

test('guarda la fecha autorizada por el servidor y nunca sustituye un rechazo por caché', async () => {
  let guardado
  const respuesta = hoy()
  await validarOperadorConFuentes(
    dni,
    async () => respuesta,
    async () => null,
    async (o) => {
      guardado = o
    }
  )
  assert.equal(guardado.autorizado_para_fecha, respuesta.autorizado_para_fecha)
  await assert.rejects(
    validarOperadorConFuentes(
      dni,
      async () => {
        throw new Error('No autorizado')
      },
      async () => hoy(),
      async () => {}
    ),
    (error) => error.message === 'No autorizado'
  )
  await assert.rejects(
    validarOperadorConFuentes(
      dni,
      async () => ({ dni }),
      async () => hoy(),
      async () => {}
    ),
    /no corresponde al día/
  )
})

test('una sesión vencida vuelve al login antes de procesar un escaneo', async () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const inicio = main.indexOf('function verificarVigenciaOperador()')
  const fin = main.indexOf('// LOGIN', inicio)
  let enviar
  let procesados = 0
  let retornosLogin = 0
  const formLogin = {}
  const ctx = vm.createContext({
    operador: { dni, autorizado_para_fecha: '2026-10-03' },
    autorizacionOperadorVigente: (o) =>
      autorizacionOperadorVigente(o, new Date('2026-10-04T05:00:00Z')),
    formLogin,
    vistaLogin: {},
    mostrarVista: () => {
      retornosLogin++
    },
    configurarScanner: (_form, _input, callback) => {
      enviar = callback
    }
  })
  vm.runInContext(main.slice(inicio, fin), ctx)
  ctx.configurarEnvioScanner({}, {}, async () => {
    procesados++
  })
  await enviar('12345678')
  assert.equal(procesados, 0)
  assert.equal(retornosLogin, 1)
  ctx.configurarEnvioScanner(formLogin, {}, async () => {
    procesados++
  })
  await enviar('12345678')
  assert.equal(procesados, 1)
})
