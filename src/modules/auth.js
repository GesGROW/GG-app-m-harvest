import { casosDeUso } from '../application/casosDeUso.js'

export async function validarOperador(dni) {
  return casosDeUso.validarOperador(dni)
}
