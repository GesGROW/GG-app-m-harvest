import { buscarCosechadorLocal } from './cosechadorLocal.js'
export { asignarTicket } from '@gesgrow/core/contexts/harvest/index.js'

export async function buscarCosechador(dni) {
  return buscarCosechadorLocal(dni, { permitirProvisional: true })
}
