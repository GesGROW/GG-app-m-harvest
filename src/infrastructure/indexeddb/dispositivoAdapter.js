import { openDB } from 'idb'

// Separado de la cola agrícola: nunca se reinicia scc al vincular o salir.
export function crearDispositivoIndexedDB({
  nombre = 'gesgrow-pda',
  generar = () => ({
    id: crypto.randomUUID(),
    credencial: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
  })
} = {}) {
  const db = openDB(nombre, 1, {
    upgrade(db) {
      db.createObjectStore('instalacion')
    }
  })
  return Object.freeze({
    obtener: async () => (await db).get('instalacion', 'actual'),
    async preparar() {
      const conexion = await db
      const tx = conexion.transaction('instalacion', 'readwrite')
      let dato = await tx.store.get('actual')
      if (!dato) {
        dato = { ...generar(), estado: 'PENDIENTE' }
        await tx.store.put(dato, 'actual')
      }
      await tx.done
      return dato
    },
    guardar: async (dato) => (await db).put('instalacion', dato, 'actual')
  })
}
