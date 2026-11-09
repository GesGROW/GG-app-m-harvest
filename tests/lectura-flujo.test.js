import assert from 'node:assert/strict'
import test from 'node:test'
import { lecturaCampo } from './helpers/lecturaCampo.js'

const sesion = (id = 'S') => ({
  id,
  sesion_id: id,
  dni_jabero: '01748037',
  jabero: 'Ana',
  lote_id: 'L',
  lote_nombre: 'Campo Norte',
  variedad: 'Biloxi',
  estado: 'ACTIVA'
})
const lote = {
  lote_id: 'L',
  nombre: 'Campo Norte',
  variedades: [
    { id: 'V1', nombre: 'Biloxi' },
    { id: 'V2', nombre: 'Ventura' }
  ]
}
function preparar(extra = {}) {
  const llamadas = [],
    eventos = []
  const campo = lecturaCampo({
    obtenerLotes: async () => [lote],
    casosDeUso: {
      iniciarSesionLectura: async (args) => {
        llamadas.push(args)
        return { sesion: sesion(), sincronizar: async () => eventos.push('sync') }
      },
      registrarLecturaJaba: async (args) => {
        llamadas.push(args)
        return {
          ticket: { cosechador: 'Luis', cosechador_dni: '80000001' },
          total: 1,
          totalPersona: 1,
          sincronizar: async () => eventos.push('sync')
        }
      },
      cerrarSesionLectura: async (args) => {
        llamadas.push(args)
        return { sincronizar: async () => eventos.push('sync') }
      }
    },
    actualizarEstadoConexion: async () => eventos.push('conexion'),
    ...extra
  })
  return { ...campo, llamadas, eventos }
}

test('los botones cambian el recipiente de la siguiente lectura y mantienen una sola selección', async () => {
  const v = preparar()
  await v.nodo('recipiente-jarra').emitir('click')
  assert.equal(v.nodo('tipo-recipiente-lectura').value, 'JARRA')
  assert.equal(v.nodo('recipiente-jarra').getAttribute('aria-pressed'), 'true')
  assert.equal(v.nodo('recipiente-jaba').getAttribute('aria-pressed'), 'false')
  await v.nodo('recipiente-jaba').emitir('click')
  assert.equal(v.nodo('tipo-recipiente-lectura').value, 'JABA')
  assert.equal(v.nodo('recipiente-jarra').getAttribute('aria-pressed'), 'false')
  assert.equal(v.nodo('recipiente-jaba').getAttribute('aria-pressed'), 'true')
})

test('abrir carga lotes por nombre y cambiar lote ofrece sus variedades', async () => {
  const v = preparar()
  await v.abrir()
  assert.equal(v.nodo('lote-lectura').disabled, false)
  assert.equal(v.nodo('lote-lectura').children[0].textContent, 'Campo Norte')
  v.nodo('lote-lectura').value = 'L'
  await v.nodo('lote-lectura').emitir('change')
  assert.deepEqual(
    v.nodo('variedad-lectura').children.map((item) => item.textContent),
    ['Seleccione una variedad', 'Biloxi', 'Ventura']
  )
  assert.equal(v.nodo('variedad-lectura').disabled, false)
  assert.equal(v.document.activeElement, v.nodo('lote-lectura'))
})

test('validación de inicio conserva DNI y variedad y muestra la sesión al guardar', async () => {
  const v = preparar()
  await v.abrir()
  await v.enviar('form-iniciar-lectura', '')
  assert.equal(v.mensajes.at(-1), 'Ingresar DNI.')
  await v.enviar('form-iniciar-lectura', '01748037')
  assert.equal(v.mensajes.at(-1), 'Seleccione un lote.')
  v.nodo('lote-lectura').value = 'L'
  await v.enviar('form-iniciar-lectura', '123')
  assert.match(v.mensajes.at(-1), /8 dígitos/)
  v.nodo('variedad-lectura').value = 'V2'
  await v.enviar('form-iniciar-lectura', '01748037')
  assert.equal(v.llamadas.length, 1)
  assert.equal(v.llamadas[0].dni, '01748037')
  assert.equal(v.llamadas[0].variedadId, 'V2')
  assert.equal(v.llamadas[0].operador, v.fuentes.operador)
  assert.equal(v.lectura.obtenerSesion().sesion_id, 'S')
  assert.equal(v.nodo('sesion-lectura-activa').classList.contains('oculto'), false)
  assert.equal(v.document.activeElement, v.nodo('ticket-lectura'))
})

test('continuar normaliza id y regresar desde consultas preserva la sesión de lectura', async () => {
  const v = preparar()
  await v.lectura.continuar({ ...sesion(), sesion_id: undefined })
  assert.equal(v.lectura.obtenerSesion().sesion_id, 'S')
  v.mostrarVista(v.nodo('vista-menu'))
  v.mostrarVista(v.nodo('vista-lectura'))
  await v.lectura.volverALectura()
  assert.equal(v.lectura.obtenerSesion().sesion_id, 'S')
  assert.equal(v.nodo('sesion-lote').textContent, 'Campo Norte')
  assert.equal(v.document.activeElement, v.nodo('ticket-lectura'))
})

test('un ticket vacío o sin sesión no registra una jaba', async () => {
  const v = preparar()
  await v.enviar('form-lectura-ticket', 'T-1')
  await v.lectura.continuar(sesion())
  await v.enviar('form-lectura-ticket', '')
  assert.equal(v.llamadas.length, 0)
})

