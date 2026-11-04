import assert from 'node:assert/strict'
import test from 'node:test'
import { formulariosCampo } from './helpers/formulariosCampo.js'

function preparar(extra = {}) {
  const asignaciones = [],
    registros = [],
    eventos = []
  const vista = formulariosCampo({
    operador: { dni: '47480378', nombre: 'Operador de campo', campania: { id: 'A' } },
    buscarCosechador: async (dni) => ({
      dni,
      nombre: 'Ana Pérez',
      campania: 'Campaña A'
    }),
    casosDeUso: {
      asignarTicket: async (datos) => {
        asignaciones.push(datos)
        return {
          operacion: { id: 'OP' },
          sincronizar: async () => {
            eventos.push('sincronizar')
            return false
          }
        }
      },
      registrarJabero: async (datos) => {
        registros.push(datos)
        return {
          trabajador: { nombre: 'Luis Díaz' },
          sincronizar: async () => eventos.push('sincronizar')
        }
      }
    },
    actualizarEstadoConexion: async () => eventos.push('conexion'),
    ...extra
  })
  return { ...vista, asignaciones, registros, eventos }
}

async function seleccionar(v) {
  await v.abrirAsignacion()
  await v.enviar('form-cosechador', '01748037')
}

test('asignación muestra operador/cosechador, habilita ticket y vuelve limpia al menú', async () => {
  const v = preparar()
  await seleccionar(v)
  assert.equal(v.nodo('nombre-operador').textContent, 'Operador de campo')
  assert.equal(v.nodo('nombre-cosechador').textContent, 'Ana Pérez')
  assert.equal(v.nodo('campania-cosechador').textContent, 'Campaña A')
  assert.equal(v.nodo('codigo-ticket').disabled, false)
  assert.equal(v.document.activeElement, v.nodo('codigo-ticket'))
  await v.nodo('btn-volver-menu').emitir('click')
  assert.equal(v.nodo('codigo-ticket').disabled, true)
  assert.equal(v.nodo('info-cosechador').classList.contains('oculto'), true)
  assert.equal(v.cambios.at(-1), v.nodo('vista-menu'))
})

test('ticket vacío o sin cosechador no envía una asignación', async () => {
  const v = preparar()
  await v.abrirAsignacion()
  await v.enviar('form-ticket', 'T-1')
  await v.enviar('form-cosechador', '01748037')
  await v.enviar('form-ticket', '')
  assert.equal(v.asignaciones.length, 0)
  assert.equal(v.nodo('resultado').textContent, 'Escanee un ticket.')
  assert.equal(v.document.activeElement, v.nodo('codigo-ticket'))
})

test('asignación entrega el DNI como string y libera antes de sincronizar', async () => {
  const v = preparar()
  await seleccionar(v)
  await v.enviar('form-ticket', '00012345', () => v.eventos.push('liberar'))
  assert.equal(v.asignaciones.length, 1)
  assert.equal(v.asignaciones[0].cosechador.dni, '01748037')
  assert.equal(v.asignaciones[0].codigoTicket, '00012345')
  assert.equal(v.asignaciones[0].operador, v.fuentes.operador)
  assert.deepEqual(v.eventos, ['liberar', 'conexion', 'sincronizar'])
  assert.equal([...v.timers.values()][0].ms, 1200)
  v.ejecutarTemporizador()
  assert.equal(v.nodo('codigo-ticket').disabled, true)
  assert.equal(v.document.activeElement, v.nodo('dni-cosechador'))
})

test('un error al guardar permite corregir el ticket y no programa otro cosechador', async () => {
  const v = preparar({
    casosDeUso: {
      asignarTicket: async () => {
        throw new Error('Error de almacenamiento')
      }
    }
  })
  await seleccionar(v)
  await v.enviar('form-ticket', 'T-1')
  assert.equal(v.nodo('resultado').textContent, 'Error de almacenamiento')
  assert.equal(v.nodo('codigo-ticket').disabled, false)
  assert.equal(v.timers.size, 0)
})

test('un rechazo del recibo de sincronización se muestra con su error', async () => {
  const v = preparar({
    casosDeUso: {
      asignarTicket: async () => ({
        operacion: { id: 'OP' },
        sincronizar: async () => true
      })
    },
    obtenerColaCompleta: async () => [
      { id: 'OP', estado: 'ERROR', error: 'Lote ya asignado' }
    ]
  })
  await seleccionar(v)
  await v.enviar('form-ticket', 'T-1')
  assert.equal(v.nodo('resultado').textContent, 'Lote ya asignado')
  assert.equal(v.nodo('resultado').classList.contains('error'), true)
})

