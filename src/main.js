import './style.css'
import './tables.css'
import {
  cerrarSesionDispositivo,
  mostrarIngresoDispositivo
} from './modules/sesionDispositivo.js'
import { enhanceNativeSelects } from '@gesgrow/core/presentation/select.js'
import { backend } from '@gesgrow/core/backend/backend.js'
import { casosDeUso } from './application/casosDeUso.js'
import { crearConsultasReportes } from './application/crearConsultasReportes.js'
import { crearReportes } from './presentation/reportes/index.js'
import { crearAsignacionTickets } from './presentation/operacion/asignacionTickets.js'
import { crearRegistroJaberos } from './presentation/operacion/registroJaberos.js'
import { crearLecturaTickets } from './presentation/lectura/index.js'
import { crearSincronizacion } from './presentation/sincronizacion/index.js'
import { buscarCosechador } from './modules/asignacionTickets'
import { actualizarCacheOperativa } from './modules/cacheOperativa'
import { crearConsultasOperativas } from './application/crearConsultasOperativas.js'
import { crearNavegacionContextual } from './presentation/consultas/navegacion.js'
import { seleccionarCampaniaLocal } from './offline/db'
import {
  contarLecturasCosechador,
  contarLecturasSesion,
  contarErrores,
  contarPendientes,
  obtenerLotes,
  obtenerTicket,
  obtenerAsignacionesTickets,
  obtenerTrabajador,
  obtenerTrabajadores,
  obtenerLecturasSesion,
  obtenerSesionesActivas,
  obtenerSesionesOperador,
  obtenerUltimaLecturaSesion,
  obtenerColaCompleta,
  reintentarOperacion,
  descartarOperacion
} from './offline/db'
import { sincronizarPendientes } from './offline/sync'
import { evaluarDescarteOperacion } from './offline/cola'
import { configurarTecladoManual } from './modules/tecladoManual'
import { configurarEnvioScanner as configurarScanner } from './modules/scanner'
import { crearIngreso } from './presentation/ingreso/index.js'
import { crearNavegacionPrincipal } from './presentation/arranque/navegacion.js'
import { crearTecladosManuales } from './presentation/arranque/teclados.js'
import { configurarEventosCampo } from './presentation/arranque/eventos.js'

enhanceNativeSelects()
const teclados = crearTecladosManuales({ document, configurarTecladoManual })
const ingreso = crearIngreso({
  document,
  casosDeUso,
  configurarScanner,
  desactivarTecladoManual: teclados.desactivar,
  almacenSesion: sessionStorage,
  seleccionarCampaniaLocal,
  cerrarSesionDispositivo,
  limpiarFlujos() {
    asignacion.limpiar()
    registroJaberos.limpiar()
    lectura.limpiar()
    reportes.reiniciar()
  },
  mostrarVista: (vista) => navegacion.mostrarVista(vista),
  mostrarMenu: () => navegacion.mostrarMenu(),
  actualizarEstadoConexion: () => sincronizacion.actualizarEstado()
})
const navegacion = crearNavegacionPrincipal({
  document,
  obtenerOperador: ingreso.obtenerOperador,
  autorizarVista: ingreso.autorizarVista,
  verificarVigenciaOperador: ingreso.verificarVigenciaOperador,
  desactivarTecladoManual: teclados.desactivar,
  mostrarIngresoDispositivo,
  alCambiarVista(vista) {
    navegacionContextual.alCambiarVista(vista)
    sincronizacion.alCambiarVista(vista)
  },
  alMostrarMenu: () =>
    Promise.all([sincronizacion.actualizarEstado(), lectura.mostrarSesionesActivas()])
})
const vistaAsignacion = document.querySelector('#vista-asignacion')
const vistaJaberos = document.querySelector('#vista-jaberos')
const vistaLectura = document.querySelector('#vista-lectura')
const reportes = crearReportes({
  document,
  mostrarVista: navegacion.mostrarVista,
  mostrarMenu: navegacion.mostrarMenu,
  estaEnLinea: () => navigator.onLine,
  obtenerLotes,
  consultas: crearConsultasReportes({
    obtenerOperador: ingreso.obtenerOperador,
    consultas: backend
  })
})

const dependenciasFormularios = {
  document,
  casosDeUso,
  obtenerOperador: ingreso.obtenerOperador,
  configurarEnvioScanner: ingreso.configurarEnvioScanner,
  desactivarTecladoManual: teclados.desactivar,
  actualizarEstadoConexion: () => sincronizacion.actualizarEstado(),
  mostrarVista: navegacion.mostrarVista,
  mostrarMenu: navegacion.mostrarMenu
}
const asignacion = crearAsignacionTickets({
  ...dependenciasFormularios,
  buscarCosechador,
  obtenerColaCompleta
})
const registroJaberos = crearRegistroJaberos(dependenciasFormularios)
const lectura = crearLecturaTickets({
  ...dependenciasFormularios,
  consultas: {
    obtenerLotes,
    obtenerTicket,
    obtenerTrabajador,
    contarLecturasSesion,
    contarLecturasCosechador,
    obtenerLecturasSesion,
    obtenerUltimaLecturaSesion,
    obtenerSesionesActivas
  }
})

const sincronizacion = crearSincronizacion({
  document,
  obtenerOperador: ingreso.obtenerOperador,
  verificarVigenciaOperador: ingreso.verificarVigenciaOperador,
  estaEnLinea: () => navigator.onLine,
  cola: {
    obtenerOperaciones: obtenerColaCompleta,
    contarPendientes,
    contarErrores,
    reintentar: reintentarOperacion,
    descartar: descartarOperacion,
    evaluarDescarte: evaluarDescarteOperacion
  },
  sincronizar: sincronizarPendientes,
  actualizarTotalesLectura: () => lectura.actualizarTotales(),
  mostrarVista: navegacion.mostrarVista,
  mostrarMenu: navegacion.mostrarMenu
})

const navegacionContextual = crearNavegacionContextual({
  document,
  mostrarVista: navegacion.mostrarVista,
  estaEnLinea: () => navigator.onLine,
  obtenerOperador: ingreso.obtenerOperador,
  obtenerSesionLectura: () => lectura.obtenerSesion(),
  vistas: { asignacion: vistaAsignacion, jaberos: vistaJaberos, lectura: vistaLectura },
  consultas: crearConsultasOperativas({
    obtenerOperador: ingreso.obtenerOperador,
    obtenerSesionLectura: () => lectura.obtenerSesion(),
    lecturas: {
      obtenerAsignacionesTickets,
      obtenerTrabajadores,
      obtenerLecturasSesion,
      obtenerSesionesOperador,
      obtenerLotes
    },
    actualizarCache: actualizarCacheOperativa
  }),
  async abrirOperacion(contexto) {
    const vista = {
      asignacion: vistaAsignacion,
      jaberos: vistaJaberos,
      lectura: vistaLectura
    }[contexto]
    navegacion.mostrarVista(vista)
    if (contexto === 'lectura') {
      await lectura.volverALectura()
    }
  },
  continuarSesion: (sesion) => lectura.continuar(sesion)
})

configurarEventosCampo({
  window,
  document,
  obtenerOperador: ingreso.obtenerOperador,
  verificarVigenciaOperador: ingreso.verificarVigenciaOperador,
  sincronizar: sincronizarPendientes,
  actualizarEstadoConexion: () => sincronizacion.actualizarEstado()
})
ingreso.restaurar()
