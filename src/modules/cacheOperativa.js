import { backend } from '@gesgrow/core/backend/backend.js'
import { guardarCache } from '../offline/db.js'

export async function actualizarCacheOperativa(dniOperador, campaniaId) {
  const data = await backend.obtenerCacheOperativa(dniOperador, campaniaId)
  await guardarCache(data)
  return data
}
