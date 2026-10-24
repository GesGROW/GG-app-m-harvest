import assert from 'node:assert/strict'
import test from 'node:test'
import {
  crearRegistroScanner,
  describirValorScanner
} from '../src/modules/diagnosticoScanner.js'

test('distingue un CR real de los caracteres literales barra y r', () => {
  const real = describirValorScanner('17480378\r')
  const literal = describirValorScanner('17480378\\r')
  assert.equal(real.dniValido, true)
  assert.equal(real.caracteresTrasTrim, 8)
  assert.deepEqual(real.extras, [{ caracter: '\r', codigo: 'U+000D' }])
  assert.equal(literal.dniValido, false)
  assert.equal(literal.caracteresTrasTrim, 10)
  assert.deepEqual(literal.extras, [
    { caracter: '\\', codigo: 'U+005C' },
    { caracter: 'r', codigo: 'U+0072' }
  ])
})

test('identifica caracteres invisibles sin eliminarlos ni aceptar el DNI', () => {
  const datos = describirValorScanner('01748037\u200B')
  assert.equal(datos.digitos, 8)
  assert.equal(datos.caracteresTrasTrim, 9)
  assert.equal(datos.dniValido, false)
  assert.equal(datos.extras[0].codigo, 'U+200B')
})

test('registra la escritura tardía después de validar un DNI incompleto', () => {
  let tiempo = 0
  const registro = crearRegistroScanner('dni-cosechador', () => tiempo)
  registro.registrar('keydown', '1748037', { key: 'Enter', keyCode: 13 })
  tiempo = 40
  registro.registrar('procesar', '1748037')
  tiempo = 110
  registro.registrar('input', '17480378', { data: '8', inputType: 'insertText' })
  const datos = registro.obtener()
  assert.equal(datos.ultimaValidacion.valor.digitos, 7)
  assert.equal(datos.eventos.at(-1).valor.digitos, 8)
  assert.equal(datos.eventos.at(-1).ms, 110)
})

test('no conserva el DNI en value, data, key, code ni keyCode', () => {
  const registro = crearRegistroScanner('dni-cosechador')
  registro.registrar('keydown', '17480378', {
    key: '8',
    code: 'Digit8',
    keyCode: 56
  })
  registro.registrar('input', '17480378', { data: '17480378' })
  registro.registrar('procesar', '17480378')
  const datos = registro.obtener()
  assert.equal(datos.eventos[0].key, '#')
  assert.equal(datos.eventos[0].code, 'Digit#')
  assert.equal(datos.eventos[0].keyCode, 'omitido')
  assert.equal(datos.eventos[1].data, '########')
  assert.equal(datos.ultimaValidacion.valor.muestra, '########')
  assert.doesNotMatch(JSON.stringify(datos), /17480378/)
})

test('mantiene la última validación aunque rote el historial y puede limpiarse', () => {
  const registro = crearRegistroScanner('dni-cosechador')
  registro.registrar('procesar', '01748037')
  for (let i = 0; i < 100; i++) registro.registrar('input', '1')
  assert.equal(registro.obtener().eventos.length, 80)
  assert.equal(registro.obtener().ultimaValidacion.valor.dniValido, true)
  registro.limpiar()
  assert.deepEqual(registro.obtener().eventos, [])
  assert.equal(registro.obtener().ultimaValidacion, null)
})
