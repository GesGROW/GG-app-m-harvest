import assert from 'node:assert/strict'
import test from 'node:test'
import { resumirRecipientes, describirRecipientes } from '../src/application/resumenRecipientes.js'

test('separa los conteos y kilos con barras verticales', () => {
  assert.equal(describirRecipientes({jabas:5,jarras:10,kg:25,sinPeso:0}), '5 jabas | 10 jarras | 25 kg estimados')
})

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
