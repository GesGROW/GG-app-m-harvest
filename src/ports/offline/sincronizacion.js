/**
 * Ejecuta la sincronización existente; conserva orden, reintentos, bloqueo por
 * campaña y procesamiento entre campañas. No conoce el proveedor remoto.
 * @typedef {Object} PuertoSincronizacion
 * @property {() => Promise<void>} sincronizar
 */
export const operacionesSincronizacion = Object.freeze(['sincronizar'])
