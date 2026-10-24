/**
 * @typedef {import('@gesgrow/core/contexts/harvest/index.js').PuertoCosecha & {
 * obtenerTrabajador: (dni: string) => Promise<Object|undefined>,
 * registrarJabero: (dniOperador: string, dni: string) => Promise<Object>
 * }} PuertoCosecha
 */
import { operacionesCosecha as operacionesHarvest } from '@gesgrow/core/contexts/harvest/index.js'

// Contrato compuesto de compatibilidad con los adapters de Fase 3. Workforce
// es propietario de los dos métodos laborales; Application proyecta cada puerto
// del contexto conservando las transacciones y firmas existentes.
export const operacionesCosecha = Object.freeze([
  'obtenerTrabajador',
  ...operacionesHarvest,
  'registrarJabero'
])
