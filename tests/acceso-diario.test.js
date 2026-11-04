import assert from 'node:assert/strict'
import test from 'node:test'
import { ingresoCampo } from './helpers/ingresoCampo.js'
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
  const campo = ingresoCampo(
    {
      operador: { dni, campanias: [{ id: 'A' }], autorizado_para_fecha: '2026-10-03' }
    },
    {
      esAutorizacionVigente: (o) =>
        autorizacionOperadorVigente(o, new Date('2026-10-04T05:00:00Z'))
    }
  )
  await campo.restaurar('A')
  let procesados = 0
  const form = {}
  campo.ingreso.configurarEnvioScanner(form, {}, async () => procesados++)
  await campo.envios.get(form)('12345678')
  assert.equal(procesados, 0)
  assert.equal(campo.ingreso.obtenerOperador(), null)
  assert.equal(campo.consultas.at(-1)[1], 'vista-login')
  const formLogin = campo.nodo('form-login')
  campo.ingreso.configurarEnvioScanner(formLogin, {}, async () => procesados++)
  await campo.envios.get(formLogin)('12345678')
  assert.equal(procesados, 1)
})
