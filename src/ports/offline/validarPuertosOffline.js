import { operacionesOperadores } from './operadores.js'
import { operacionesCampanias } from './campanias.js'
import { operacionesCosecha } from './cosecha.js'
import { operacionesCola } from './cola.js'
import { operacionesSincronizacion } from './sincronizacion.js'
import { operacionesHarvestLocal } from '@gesgrow/core/contexts/harvest/index.js'

/**
 * @typedef {Object} PuertosOffline
 * @property {import('./operadores.js').PuertoOperadores} operadores
 * @property {import('./campanias.js').PuertoCampanias} campanias
 * @property {import('./cosecha.js').PuertoCosecha} cosecha
 * @property {import('./cola.js').PuertoCola} cola
 * @property {import('./sincronizacion.js').PuertoSincronizacion} sincronizacion
 */
export function validarPuertosOffline(offline) {
  if (offline?.harvest)
    for (const operacion of operacionesHarvestLocal) {
      if (typeof offline.harvest[operacion] !== 'function')
        throw new Error(`Falta la operación offline: harvest.${operacion}`)
    }
  for (const [puerto, operaciones] of Object.entries({
    operadores: operacionesOperadores,
    campanias: operacionesCampanias,
    cosecha: operacionesCosecha,
    cola: operacionesCola,
    sincronizacion: operacionesSincronizacion
  })) {
    for (const operacion of operaciones) {
      if (typeof offline?.[puerto]?.[operacion] !== 'function')
        throw new Error(`Falta la operación offline: ${puerto}.${operacion}`)
    }
  }
}