test('la lectura libera antes de sincronizar y deja listo el siguiente escaneo', async () => {
  let completar
  const eventos = []
  const v = preparar({
    casosDeUso: {
      registrarLecturaJaba: async () => ({
        ticket: { cosechador: 'Luis' },
        total: 2,
        totalPersona: 2,
        sincronizar: () => {
          eventos.push('sync')
          return new Promise((resolve) => {
            completar = resolve
          })
        }
      })
    }
  })
  await v.lectura.continuar(sesion())
  const pendiente = v.enviar('form-lectura-ticket', '00001234', () =>
    eventos.push('liberar')
  )
  await new Promise(setImmediate)
  assert.deepEqual(eventos, ['liberar', 'sync'])
  assert.equal(v.nodo('ticket-lectura').disabled, false)
  assert.equal(v.nodo('ticket-lectura').value, '')
  assert.equal(v.nodo('total-sesion').textContent, 2)
  assert.equal(v.nodo('total-cosechador').textContent, '2 jabas')
  completar(false)
  await pendiente
})

for (const tipo of ['inicio', 'ticket']) {
  test(`${tipo}: limpiar durante el guardado evita presentación tardía y mantiene la sincronización`, async () => {
    let completar,
      sincronizaciones = 0
    const guardar = () =>
      new Promise((resolve) => {
        completar = resolve
      })
    const v = preparar({
      casosDeUso: { iniciarSesionLectura: guardar, registrarLecturaJaba: guardar }
    })
    if (tipo === 'inicio') {
      await v.abrir()
      v.nodo('lote-lectura').value = 'L'
    } else await v.lectura.continuar(sesion())
    const pendiente = v.enviar(
      tipo === 'inicio' ? 'form-iniciar-lectura' : 'form-lectura-ticket',
      tipo === 'inicio' ? '01748037' : 'T-1'
    )
    await new Promise(setImmediate)
    v.lectura.limpiar()
    completar({
      sesion: sesion(),
      ticket: { cosechador: 'Luis' },
      total: 1,
      totalPersona: 1,
      sincronizar: async () => {
        sincronizaciones++
      }
    })
    await pendiente
    assert.equal(v.lectura.obtenerSesion(), null)
    assert.equal(v.nodo('total-sesion').textContent, '0')
    assert.equal(v.nodo('sesion-lectura-activa').classList.contains('oculto'), true)
    assert.equal(sincronizaciones, 1)
  })
}

test('un render tardío de una sesión abandonada no cambia sus contadores ni el foco', async () => {
  let completar
  const v = preparar({
    contarLecturasSesion: () =>
      new Promise((resolve) => {
        completar = resolve
      })
  })
  const pendiente = v.lectura.continuar(sesion())
  v.lectura.limpiar()
  v.mostrarVista(v.nodo('vista-menu'))
  v.nodo('btn-menu-jaberos').focus()
  completar(99)
  await pendiente
  assert.equal(v.nodo('total-sesion').textContent, '0')
  assert.equal(v.document.activeElement, v.nodo('btn-menu-jaberos'))
})

test('continuar otra sesión durante un guardado habilita su escáner y conserva su estado', async () => {
  let completar
  let sincronizaciones = 0
  const v = preparar({
    casosDeUso: {
      registrarLecturaJaba: () =>
        new Promise((resolve) => {
          completar = resolve
        })
    }
  })
  await v.lectura.continuar(sesion('A'))
  const pendiente = v.enviar('form-lectura-ticket', 'T-1')
  await new Promise(setImmediate)
  assert.equal(v.nodo('ticket-lectura').disabled, true)
  await v.lectura.continuar(sesion('B'))
  assert.equal(v.nodo('ticket-lectura').disabled, false)
  completar({
    ticket: { cosechador: 'Anterior' },
    total: 99,
    totalPersona: 99,
    sincronizar: async () => {
      sincronizaciones++
    }
  })
  await pendiente
  assert.equal(v.lectura.obtenerSesion().sesion_id, 'B')
  assert.equal(v.nodo('total-sesion').textContent, 0)
  assert.equal(sincronizaciones, 1)
})

test('una confirmación pendiente de otra sesión no cierra la nueva', async () => {
  const v = preparar()
  await v.lectura.continuar(sesion('A'))
  const pendiente = v.nodo('btn-finalizar-lectura').emitir('click')
  await v.lectura.continuar(sesion('B'))
  await v.nodo('confirmacion-lectura').close('confirmar')
  await pendiente
  assert.equal(v.llamadas.length, 0)
  assert.equal(v.lectura.obtenerSesion().sesion_id, 'B')
})

test('un fallo al cerrar conserva la sesión y permite reintentar', async () => {
  const v = preparar({
    casosDeUso: {
      cerrarSesionLectura: async () => {
        throw new Error('No se pudo cerrar')
      }
    }
  })
  await v.lectura.continuar(sesion())
  const pendiente = v.nodo('btn-finalizar-lectura').emitir('click')
  await v.nodo('confirmacion-lectura').close('confirmar')
  await pendiente
  assert.equal(v.lectura.obtenerSesion().sesion_id, 'S')
  assert.equal(v.mensajes.at(-1), 'No se pudo cerrar')
})

test('restaurables ignora una carga que termina después de cambiar de operador', async () => {
  let completar
  const v = preparar({
    obtenerSesionesActivas: () =>
      new Promise((resolve) => {
        completar = resolve
      })
  })
  const pendiente = v.lectura.mostrarSesionesActivas()
  v.fuentes.operador = { dni: '80000002', campania: { id: 'B' } }
  v.lectura.limpiar()
  completar([sesion()])
  await pendiente
  assert.equal(v.nodo('sesiones-restaurables').children.length, 0)
})
