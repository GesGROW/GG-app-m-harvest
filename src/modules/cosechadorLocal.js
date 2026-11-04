import { casosDeUso } from '../application/casosDeUso.js'

export async function buscarCosechadorLocal(dni, opciones) {
  return casosDeUso.buscarCosechadorLocal(dni, opciones)
}