test('el temporizador en segundo plano no roba foco ni desactiva teclados de otra vista', async () => {
  const v = preparar()
  await seleccionar(v)
  await v.enviar('form-ticket', 'T-1')
  v.mostrarVista(v.nodo('vista-menu'))
  const otro = v.nodo('btn-menu-jaberos')
  otro.focus()
  const inicio = v.teclados.length
  v.ejecutarTemporizador()
  assert.equal(v.document.activeElement, otro)
  for (const inputs of v.teclados.slice(inicio)) {
    assert.ok(
      inputs.length > 0,
      'El temporizador no debe desactivar todos los teclados'
    )
    for (const input of inputs)
      assert.ok([v.nodo('dni-cosechador'), v.nodo('codigo-ticket')].includes(input))
  }
})

test('volver al menú cancela el temporizador y una selección nueva no conserva el anterior', async () => {
  const v = preparar()
  await seleccionar(v)
  await v.enviar('form-ticket', 'T-1')
  await v.enviar('form-cosechador', '80000001')
  assert.equal(v.timers.size, 0)
  assert.equal(v.nodo('codigo-ticket').disabled, false)
  await v.enviar('form-ticket', 'T-2')
  assert.equal(v.timers.size, 1)
  await v.nodo('btn-volver-menu').emitir('click')
  assert.equal(v.timers.size, 0)
})

test('una búsqueda tardía después de limpiar no habilita tickets ni roba foco', async () => {
  let completar
  const v = preparar({
    buscarCosechador: () =>
      new Promise((resolve) => {
        completar = resolve
      })
  })
  await v.abrirAsignacion()
  const pendiente = v.enviar('form-cosechador', '01748037')
  await v.nodo('btn-volver-menu').emitir('click')
  const foco = v.document.activeElement
  completar({ dni: '01748037', nombre: 'Ana' })
  await pendiente
  assert.equal(v.nodo('codigo-ticket').disabled, true)
  assert.equal(v.nodo('info-cosechador').classList.contains('oculto'), true)
  assert.equal(v.document.activeElement, foco)
})

for (const formulario of ['ticket', 'jabero']) {
  test(`${formulario}: limpiar durante el guardado conserva la sincronización sin volver a pintar`, async () => {
    let completar
    let sincronizaciones = 0,
      liberaciones = 0
    const caso = () =>
      new Promise((resolve) => {
        completar = resolve
      })
    const v = preparar({ casosDeUso: { asignarTicket: caso, registrarJabero: caso } })
    if (formulario === 'ticket') await seleccionar(v)
    else await v.abrirJaberos()
    const pendiente = v.enviar(
      `form-${formulario}`,
      formulario === 'ticket' ? 'T-1' : '01748037',
      () => liberaciones++
    )
    if (formulario === 'ticket') v.asignacion.limpiar()
    else v.jaberos.limpiar()
    completar({
      trabajador: { nombre: 'Ana' },
      sincronizar: async () => {
        sincronizaciones++
        return false
      }
    })
    await pendiente
    assert.equal(sincronizaciones, 1)
    assert.equal(liberaciones, 1)
    assert.equal(
      v.nodo(formulario === 'ticket' ? 'resultado' : 'resultado-jabero').textContent,
      ''
    )
    assert.equal(v.timers.size, 0)
  })
}

test('jaberos abre con el operador, valida DNI y deja el formulario listo tras registrar', async () => {
  const v = preparar()
  await v.abrirJaberos()
  assert.equal(v.nodo('jaberos-operador').textContent, 'Operador de campo')
  await v.enviar('form-jabero', '123')
  assert.equal(v.registros.length, 0)
  assert.match(v.nodo('resultado-jabero').textContent, /8 dígitos/)
  await v.enviar('form-jabero', '01748037', () => v.eventos.push('liberar'))
  assert.equal(v.registros[0].dni, '01748037')
  assert.equal(
    v.nodo('resultado-jabero').textContent,
    'Luis Díaz registrado como jabero'
  )
  assert.equal(v.nodo('dni-jabero').value, '')
  assert.equal(v.document.activeElement, v.nodo('dni-jabero'))
  assert.deepEqual(v.eventos, ['liberar', 'sincronizar', 'conexion'])
  await v.nodo('btn-volver-menu-jaberos').emitir('click')
  assert.equal(v.nodo('resultado-jabero').textContent, '')
  assert.equal(v.cambios.at(-1), v.nodo('vista-menu'))
})

test('un rechazo de registro muestra el error y deja reintentar con el mismo DNI', async () => {
  let intentos = 0
  const v = preparar({
    casosDeUso: {
      registrarJabero: async () => {
        intentos++
        throw new Error('Campaña cerrada')
      }
    }
  })
  await v.abrirJaberos()
  v.nodo('dni-jabero').value = '01748037'
  for (let i = 0; i < 2; i++) await v.enviar('form-jabero', '01748037')
  assert.equal(intentos, 2)
  assert.equal(v.nodo('dni-jabero').value, '01748037')
  assert.equal(v.nodo('resultado-jabero').textContent, 'Campaña cerrada')
})
