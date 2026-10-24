import {
  TENANT_INICIAL_ID,
  exigirMismoTenant,
  tenantDeRecurso
} from '@gesgrow/core/contexts/platform/index.js'

// Migración de contenido, sin upgrade ni cambio de claves/stores de IndexedDB v5.
// La cola y sus payloads/UUID conservan su intención anterior.
export async function migrarOwnershipLocal(db) {
  const tx = db.transaction([...db.objectStoreNames], 'readwrite')
  try {
    const meta = tx.objectStore('meta')
    if (await meta.get('platform:ownership:v1')) {
      await tx.done
      return db
    }
    for (const nombre of db.objectStoreNames) {
      const store = tx.objectStore(nombre)
      const keys = await store.getAllKeys()
      for (const key of keys) {
        const fila = await store.get(key)
        if (!fila || typeof fila !== 'object' || Array.isArray(fila)) continue
        if (
          nombre === 'meta' &&
          !/^(campania:|harvest:|campania_activa$)/.test(String(key))
        )
          continue
        const nueva = { ...fila, tenant_id: tenantDeRecurso(fila) }
        if (nombre === 'meta') await store.put(nueva, key)
        else await store.put(nueva)
      }
    }
    await meta.put({ tenantId: TENANT_INICIAL_ID, version: 1 }, 'platform:ownership:v1')
    await tx.done
    return db
  } catch (error) {
    try {
      tx.abort()
    } catch {
      /* La transacción puede haber abortado antes. */
    }
    await tx.done.catch(() => {})
    throw error
  }
}

export function validarOwnershipCache(cache) {
  const tenantId = tenantDeRecurso(cache.campania)
  for (const fila of [...cache.trabajadores, ...cache.lotes, ...cache.tickets]) {
    if (fila.tenantId !== undefined || fila.tenant_id !== undefined)
      exigirMismoTenant({ tenantId }, fila)
  }
  if (cache.harvest) exigirMismoTenant({ tenantId }, cache.harvest)
  return tenantId
}
