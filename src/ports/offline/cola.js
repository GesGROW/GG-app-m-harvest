/**
 * Consulta/administración del trabajo pendiente. Los casos de uso consultan
 * predicados, sin conocer tipos de comandos, payloads ni estados persistidos.
 * No permite agregar comandos separados de una escritura operacional.
 * @typedef {Object} PuertoCola
 * @property {(codigo: string) => Promise<boolean>} existeTicketPendiente
 * @property {(sesionId: string) => Promise<boolean>} inicioSesionRechazado
 * @property {() => Promise<Array>} obtenerOperaciones Vista administrativa existente.
 * @property {() => Promise<number>} contarPendientes
 * @property {() => Promise<number>} contarErrores
 * @property {(id: string) => Promise<*>} reintentarOperacion
 * @property {(id: string) => Promise<*>} descartarOperacion
 */
export const operacionesCola = Object.freeze([
  'existeTicketPendiente',
  'inicioSesionRechazado',
  'obtenerOperaciones',
  'contarPendientes',
  'contarErrores',
  'reintentarOperacion',
  'descartarOperacion'
])
