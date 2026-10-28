import { puertosOfflineParaFuentes } from './puertosOffline.js'
import { crearCasosDeUso } from '../../src/application/crearCasosDeUso.js'
import { mensajeErrorTickets } from '../../src/shared/mensajesTickets.js'

// Las pruebas de presentación mantienen sus fuentes simuladas e invocan los
// casos de uso reales. Los wrappers permiten modificar una fuente durante una
// prueba, como una respuesta tardía o un cambio de conectividad.
export function casosDeUsoParaVista(fuentes) {
  fuentes.mensajeErrorTickets ??= mensajeErrorTickets
  const dependencias = {
    backend: {
      ...fuentes.backend,
      obtenerCacheOperativa: (...args) => fuentes.actualizarCacheOperativa(...args)
    },
    offline: puertosOfflineParaFuentes(fuentes)
  }
  for (const nombre of [
    'obtenerOperador',
    'guardarOperador',
    'seleccionarCampaniaLocal',
    'obtenerCacheCampania',
    'actualizarCacheOperativa',
    'esErrorTemporal',
    'obtenerTicket',
    'existeTicketPendiente',
    'guardarAsignacionOffline',
    'obtenerTrabajador',
    'registrarJaberoOffline',
    'obtenerSesionActivaJabero',
    'obtenerLotes',
    'iniciarSesionOffline',
    'obtenerColaCompleta',
    'registrarLecturaOffline',
    'contarLecturasSesion',
    'contarLecturasCosechador',
    'finalizarSesionOffline',
    'sincronizarPendientes'
  ]) {
    if (typeof fuentes[nombre] === 'function')
      dependencias[nombre] = (...args) => fuentes[nombre](...args)
  }
  if (fuentes.validarOperador)
    dependencias.validarConFuentes = (dni) => fuentes.validarOperador(dni)
  return crearCasosDeUso({
    ...dependencias,
    estaEnLinea: () => fuentes.navigator.onLine,
    generarId: () => (fuentes.crypto ?? crypto).randomUUID(),
    ahora: () => new Date().toISOString(),
    registrarError: (...args) => (fuentes.console ?? console).error(...args)
  })
}
