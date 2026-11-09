import assert from 'node:assert/strict'
import test from 'node:test'
import { resumirRecipientes } from '../src/application/resumenRecipientes.js'

test('suma pesos sin errores decimales y conserva las lecturas históricas sin peso', () => {
  const lecturas = [
    ...Array.from({ length: 10 }, () => ({ tipoRecipiente: 'JARRA', pesoKg: 1.3 })),
    ...Array.from({ length: 5 }, () => ({ tipoRecipiente: 'JABA', pesoKg: 2.4 })),
    {}
  ]
  assert.deepEqual(resumirRecipientes(lecturas), {
    jarras: 10,
    jabas: 6,
    kg: 25,
    sinPeso: 1
  })
})
