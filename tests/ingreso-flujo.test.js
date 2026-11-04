import assert from 'node:assert/strict'
import test from 'node:test'
import { ingresoCampo } from './helpers/ingresoCampo.js'

const turno = () => new Promise((resolve) => setImmediate(resolve))
const A = { id: 'A', nombre: 'Campaña A', cultivo_nombre: 'Arándano' }
const B = { id: 'B', nombre: 'Campaña B', cultivo_nombre: 'Mandarina' }

test('un DNI inválido no consulta identidad y selecciona el campo', async () => {
  let llamadas = 0
  const campo = ingresoCampo({ validarOperador: async () => llamadas++ })
  await campo.enviar('1234567')
  assert.equal(llamadas, 0)
  assert.match(campo.nodo('login-mensaje').textContent, /8 dígitos/)
  assert.equal(campo.nodo('dni-operador').seleccionado, true)
})

test('un rechazo de identidad se muestra y permite volver a ingresar', async () => {
  const campo = ingresoCampo()
  campo.fuentes.validarOperador = async () => {
    throw new Error('Sin asignación')
  }
  await campo.enviar()
  assert.equal(campo.ingreso.obtenerOperador(), null)
  assert.equal(campo.nodo('login-mensaje').textContent, 'Sin asignación')
  campo.fuentes.validarOperador = async () => campo.fuentes.operador
  await campo.enviar()
  assert.equal(campo.nodo('login-mensaje').textContent, '')
  assert.deepEqual(campo.menus, ['A'])
  assert.equal(campo.limpiezas(), 1)
  assert.equal(campo.teclados.length, 1)
})

test('sin acceso guardado no consulta identidad al arrancar', async () => {
  let llamadas = 0
  const campo = ingresoCampo({ validarOperador: async () => llamadas++ })
  await campo.ingreso.restaurar()
  assert.equal(llamadas, 0)
})

test('restaurar un acceso rechazado elimina el DNI y el operador', async () => {
  const campo = ingresoCampo({
    validarOperador: async () => {
      throw new Error('Revocado')
    }
  })
  await campo.restaurar('A')
  assert.equal(campo.storage.has('operador_dni'), false)
  assert.equal(campo.ingreso.obtenerOperador(), null)
  assert.deepEqual(campo.menus, [])
})

test('salir limpia las vistas y la selección local antes de volver al DNI', async () => {
  const campo = ingresoCampo()
  await campo.enviar()
  campo.nodo('dni-operador').value = '47480378'
  await campo.nodo('btn-salir-menu').emitir('click')
  assert.equal(campo.ingreso.obtenerOperador(), null)
  assert.equal(campo.storage.size, 0)
  assert.equal(campo.limpiezas(), 2)
  assert.deepEqual(campo.consultas.slice(-2), [
    ['seleccion', ''],
    ['vista', 'vista-login']
  ])
  assert.equal(campo.nodo('dni-operador').value, '')
  assert.equal(campo.document.activeElement, campo.nodo('dni-operador'))
})

test('un rechazo al salir del dispositivo conserva el acceso y avisa', async () => {
  const campo = ingresoCampo({
    cerrarSesionDispositivo: async () => {
      throw new Error('Hay pendientes')
    }
  })
  await campo.enviar()
  const operador = campo.ingreso.obtenerOperador()
  await campo.nodo('btn-salir-menu').emitir('click')
  assert.equal(campo.ingreso.obtenerOperador(), operador)
  assert.equal(campo.storage.get('campania_id'), 'A')
  assert.equal(campo.limpiezas(), 1)
  assert.deepEqual(campo.avisos, ['Hay pendientes'])
})

for (const restauracion of [false, true]) {
  test(`salir descarta la validación tardía de ${restauracion ? 'restauración' : 'login'}`, async () => {
    let completar
    const campo = ingresoCampo({
      validarOperador: () =>
        new Promise((resolve) => {
          completar = resolve
        })
    })
    const pendiente = restauracion ? campo.restaurar('A') : campo.enviar()
    await campo.nodo('btn-cancelar-cultivo').emitir('click')
    completar(campo.fuentes.operador)
    await pendiente
    assert.equal(campo.ingreso.obtenerOperador(), null)
    assert.equal(campo.storage.size, 0)
    assert.deepEqual(campo.menus, [])
  })
}

test('un login más reciente gana frente a una restauración pendiente', async () => {
  let completar
  const campo = ingresoCampo()
  campo.fuentes.validarOperador = () =>
    new Promise((resolve) => {
      completar = resolve
    })
  const pendiente = campo.restaurar('A')
  campo.fuentes.validarOperador = async (dni) => ({ dni, campanias: [B] })
  await campo.enviar('01748037')
  completar(campo.fuentes.operador)
  await pendiente
  assert.equal(campo.ingreso.obtenerOperador().dni, '01748037')
  assert.equal(campo.storage.get('campania_id'), 'B')
  assert.deepEqual(campo.menus, ['B'])
})

test('mientras carga una campaña no inicia otra con doble pulsación', async () => {
  let completar,
    cargas = 0
  const campo = ingresoCampo({
    operador: { dni: '47480378', campanias: [A, B] },
    actualizarCacheOperativa: () => {
      cargas++
      return new Promise((resolve) => {
        completar = resolve
      })
    }
  })
  await campo.enviar()
  const [a, b] = campo.nodo('opciones-cultivo').children
  const pendiente = a.emitir('click')
  await turno()
  await b.emitir('click')
  assert.equal(cargas, 1)
  assert.equal(b.disabled, true)
  completar()
  await pendiente
  assert.deepEqual(campo.menus, ['A'])
})

test('una respuesta fallida después de cancelar no repinta el selector', async () => {
  let rechazar
  const campo = ingresoCampo({
    operador: { dni: '47480378', campanias: [A, B] },
    actualizarCacheOperativa: () =>
      new Promise((_resolve, reject) => {
        rechazar = reject
      })
  })
  await campo.enviar()
  const pendiente = campo.nodo('opciones-cultivo').children[0].emitir('click')
  await turno()
  await campo.nodo('btn-cancelar-cultivo').emitir('click')
  rechazar(new Error('Fallo tardío'))
  await pendiente
  assert.equal(campo.nodo('cultivo-mensaje').textContent, '')
  assert.equal(campo.nodo('opciones-cultivo').children.length, 0)
  assert.deepEqual(campo.menus, [])
  assert.equal(campo.errores.length, 1)
})

test('vencer la autorización limpia flujos, invalida el acceso y redirige', async () => {
  let vigente = true
  const campo = ingresoCampo({}, { esAutorizacionVigente: () => vigente })
  await campo.enviar()
  vigente = false
  const destino = campo.ingreso.autorizarVista(campo.nodo('vista-asignacion'))
  assert.equal(destino, campo.nodo('vista-login'))
  assert.equal(campo.ingreso.obtenerOperador(), null)
  assert.equal(campo.storage.has('operador_dni'), false)
  assert.equal(campo.limpiezas(), 2)
  assert.match(campo.nodo('login-mensaje').textContent, /autorización venció/)
  assert.equal(campo.ingreso.verificarVigenciaOperador(), false)
})
