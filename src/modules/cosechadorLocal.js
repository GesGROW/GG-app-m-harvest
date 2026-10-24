import { casosDeUso } from '../application/casosDeUso.js'
export { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'

export async function buscarCosechadorLocal(dni, opciones) {
  return casosDeUso.buscarCosechadorLocal(dni, opciones)
}
