import * as db from '../../offline/db.js'
import { sincronizarPendientes } from '../../offline/sync.js'
import { crearOperadoresIndexedDB } from '../indexeddb/operadoresAdapter.js'
import { crearCampaniasIndexedDB } from '../indexeddb/campaniasAdapter.js'
import { crearCosechaIndexedDB } from '../indexeddb/cosechaAdapter.js'
import { crearColaIndexedDB } from '../indexeddb/colaAdapter.js'
import { crearSincronizacionAdapter } from './sincronizacionAdapter.js'
import { crearHarvestIndexedDB } from '../indexeddb/harvestAdapter.js'

export function crearAdaptadoresOffline({ legacy = false } = {}) {
  return Object.freeze({
    operadores: crearOperadoresIndexedDB(db),
    campanias: crearCampaniasIndexedDB(db),
    cosecha: crearCosechaIndexedDB(db),
    cola: crearColaIndexedDB(db),
    sincronizacion: crearSincronizacionAdapter(sincronizarPendientes),
    ...(!legacy ? { harvest: crearHarvestIndexedDB(db) } : {})
  })
}
