import './style.css'
import './tables.css'
import { mensajeErrorTickets } from './shared/mensajesTickets.js'
import {
  cerrarSesionDispositivo,
  mostrarIngresoDispositivo
} from './modules/sesionDispositivo.js'
import { enhanceNativeSelects } from '@gesgrow/core/presentation/select.js'
import { backend } from '@gesgrow/core/backend/backend.js'
import { casosDeUso } from './application/casosDeUso.js'
import { autorizacionOperadorVigente } from '@gesgrow/core/contexts/identity-access/index.js'
import { buscarCosechador } from './modules/asignacionTickets'
import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'
import { actualizarCacheOperativa } from './modules/cacheOperativa'
import { resolverCampaniaOperador } from '@gesgrow/core/contexts/campaign-management/index.js'
import { seleccionarCampaniaLocal } from './offline/db'
import { obtenerVariedadesLote } from '@gesgrow/core/contexts/campaign-management/index.js'
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
import {
  configurarEnvioScanner as configurarScanner,
  esDniValido
} from './modules/scanner'
import { configurarConfirmacion } from './modules/confirmacion'
import {
  mostrarContadorCosechador,
  actualizarTotalesLecturaEnVista,
  mostrarEstadoLecturaTicket,
  mostrarSesionLecturaEnVista
} from './modules/vistaSesionLectura'
import {
  filtrarAsignaciones,
  filtrarAsignacionesHoy,
  formatearHoraAsignacion,
  obtenerBadgeEstadoAsignacion
} from '@gesgrow/core/contexts/harvest/index.js'
import {
  filtrarJaberosCampania,
  obtenerBadgeEstadoJabero
} from '@gesgrow/core/contexts/workforce/index.js'
import {
  ORDEN_COSECHADORES_JABAS,
  agruparLecturasPorCosechador,
  buscarCosechadoresJabas,
  formatearHoraUltimaLectura,
  ordenarCosechadoresJabas,
  resumirCosechadoresJabas
} from '@gesgrow/core/contexts/harvest/index.js'
import {
  FILTROS_SESIONES_LECTURA,
  enriquecerSesionLectura,
  filtrarSesionesLectura,
  formatearFechaSesion,
  formatearPeriodoSesion,
  obtenerBadgeEstadoSesion
} from '@gesgrow/core/contexts/harvest/index.js'
import {
  buscarRankingCosechadores,
  esErrorConexionRanking,
  formatearUltimaLectura,
  obtenerRankingCosechadores,
  reemplazarRankingCosechadores,
  resumirRankingCosechadores
} from '@gesgrow/core/contexts/harvest/index.js'
import {
  esErrorConexionProduccion,
  formatearFechaCalendario,
  obtenerProduccionDiaria,
  reemplazarProduccionDiaria,
  resumirProduccionDiaria
} from '@gesgrow/core/contexts/harvest/index.js'
import {
  ORDEN_PRODUCCION_LOTES,
  buscarProduccionLotes,
  esErrorConexionProduccionLotes,
  formatearUltimaLecturaLote,
  obtenerProduccionLotes,
  ordenarProduccionLotes,
  reemplazarProduccionLotes,
  resumirProduccionLotes
} from '@gesgrow/core/contexts/harvest/index.js'
import {
  esErrorConexionResumenCampania,
  formatearFechaInicioCampania,
  formatearNumeroResumen,
  formatearUltimaActividad,
  obtenerResumenCampania,
  reemplazarResumenCampania
} from '@gesgrow/core/contexts/harvest/index.js'

// VISTAS

enhanceNativeSelects()

const vistaLogin = document.querySelector('#vista-login')
const vistaMenu = document.querySelector('#vista-menu')
const vistaAsignacion = document.querySelector('#vista-asignacion')
const vistaJaberos = document.querySelector('#vista-jaberos')
const vistaLectura = document.querySelector('#vista-lectura')
const vistaSync = document.querySelector('#vista-sync')
const vistaConsulta = document.querySelector('#vista-consulta')
const vistaReportes = document.querySelector('#vista-reportes')
const vistaResumenCampania = document.querySelector('#vista-resumen-campania')
const vistaRankingCosechadores = document.querySelector('#vista-ranking-cosechadores')
const vistaProduccionDiaria = document.querySelector('#vista-produccion-diaria')
const vistaProduccionLotes = document.querySelector('#vista-produccion-lotes')
const sesionesRestaurables = document.querySelector('#sesiones-restaurables')
const resumenSync = document.querySelector('#resumen-sync')
const operacionesError = document.querySelector('#operaciones-error')

async function prepararIngreso(idRestaurado) {
  const campania = resolverCampaniaOperador(
    operador,
    operador.campanias?.some((item) => item.id === idRestaurado) ? idRestaurado : null
  )
  if (campania) return ingresarCampania(campania)
  opcionesCultivo.replaceChildren()
  cultivoMensaje.textContent = ''
  for (const opcion of operador.campanias) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn-primary'
    button.textContent = `${opcion.cultivo_nombre} · ${opcion.nombre}`
    button.addEventListener('click', async () => {
      for (const item of opcionesCultivo.children) item.disabled = true
      cultivoMensaje.textContent = ''
      try {
        await ingresarCampania(opcion)
      } catch (error) {
        cultivoMensaje.textContent = error.message
      } finally {
        for (const item of opcionesCultivo.children) item.disabled = false
      }
    })
    opcionesCultivo.appendChild(button)
  }
  mostrarVista(vistaCultivos)
}

async function ingresarCampania(campania) {
  const operadorIngreso = operador
  const resultado = await casosDeUso.ingresarCampania({
    operador: operadorIngreso,
    campania
  })
  if (operador !== operadorIngreso) return
  operador = resultado.operador
  sesionLectura = null
  cosechador = null
  resumenCampaniaActual = null
  produccionLotesActual = []
  produccionDiariaActual = []
  rankingCosechadoresActual = []
  sessionStorage.setItem('operador_dni', operador.dni)
  sessionStorage.setItem('campania_id', campania.id)
  mostrarMenu()
  resultado
    .sincronizar()
    .then((intento) => {
      if (intento) return actualizarEstadoConexion()
    })
    .catch(console.error)
}

document.querySelector('#btn-cancelar-cultivo').addEventListener('click', cerrarSesion)

// LOGIN

const formLogin = document.querySelector('#form-login')
const dniOperadorInput = document.querySelector('#dni-operador')
const loginMensaje = document.querySelector('#login-mensaje')

// MENÚ

const menuOperador = document.querySelector('#menu-operador')
const btnSalirMenu = document.querySelector('#btn-salir-menu')
const btnMenuAsignacion = document.querySelector('#btn-menu-asignacion')
const btnMenuJaberos = document.querySelector('#btn-menu-jaberos')
const btnMenuLectura = document.querySelector('#btn-menu-lectura')
const btnMenuReportes = document.querySelector('#btn-menu-reportes')
const estadoConexion = document.querySelector('#estado-conexion')

// REPORTES

const btnVolverReportes = document.querySelector('#btn-volver-reportes')
const btnReporteResumen = document.querySelector('#btn-reporte-resumen')
const btnVolverResumen = document.querySelector('#btn-volver-resumen')
const btnActualizarResumen = document.querySelector('#btn-actualizar-resumen')
const btnReintentarResumen = document.querySelector('#btn-reintentar-resumen')
const resumenCampaniaNombre = document.querySelector('#resumen-campania-nombre')
const resumenCampaniaFecha = document.querySelector('#resumen-campania-fecha')
const resumenCampaniaFeedback = document.querySelector('#resumen-campania-feedback')
const resumenCampaniaContenido = document.querySelector('#resumen-campania-contenido')
const resumenTotalJabas = document.querySelector('#resumen-total-jabas')
const resumenTotalCosechadores = document.querySelector('#resumen-total-cosechadores')
const resumenTotalLotes = document.querySelector('#resumen-total-lotes')
const resumenTotalSesiones = document.querySelector('#resumen-total-sesiones')
const resumenDiasProduccion = document.querySelector('#resumen-dias-produccion')
const resumenUltimaActividad = document.querySelector('#resumen-ultima-actividad')
const resumenCampaniaEmpty = document.querySelector('#resumen-campania-empty')
const btnReporteRanking = document.querySelector('#btn-reporte-ranking')
const btnVolverRanking = document.querySelector('#btn-volver-ranking')
const btnActualizarRanking = document.querySelector('#btn-actualizar-ranking')
const rankingCampania = document.querySelector('#ranking-campania')
const rankingBusqueda = document.querySelector('#ranking-busqueda')
const rankingPeriodo = document.querySelector('#ranking-periodo')
const rankingResumen = document.querySelector('#ranking-resumen')
const rankingFeedback = document.querySelector('#ranking-feedback')
const rankingTablaBody = document.querySelector('#ranking-tabla-body')
const rankingEmpty = document.querySelector('#ranking-empty')
const btnReporteProduccion = document.querySelector('#btn-reporte-produccion')
const btnVolverProduccion = document.querySelector('#btn-volver-produccion')
const btnActualizarProduccion = document.querySelector('#btn-actualizar-produccion')
const btnReintentarProduccion = document.querySelector('#btn-reintentar-produccion')
const produccionCampania = document.querySelector('#produccion-campania')
const produccionResumen = document.querySelector('#produccion-resumen')
const produccionFeedback = document.querySelector('#produccion-feedback')
const produccionTablaBody = document.querySelector('#produccion-tabla-body')
const produccionEmpty = document.querySelector('#produccion-empty')
const btnReporteLotes = document.querySelector('#btn-reporte-lotes')
const btnVolverLotes = document.querySelector('#btn-volver-lotes')
const btnActualizarLotes = document.querySelector('#btn-actualizar-lotes')
const btnReintentarLotes = document.querySelector('#btn-reintentar-lotes')
const btnOrdenLotesJabas = document.querySelector('#btn-orden-lotes-jabas')
const btnOrdenLotesAz = document.querySelector('#btn-orden-lotes-az')
const lotesCampania = document.querySelector('#lotes-campania')
const lotesBusqueda = document.querySelector('#lotes-busqueda')
const lotesResumen = document.querySelector('#lotes-resumen')
const lotesFeedback = document.querySelector('#lotes-feedback')
const lotesLista = document.querySelector('#lotes-lista')
const lotesEmpty = document.querySelector('#lotes-empty')

// ASIGNACIÓN

const nombreOperador = document.querySelector('#nombre-operador')
const btnVolverMenu = document.querySelector('#btn-volver-menu')
const formCosechador = document.querySelector('#form-cosechador')
const dniCosechadorInput = document.querySelector('#dni-cosechador')
const infoCosechador = document.querySelector('#info-cosechador')
const nombreCosechador = document.querySelector('#nombre-cosechador')
const campaniaCosechador = document.querySelector('#campania-cosechador')
const cardTicket = document.querySelector('#card-ticket')
const formTicket = document.querySelector('#form-ticket')
const codigoTicketInput = document.querySelector('#codigo-ticket')
const resultado = document.querySelector('#resultado')

// REGISTRO DE JABEROS

const btnVolverMenuJaberos = document.querySelector('#btn-volver-menu-jaberos')
const jaberosOperador = document.querySelector('#jaberos-operador')
const formJabero = document.querySelector('#form-jabero')
const dniJaberoInput = document.querySelector('#dni-jabero')
const resultadoJabero = document.querySelector('#resultado-jabero')

// LECTURA DE TICKETS

const btnVolverMenuLectura = document.querySelector('#btn-volver-menu-lectura')
const lecturaOperador = document.querySelector('#lectura-operador')
const configuracionLectura = document.querySelector('#configuracion-lectura')
const loteLectura = document.querySelector('#lote-lectura')
const variedadLectura = document.querySelector('#variedad-lectura')
let lotesLecturaDisponibles = []
const formIniciarLectura = document.querySelector('#form-iniciar-lectura')
const dniJaberoLectura = document.querySelector('#dni-jabero-lectura')
const sesionLecturaActiva = document.querySelector('#sesion-lectura-activa')
const sesionJabero = document.querySelector('#sesion-jabero')
const sesionLote = document.querySelector('#sesion-lote')
const sesionVariedad = document.querySelector('#sesion-variedad')
const formLecturaTicket = document.querySelector('#form-lectura-ticket')
const ticketLectura = document.querySelector('#ticket-lectura')
const resultadoLectura = document.querySelector('#resultado-lectura')
const estadoLecturaTicket = document.querySelector('#estado-lectura-ticket')
const totalSesion = document.querySelector('#total-sesion')
const etiquetaCosechador = document.querySelector('#etiqueta-cosechador')
const totalCosechador = document.querySelector('#total-cosechador')
const btnFinalizarLectura = document.querySelector('#btn-finalizar-lectura')
const mensajeModuloLectura = document.querySelector('#mensaje-modulo-lectura')
const confirmarFinalizarLectura = configurarConfirmacion({
  dialogo: document.querySelector('#confirmacion-lectura'),
  mensaje: document.querySelector('#confirmacion-lectura-mensaje')
})

// NAVEGACIÓN CONTEXTUAL Y VISTAS DE CONSULTA

const contextOverlay = document.querySelector('#context-overlay')
const contextTitle = document.querySelector('#context-title')
const contextOptions = document.querySelector('#context-options')
const btnCerrarContexto = document.querySelector('#btn-cerrar-contexto')
const btnVolverConsulta = document.querySelector('#btn-volver-consulta')
const tituloConsultaHeader = document.querySelector('#titulo-consulta-header')
const consultaBusqueda = document.querySelector('#consulta-busqueda')
const consultaChips = document.querySelector('#consulta-chips')
const consultaTablaHead = document.querySelector('#consulta-tabla-head')
const consultaTablaBody = document.querySelector('#consulta-tabla-body')
const consultaEmpty = document.querySelector('#consulta-empty')
const consultaEmptyAccion = document.querySelector('#consulta-empty-accion')
const consultaContador = document.querySelector('#consulta-contador')
const btnActualizarConsulta = document.querySelector('#btn-actualizar-consulta')
const consultaFeedback = document.querySelector('#consulta-feedback')

const consultasContextuales = {
  asignacion: {
    titulo: 'Asignación de tickets',
    vistaOperativa: vistaAsignacion,
    opciones: [
      { etiqueta: 'Operar', operativa: true },
      {
        id: 'asignados-hoy',
        etiqueta: 'Asignados hoy',
        titulo: 'Asignados hoy',
        descripcion: 'Tickets asignados durante el día de hoy.',
        columnas: ['Cosechador', 'Ticket', 'Hora'],
        vacio: 'No hay tickets asignados hoy.'
      },
      {
        id: 'buscar-asignacion',
        etiqueta: 'Buscar asignación',
        titulo: 'Buscar asignación',
        descripcion: 'Incluye días anteriores. Busque por DNI, nombre o ticket.',
        columnas: ['Cosechador', 'Ticket', 'Hora'],
        chips: ['Todos'],
        vacio: 'No hay asignaciones para mostrar.'
      }
    ]
  },
  jaberos: {
    titulo: 'Registro de jaberos',
    vistaOperativa: vistaJaberos,
    opciones: [
      { etiqueta: 'Registrar', operativa: true },
      {
        id: 'jaberos-campania',
        etiqueta: 'Jaberos de campaña',
        titulo: 'Jaberos de campaña',
        descripcion: 'Listado de campaña con búsqueda por nombre o DNI.',
        columnas: ['Jabero', 'DNI', 'Estado'],
        vacio: 'No hay jaberos registrados en esta campaña.'
      }
    ]
  },
  lectura: {
    titulo: 'Lectura de jabas',
    vistaOperativa: vistaLectura,
    opciones: [
      { etiqueta: 'Escanear', operativa: true },
      {
        id: 'cosechadores-jabas',
        etiqueta: 'Cosechadores y jabas',
        titulo: 'Cosechadores y jabas',
        descripcion: 'Resumen de producción de la sesión.',
        columnas: ['Cosechador', 'Jabas', 'Última'],
        columnasNumericas: ['Jabas'],
        chips: ['Más jabas', 'Recientes', 'A–Z'],
        vacio: 'Aún no se han registrado jabas en esta sesión.'
      },
      {
        id: 'sesiones-lectura',
        etiqueta: 'Sesiones',
        titulo: 'Sesiones',
        descripcion: 'Sesiones registradas localmente en este dispositivo.',
        columnas: ['Jabero / lote', 'Jabas', 'Estado'],
        columnasNumericas: ['Jabas'],
        chips: ['Todas', 'Activas', 'Cerradas'],
        vacio: 'No hay sesiones registradas en este dispositivo.'
      }
    ]
  }
}

let vistaOperativaConsulta = vistaMenu
let consultaActual = null
let ticketsConsultaActual = []
let trabajadoresConsultaActual = []
let cosechadoresJabasActual = []
let ordenCosechadoresJabas = ORDEN_COSECHADORES_JABAS.MAS_JABAS
let sesionesConsultaActual = []
let filtroSesionesLectura = FILTROS_SESIONES_LECTURA.TODAS
let resumenCampaniaActual = null
let rankingCosechadoresActual = []
let produccionDiariaActual = []
let produccionDiariaCampaniaActual = ''
let produccionLotesActual = []
let produccionLotesCampaniaActual = ''
let ordenProduccionLotes = ORDEN_PRODUCCION_LOTES.MAS_JABAS

const tecladosManuales = new Map(
  [
    [dniOperadorInput, 'numeric'],
    [dniCosechadorInput, 'numeric'],
    [codigoTicketInput, 'text'],
    [dniJaberoInput, 'numeric'],
    [dniJaberoLectura, 'numeric'],
    [ticketLectura, 'text']
  ].map(([input, modo]) => [
    input,
    configurarTecladoManual(
      input,
      input.parentElement.querySelector('.btn-teclado'),
      modo
    )
  ])
)

function desactivarTecladoManual(...inputs) {
  const campos = inputs.length ? inputs : tecladosManuales.keys()
  for (const input of campos) tecladosManuales.get(input)()
}

// ESTADO

let operador = null
const vistaCultivos = document.querySelector('#vista-cultivos')
const opcionesCultivo = document.querySelector('#opciones-cultivo')
const cultivoMensaje = document.querySelector('#cultivo-mensaje')

async function consultarCampania(consultar, parametros) {
  if (!operador?.campania?.id)
    throw new Error('Ingrese para seleccionar su campaña de trabajo.')
  const id = operador.campania.id
  try {
    return await consultar({ ...parametros, campaniaId: id })
  } finally {
    if (operador?.campania?.id !== id)
      throw new Error('La campaña de trabajo cambió. Actualice la consulta.')
  }
}
let cosechador = null
let sesionLectura = null

document.querySelectorAll('.btn-contexto').forEach((boton) => {
  boton.addEventListener('click', () => abrirMenuContextual(boton.dataset.contexto))
})

btnCerrarContexto.addEventListener('click', cerrarMenuContextual)
contextOverlay.addEventListener('click', (event) => {
  if (event.target === contextOverlay) cerrarMenuContextual()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !contextOverlay.classList.contains('oculto')) {
    cerrarMenuContextual()
  }
})

btnVolverConsulta.addEventListener('click', async () => {
  mostrarVista(vistaOperativaConsulta)
  if (vistaOperativaConsulta === vistaLectura) {
    if (sesionLectura) await mostrarSesionLectura()
    else loteLectura.focus()
  }
})

consultaEmptyAccion.addEventListener('click', () => {
  mostrarVista(vistaLectura)
  if (sesionLectura) mostrarSesionLectura().catch(console.error)
  else loteLectura.focus()
})

function abrirMenuContextual(contexto) {
  const configuracion = consultasContextuales[contexto]
  if (!configuracion) return

  vistaOperativaConsulta = configuracion.vistaOperativa
  contextTitle.textContent = configuracion.titulo
  contextOptions.replaceChildren()

  for (const opcion of configuracion.opciones) {
    const boton = document.createElement('button')
    boton.type = 'button'
    boton.className = opcion.operativa
      ? 'bottom-sheet__option bottom-sheet__option--active'
      : 'bottom-sheet__option'
    boton.textContent = opcion.etiqueta
    boton.addEventListener('click', async () => {
      cerrarMenuContextual()
      if (opcion.operativa) {
        mostrarVista(configuracion.vistaOperativa)
        if (contexto === 'lectura') {
          if (sesionLectura) await mostrarSesionLectura()
          else loteLectura.focus()
        }
        return
      }
      await mostrarConsulta(opcion)
    })
    contextOptions.append(boton)
  }

  contextOverlay.classList.remove('oculto')
  contextOverlay.setAttribute('aria-hidden', 'false')
  btnCerrarContexto.focus()
}

function cerrarMenuContextual() {
  contextOverlay.classList.add('oculto')
  contextOverlay.setAttribute('aria-hidden', 'true')
}

async function mostrarConsulta(configuracion) {
  consultaActual = configuracion
  consultaTablaHead.dataset.consulta = configuracion.id
  consultaTablaHead.classList.toggle(
    'consulta-jaberos',
    ['jaberos-campania', 'buscar-jabero'].includes(configuracion.id)
  )
  tituloConsultaHeader.textContent = configuracion.titulo
  btnActualizarConsulta.classList.remove('oculto')
  consultaFeedback.textContent = ''
  consultaFeedback.classList.add('oculto')
  consultaBusqueda.value = ''
  consultaBusqueda.disabled = false
  consultaContador.classList.add('oculto')
  consultaChips.classList.remove('oculto', 'filter-chips--wrap')
  consultaEmptyAccion.classList.add('oculto')

  if (['asignados-hoy', 'buscar-asignacion'].includes(configuracion.id)) {
    await prepararConsultaAsignadosHoy()
    mostrarVista(vistaConsulta)
    consultaBusqueda.focus()
    return
  }

  if (['jaberos-campania', 'buscar-jabero'].includes(configuracion.id)) {
    await prepararConsultaJaberosCampania()
    mostrarVista(vistaConsulta)
    consultaBusqueda.focus()
    return
  }

  if (configuracion.id === 'cosechadores-jabas') {
    await prepararConsultaCosechadoresJabas()
    mostrarVista(vistaConsulta)
    if (!consultaBusqueda.disabled) consultaBusqueda.focus()
    return
  }

  if (configuracion.id === 'sesiones-lectura') {
    await prepararConsultaSesionesLectura()
    mostrarVista(vistaConsulta)
    consultaBusqueda.focus()
    return
  }

  throw new Error('Consulta no disponible.')
}

async function prepararConsultaAsignadosHoy() {
  consultaBusqueda.placeholder = 'Buscar DNI, nombre o ticket...'
  ticketsConsultaActual = await obtenerAsignacionesTickets()
  consultaChips.replaceChildren()
  consultaChips.classList.add('oculto')

  consultaTablaHead.replaceChildren()
  const columnaFecha =
    consultaActual?.id === 'buscar-asignacion' ? 'Fecha / hora' : 'Hora'
  for (const columna of ['Cosechador', 'Ticket', columnaFecha]) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = columna
    consultaTablaHead.append(th)
  }

  renderAsignadosHoy()
}

function renderAsignadosHoy() {
  const esBusquedaGeneral = consultaActual?.id === 'buscar-asignacion'
  const filtrar = esBusquedaGeneral ? filtrarAsignaciones : filtrarAsignacionesHoy
  const asignacionesDisponibles = filtrar(ticketsConsultaActual)
  const asignaciones = filtrar(ticketsConsultaActual, {
    busqueda: consultaBusqueda.value
  })

  consultaTablaBody.replaceChildren()

  for (const ticket of asignaciones) {
    const fila = document.createElement('tr')

    const cosechadorCell = document.createElement('td')
    cosechadorCell.className = 'industrial-table__person'
    const nombre = document.createElement('strong')
    nombre.textContent = nombreCosechadorVisible(
      ticket.cosechador,
      ticket.cosechador_dni
    )
    const dni = document.createElement('span')
    dni.textContent = ticket.cosechador_dni || 'DNI no disponible'
    cosechadorCell.append(nombre, dni)

    const ticketCell = document.createElement('td')
    ticketCell.className = 'industrial-table__ticket'
    const codigo = document.createElement('strong')
    codigo.textContent = ticket.codigo_ticket
    ticketCell.append(codigo)

    const badge = obtenerBadgeEstadoAsignacion(ticket.estado_sync)
    if (badge) {
      const estado = document.createElement('span')
      estado.className = `sync-badge ${badge.clase}`
      estado.textContent = badge.etiqueta
      ticketCell.append(estado)
    }

    const horaCell = document.createElement('td')
    horaCell.className = 'industrial-table__numeric industrial-table__time'
    horaCell.textContent = formatearHoraAsignacion(ticket.fecha_asignacion)
    if (esBusquedaGeneral) {
      const fecha = new Date(ticket.fecha_asignacion)
      if (!Number.isNaN(fecha.getTime())) {
        const dia = document.createElement('span')
        dia.textContent = new Intl.DateTimeFormat('es-PE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }).format(fecha)
        const hora = document.createElement('span')
        hora.textContent = horaCell.textContent
        horaCell.textContent = ''
        horaCell.append(dia, hora)
      }
    }

    fila.append(cosechadorCell, ticketCell, horaCell)
    consultaTablaBody.append(fila)
  }

  const total = asignaciones.length
  consultaContador.textContent = `${total} ${total === 1 ? 'asignación' : 'asignaciones'}`
  consultaContador.classList.remove('oculto')

  if (total > 0) {
    consultaEmpty.classList.add('oculto')
    return
  }

  const sinResultados = asignacionesDisponibles.length > 0
  consultaEmpty.querySelector('strong').textContent = sinResultados
    ? 'No se encontraron asignaciones.'
    : esBusquedaGeneral
      ? 'No hay asignaciones para mostrar.'
      : 'No hay tickets asignados hoy.'
  consultaEmpty.querySelector('p').textContent = sinResultados
    ? 'Pruebe otra búsqueda.'
    : 'Las nuevas asignaciones aparecerán aquí, incluso si se crean sin conexión.'
  consultaEmpty.classList.remove('oculto')
}

async function prepararConsultaJaberosCampania() {
  consultaBusqueda.placeholder = 'Buscar nombre o DNI...'
  trabajadoresConsultaActual = await obtenerTrabajadores()
  consultaChips.replaceChildren()
  consultaChips.classList.add('oculto')

  consultaTablaHead.replaceChildren()
  for (const columna of ['Jabero', 'DNI', 'Estado']) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = columna
    consultaTablaHead.append(th)
  }

  renderJaberosCampania()
}

function renderJaberosCampania() {
  const jaberos = filtrarJaberosCampania(trabajadoresConsultaActual, {
    busqueda: consultaBusqueda.value
  })

  consultaTablaBody.replaceChildren()

  for (const trabajador of jaberos) {
    const fila = document.createElement('tr')

    const nombreCell = document.createElement('td')
    nombreCell.className = 'industrial-table__person'
    const nombre = document.createElement('strong')
    nombre.textContent = nombreCosechadorVisible(trabajador.nombre, trabajador.dni)
    nombreCell.append(nombre)

    const dniCell = document.createElement('td')
    dniCell.textContent = trabajador.dni || '—'

    const estadoCell = document.createElement('td')
    const badge = obtenerBadgeEstadoJabero(trabajador.estado_sync_jabero) ?? {
      etiqueta: trabajador.activo === false ? 'Inactivo' : 'Activo',
      clase: trabajador.activo === false ? 'sync-badge--error' : 'sync-badge--active'
    }
    const estado = document.createElement('span')
    estado.className = `sync-badge ${badge.clase}`
    estado.textContent = badge.etiqueta
    estadoCell.append(estado)

    fila.append(nombreCell, dniCell, estadoCell)
    consultaTablaBody.append(fila)
  }

  const total = jaberos.length
  consultaContador.textContent = `${total} ${total === 1 ? 'jabero' : 'jaberos'}`
  consultaContador.classList.remove('oculto')

  if (total > 0) {
    consultaEmpty.classList.add('oculto')
    return
  }

  const hayBusqueda = consultaBusqueda.value.trim().length > 0
  let titulo = 'No hay jaberos registrados en esta campaña.'
  let detalle = 'Los jaberos registrados aparecerán aquí, incluso sin conexión.'

  if (hayBusqueda) {
    titulo = 'No se encontraron jaberos.'
    detalle = 'Pruebe con otro nombre o DNI.'
  }

  consultaEmpty.querySelector('strong').textContent = titulo
  consultaEmpty.querySelector('p').textContent = detalle
  consultaEmpty.classList.remove('oculto')
}

async function prepararConsultaCosechadoresJabas({ conservarFiltros = false } = {}) {
  consultaBusqueda.placeholder = 'Buscar nombre o DNI...'
  consultaChips.classList.add('filter-chips--wrap')
  if (!conservarFiltros) ordenCosechadoresJabas = ORDEN_COSECHADORES_JABAS.MAS_JABAS

  const filtros = [
    ['Más jabas', ORDEN_COSECHADORES_JABAS.MAS_JABAS],
    ['Recientes', ORDEN_COSECHADORES_JABAS.RECIENTES],
    ['A–Z', ORDEN_COSECHADORES_JABAS.AZ]
  ]

  consultaChips.replaceChildren()
  filtros.forEach(([etiqueta, valor]) => {
    const boton = document.createElement('button')
    boton.type = 'button'
    boton.className = `filter-chip${valor === ordenCosechadoresJabas ? ' selected' : ''}`
    boton.textContent = etiqueta
    boton.dataset.orden = valor
    boton.setAttribute('aria-pressed', String(valor === ordenCosechadoresJabas))
    boton.addEventListener('click', () => {
      ordenCosechadoresJabas = valor
      consultaChips.querySelectorAll('.filter-chip').forEach((item) => {
        const seleccionado = item === boton
        item.classList.toggle('selected', seleccionado)
        item.setAttribute('aria-pressed', String(seleccionado))
      })
      renderCosechadoresJabas()
    })
    consultaChips.append(boton)
  })

  consultaTablaHead.replaceChildren()
  for (const columna of ['Cosechador', 'Jabas', 'Última']) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = columna
    consultaTablaHead.append(th)
  }

  if (!sesionLectura?.sesion_id) {
    cosechadoresJabasActual = []
    renderCosechadoresJabas()
    return
  }

  const [lecturas, trabajadores] = await Promise.all([
    obtenerLecturasSesion(sesionLectura.sesion_id),
    obtenerTrabajadores()
  ])
  cosechadoresJabasActual = agruparLecturasPorCosechador(lecturas, trabajadores)
  renderCosechadoresJabas()
}

function renderCosechadoresJabas() {
  consultaTablaBody.replaceChildren()

  if (!sesionLectura?.sesion_id) {
    consultaBusqueda.disabled = true
    consultaChips.classList.add('oculto')
    consultaContador.classList.add('oculto')
    consultaEmpty.querySelector('strong').textContent =
      'No hay una sesión de lectura activa.'
    consultaEmpty.querySelector('p').textContent =
      'Vuelva a lectura para iniciar o restaurar una sesión.'
    consultaEmptyAccion.classList.remove('oculto')
    consultaEmpty.classList.remove('oculto')
    return
  }

  consultaBusqueda.disabled = false
  consultaChips.classList.remove('oculto')
  consultaEmptyAccion.classList.add('oculto')

  const resumen = resumirCosechadoresJabas(cosechadoresJabasActual)
  consultaContador.textContent = `${resumen.cosechadores} ${
    resumen.cosechadores === 1 ? 'cosechador' : 'cosechadores'
  } · ${resumen.jabas} ${resumen.jabas === 1 ? 'jaba' : 'jabas'}`
  consultaContador.classList.remove('oculto')

  const cosechadores = ordenarCosechadoresJabas(
    buscarCosechadoresJabas(cosechadoresJabasActual, consultaBusqueda.value),
    ordenCosechadoresJabas
  )

  for (const cosechador of cosechadores) {
    const fila = document.createElement('tr')

    const personaCell = document.createElement('td')
    personaCell.className = 'industrial-table__person'
    const nombre = document.createElement('strong')
    nombre.textContent = nombreCosechadorVisible(cosechador.nombre, cosechador.dni)
    const dni = document.createElement('span')
    dni.textContent = cosechador.dni || 'DNI no disponible'
    personaCell.append(nombre, dni)

    const jabasCell = document.createElement('td')
    jabasCell.className = 'industrial-table__numeric industrial-table__count'
    jabasCell.textContent = cosechador.jabas

    const ultimaCell = document.createElement('td')
    ultimaCell.className = 'industrial-table__numeric industrial-table__time'
    ultimaCell.textContent = formatearHoraUltimaLectura(cosechador.ultimaLectura)

    fila.append(personaCell, jabasCell, ultimaCell)
    consultaTablaBody.append(fila)
  }

  if (cosechadores.length > 0) {
    consultaEmpty.classList.add('oculto')
    return
  }

  const hayBusqueda = consultaBusqueda.value.trim().length > 0
  consultaEmpty.querySelector('strong').textContent = hayBusqueda
    ? 'No se encontraron cosechadores.'
    : 'Aún no se han registrado jabas en esta sesión.'
  consultaEmpty.querySelector('p').textContent = hayBusqueda
    ? 'Pruebe con otro nombre o DNI.'
    : 'Las nuevas lecturas aparecerán aquí al volver desde Escanear.'
  consultaEmpty.classList.remove('oculto')
}

async function prepararConsultaSesionesLectura({ conservarFiltros = false } = {}) {
  consultaBusqueda.placeholder = 'Buscar jabero, DNI, lote o variedad...'
  consultaBusqueda.disabled = false
  consultaChips.classList.remove('oculto', 'filter-chips--wrap')
  consultaEmptyAccion.classList.add('oculto')
  if (!conservarFiltros) filtroSesionesLectura = FILTROS_SESIONES_LECTURA.TODAS

  const [sesiones, trabajadores, lotes] = await Promise.all([
    obtenerSesionesOperador(operador.dni),
    obtenerTrabajadores(),
    obtenerLotes()
  ])
  const nombresPorDni = new Map(trabajadores.map((t) => [t.dni, t.nombre]))
  const nombresLotes = new Map(lotes.map((lote) => [lote.lote_id, lote.nombre]))
  sesionesConsultaActual = await Promise.all(
    sesiones.map(async (sesion) => {
      const sesionId = sesion.id ?? sesion.sesion_id
      const lecturas = sesionId ? await obtenerLecturasSesion(sesionId) : []
      return enriquecerSesionLectura(
        {
          ...sesion,
          lote_nombre:
            nombresLotes.get(sesion.lote_id)?.trim() ||
            sesion.lote_nombre?.trim() ||
            'Lote sin nombre',
          jabero: nombreCosechadorVisible(
            nombresPorDni.get(sesion.dni_jabero) || sesion.jabero,
            sesion.dni_jabero
          )
        },
        lecturas
      )
    })
  )

  const filtros = [
    ['Todas', FILTROS_SESIONES_LECTURA.TODAS],
    ['Activas', FILTROS_SESIONES_LECTURA.ACTIVAS],
    ['Cerradas', FILTROS_SESIONES_LECTURA.CERRADAS]
  ]

  consultaChips.replaceChildren()
  filtros.forEach(([etiqueta, valor]) => {
    const boton = document.createElement('button')
    boton.type = 'button'
    boton.className = `filter-chip${valor === filtroSesionesLectura ? ' selected' : ''}`
    boton.textContent = etiqueta
    boton.dataset.filtro = valor
    boton.setAttribute('aria-pressed', String(valor === filtroSesionesLectura))
    boton.addEventListener('click', () => {
      filtroSesionesLectura = valor
      consultaChips.querySelectorAll('.filter-chip').forEach((item) => {
        const seleccionado = item === boton
        item.classList.toggle('selected', seleccionado)
        item.setAttribute('aria-pressed', String(seleccionado))
      })
      renderSesionesLectura()
    })
    consultaChips.append(boton)
  })

  consultaTablaHead.replaceChildren()
  for (const columna of ['Jabero / lote', 'Jabas', 'Estado']) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = columna
    consultaTablaHead.append(th)
  }

  renderSesionesLectura()
}

function renderSesionesLectura() {
  const busqueda = consultaBusqueda.value.trim().toLocaleLowerCase('es-PE')
  const sesiones = filtrarSesionesLectura(sesionesConsultaActual, {
    filtro: filtroSesionesLectura
  }).filter(
    (sesion) =>
      !busqueda ||
      [sesion.jabero, sesion.dni_jabero, sesion.lote_nombre, sesion.variedad].some(
        (valor) =>
          String(valor ?? '')
            .toLocaleLowerCase('es-PE')
            .includes(busqueda)
      )
  )

  consultaTablaBody.replaceChildren()

  for (const sesion of sesiones) {
    const fila = document.createElement('tr')
    fila.className = 'industrial-table__row--interactive'
    fila.tabIndex = 0
    fila.setAttribute('role', 'button')
    fila.setAttribute(
      'aria-label',
      `Ver sesión de ${sesion.jabero || sesion.dni_jabero || 'jabero sin identificar'}`
    )

    const resumenCell = document.createElement('td')
    resumenCell.className = 'industrial-table__person session-row__summary'
    const jabero = document.createElement('strong')
    jabero.textContent = sesion.jabero || sesion.dni_jabero || 'Jabero sin identificar'
    const lote = document.createElement('span')
    lote.textContent =
      [sesion.lote_nombre || 'Lote sin nombre', sesion.variedad]
        .filter(Boolean)
        .join(' · ') || 'Lote no disponible'
    const periodo = document.createElement('span')
    periodo.className = 'session-row__time'
    periodo.textContent = formatearPeriodoSesion(sesion)
    resumenCell.append(jabero, lote, periodo)

    const jabasCell = document.createElement('td')
    jabasCell.className = 'industrial-table__numeric industrial-table__count'
    jabasCell.textContent = sesion.total_jabas

    const estadoCell = document.createElement('td')
    const badge = obtenerBadgeEstadoSesion(sesion.estado)
    if (badge) {
      const estado = document.createElement('span')
      estado.className = `sync-badge ${badge.clase}`
      estado.textContent = badge.etiqueta
      estadoCell.append(estado)
    } else {
      estadoCell.textContent = sesion.estado || '—'
    }

    const abrirDetalle = () => abrirDetalleSesionLectura(sesion)
    fila.addEventListener('click', abrirDetalle)
    fila.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      abrirDetalle()
    })

    fila.append(resumenCell, jabasCell, estadoCell)
    consultaTablaBody.append(fila)
  }

  const total = sesiones.length
  if (filtroSesionesLectura === FILTROS_SESIONES_LECTURA.ACTIVAS) {
    consultaContador.textContent = `${total} ${total === 1 ? 'sesión activa' : 'sesiones activas'}`
  } else if (filtroSesionesLectura === FILTROS_SESIONES_LECTURA.CERRADAS) {
    consultaContador.textContent = `${total} ${total === 1 ? 'sesión cerrada' : 'sesiones cerradas'}`
  } else {
    consultaContador.textContent = `${total} ${total === 1 ? 'sesión' : 'sesiones'}`
  }
  consultaContador.classList.remove('oculto')

  if (total > 0) {
    consultaEmpty.classList.add('oculto')
    return
  }

  const hayBusqueda = consultaBusqueda.value.trim().length > 0
  let titulo = 'No hay sesiones registradas en este dispositivo.'
  let detalle = 'Las sesiones creadas en este PDA aparecerán aquí.'

  if (hayBusqueda) {
    titulo = 'No se encontraron sesiones.'
    detalle = 'Pruebe con otro jabero, DNI, lote o variedad.'
  } else if (
    sesionesConsultaActual.length > 0 &&
    filtroSesionesLectura === FILTROS_SESIONES_LECTURA.ACTIVAS
  ) {
    titulo = 'No hay sesiones activas.'
    detalle = 'Las sesiones activas aparecerán aquí mientras estén abiertas.'
  } else if (
    sesionesConsultaActual.length > 0 &&
    filtroSesionesLectura === FILTROS_SESIONES_LECTURA.CERRADAS
  ) {
    titulo = 'No hay sesiones cerradas.'
    detalle = 'Las sesiones finalizadas aparecerán aquí.'
  }

  consultaEmpty.querySelector('strong').textContent = titulo
  consultaEmpty.querySelector('p').textContent = detalle
  consultaEmpty.classList.remove('oculto')
}

function abrirDetalleSesionLectura(sesion) {
  contextTitle.textContent = 'Detalle de sesión'
  contextOptions.replaceChildren()

  const detalle = document.createElement('dl')
  detalle.className = 'session-detail'
  const campos = [
    ['Jabero', sesion.jabero],
    ['DNI', sesion.dni_jabero],
    ['Lote', sesion.lote_nombre || 'Lote sin nombre'],
    ['Variedad', sesion.variedad],
    ['Inicio', formatearFechaSesion(sesion.fecha_inicio)],
    ['Fin', sesion.fecha_fin ? formatearFechaSesion(sesion.fecha_fin) : ''],
    ['Estado', obtenerBadgeEstadoSesion(sesion.estado)?.etiqueta || sesion.estado],
    ['Total de jabas', String(sesion.total_jabas)],
    ['Cosechadores distintos', String(sesion.cosechadores_distintos)]
  ]

  for (const [etiqueta, valor] of campos) {
    if (!valor) continue
    const grupo = document.createElement('div')
    grupo.className = 'session-detail__row'
    const termino = document.createElement('dt')
    termino.textContent = etiqueta
    const dato = document.createElement('dd')
    dato.textContent = valor
    grupo.append(termino, dato)
    detalle.append(grupo)
  }

  contextOptions.append(detalle)

  if (sesion.estado === 'ACTIVA') {
    const continuar = document.createElement('button')
    continuar.type = 'button'
    continuar.className = 'bottom-sheet__option bottom-sheet__option--active'
    continuar.textContent = 'Continuar lectura'
    continuar.addEventListener('click', async () => {
      sesionLectura = {
        ...sesion,
        sesion_id: sesion.sesion_id ?? sesion.id
      }
      mostrarVista(vistaLectura)
      await mostrarSesionLectura()
    })
    contextOptions.append(continuar)
  }

  contextOverlay.classList.remove('oculto')
  contextOverlay.setAttribute('aria-hidden', 'false')
  btnCerrarContexto.focus()
}

async function abrirResumenCampania() {
  mostrarVista(vistaResumenCampania)

  if (resumenCampaniaActual) {
    renderResumenCampania()
  } else {
    resumenCampaniaNombre.textContent = 'Campaña activa'
    resumenCampaniaFecha.classList.add('oculto')
    resumenCampaniaContenido.classList.add('oculto')
  }

  await cargarResumenCampania()
}

async function cargarResumenCampania() {
  btnActualizarResumen.disabled = true
  btnReintentarResumen.classList.add('oculto')
  mostrarFeedbackResumenCampania('Cargando resumen…')

  if (!navigator.onLine) {
    mostrarFeedbackResumenCampania(
      'No se puede actualizar el resumen sin conexión.',
      'error',
      true
    )
    btnActualizarResumen.disabled = false
    return
  }

  try {
    const respuesta = await obtenerResumenCampania(operador.dni, (parametros) =>
      consultarCampania(backend.obtenerResumenCampania, parametros)
    )
    resumenCampaniaActual = reemplazarResumenCampania(resumenCampaniaActual, respuesta)
    ocultarFeedbackResumenCampania()
    renderResumenCampania()
  } catch (error) {
    const mensaje = esErrorConexionResumenCampania(error)
      ? 'No se puede actualizar el resumen sin conexión.'
      : `No se pudo cargar el resumen: ${error.message}`
    mostrarFeedbackResumenCampania(mensaje, 'error', true)

    if (!resumenCampaniaActual) {
      resumenCampaniaContenido.classList.add('oculto')
    }
  } finally {
    btnActualizarResumen.disabled = false
  }
}

function renderResumenCampania() {
  if (!resumenCampaniaActual) return

  const { campania, resumen } = resumenCampaniaActual
  resumenCampaniaNombre.textContent = campania.nombre || 'Campaña activa'

  const fechaInicio = formatearFechaInicioCampania(campania.fecha_inicio)
  resumenCampaniaFecha.textContent = fechaInicio ? `Desde ${fechaInicio}` : ''
  resumenCampaniaFecha.classList.toggle('oculto', !fechaInicio)

  resumenTotalJabas.textContent = formatearNumeroResumen(resumen.total_jabas)
  resumenTotalCosechadores.textContent = formatearNumeroResumen(
    resumen.total_cosechadores
  )
  resumenTotalLotes.textContent = formatearNumeroResumen(resumen.total_lotes)
  resumenTotalSesiones.textContent = formatearNumeroResumen(resumen.total_sesiones)
  resumenDiasProduccion.textContent = formatearNumeroResumen(
    resumen.dias_con_produccion
  )
  resumenUltimaActividad.textContent = formatearUltimaActividad(resumen.ultima_lectura)
  resumenCampaniaEmpty.classList.toggle('oculto', resumen.total_jabas > 0)
  resumenCampaniaContenido.classList.remove('oculto')
}

function mostrarFeedbackResumenCampania(mensaje, tipo = '', permitirReintento = false) {
  resumenCampaniaFeedback.textContent = mensaje
  resumenCampaniaFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
  btnReintentarResumen.classList.toggle('oculto', !permitirReintento)
}

function ocultarFeedbackResumenCampania() {
  resumenCampaniaFeedback.textContent = ''
  resumenCampaniaFeedback.className = 'resultado ranking-feedback oculto'
  btnReintentarResumen.classList.add('oculto')
}

async function abrirRankingCosechadores() {
  rankingPeriodo.value = 'HOY'
  rankingBusqueda.value = ''
  rankingCosechadoresActual = []
  rankingCampania.textContent = 'Campaña activa'
  rankingResumen.classList.add('oculto')
  rankingTablaBody.replaceChildren()
  rankingEmpty.classList.add('oculto')
  mostrarVista(vistaRankingCosechadores)
  await cargarRankingCosechadores()
  rankingBusqueda.focus()
}

async function cargarRankingCosechadores() {
  if (btnActualizarRanking.disabled) return
  btnActualizarRanking.disabled = true
  rankingPeriodo.disabled = true
  mostrarFeedbackRanking('Cargando ranking…')

  if (!navigator.onLine) {
    mostrarFeedbackRanking('No se puede actualizar el ranking sin conexión.', 'error')
    btnActualizarRanking.disabled = false
    rankingPeriodo.disabled = false
    return
  }

  try {
    const respuesta = await obtenerRankingCosechadores(
      operador.dni,
      (parametros) => consultarCampania(backend.obtenerRankingCosechadores, parametros),
      rankingPeriodo.value
    )
    rankingCosechadoresActual = reemplazarRankingCosechadores(
      rankingCosechadoresActual,
      respuesta.ranking
    )
    rankingCampania.textContent = respuesta.campania || 'Campaña activa'
    ocultarFeedbackRanking()
    renderRankingCosechadores()
  } catch (error) {
    const mensaje = esErrorConexionRanking(error)
      ? 'No se puede actualizar el ranking sin conexión.'
      : `No se pudo cargar el ranking: ${error.message}`
    mostrarFeedbackRanking(mensaje, 'error')

    if (rankingCosechadoresActual.length === 0) {
      rankingResumen.classList.add('oculto')
      rankingTablaBody.replaceChildren()
      rankingEmpty.classList.add('oculto')
    }
  } finally {
    btnActualizarRanking.disabled = false
    rankingPeriodo.disabled = false
  }
}

function renderRankingCosechadores() {
  const resumen = resumirRankingCosechadores(rankingCosechadoresActual)
  rankingResumen.textContent = `${formatearNumero(resumen.cosechadores)} ${
    resumen.cosechadores === 1 ? 'cosechador' : 'cosechadores'
  } · ${formatearNumero(resumen.jabas)} ${resumen.jabas === 1 ? 'jaba' : 'jabas'}`
  rankingResumen.classList.remove('oculto')

  const filas = buscarRankingCosechadores(
    rankingCosechadoresActual,
    rankingBusqueda.value
  )
  rankingTablaBody.replaceChildren()

  for (const fila of filas) {
    const tr = document.createElement('tr')

    const posicion = document.createElement('td')
    posicion.className = 'ranking-table__position'
    posicion.textContent = fila.posicion

    const persona = document.createElement('td')
    persona.className = 'industrial-table__person'
    const nombre = document.createElement('strong')
    nombre.textContent = nombreCosechadorVisible(fila.cosechador, fila.cosechador_dni)
    const dni = document.createElement('span')
    dni.textContent = fila.cosechador_dni || 'DNI no disponible'
    persona.append(nombre, dni)

    const produccion = document.createElement('td')
    produccion.className =
      'industrial-table__numeric industrial-table__count ranking-table__metric'
    const total = document.createElement('strong')
    total.textContent = formatearNumero(fila.total_jabas)
    const ultima = document.createElement('span')
    ultima.textContent = formatearUltimaLectura(fila.ultima_lectura)
    produccion.append(total, ultima)

    tr.append(posicion, persona, produccion)
    rankingTablaBody.append(tr)
  }

  if (filas.length > 0) {
    rankingEmpty.classList.add('oculto')
    return
  }

  const hayBusqueda = rankingBusqueda.value.trim().length > 0
  rankingEmpty.querySelector('strong').textContent = hayBusqueda
    ? 'No se encontraron cosechadores.'
    : 'Aún no hay jabas registradas en este período.'
  rankingEmpty.querySelector('p').textContent = hayBusqueda
    ? 'Pruebe con otro nombre o DNI.'
    : 'Las lecturas sincronizadas aparecerán aquí.'
  rankingEmpty.classList.remove('oculto')
}

function mostrarFeedbackRanking(mensaje, tipo = '') {
  rankingFeedback.textContent = mensaje
  rankingFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
}

function ocultarFeedbackRanking() {
  rankingFeedback.textContent = ''
  rankingFeedback.className = 'resultado ranking-feedback oculto'
}

async function abrirProduccionDiaria() {
  mostrarVista(vistaProduccionDiaria)

  if (produccionDiariaActual.length > 0) {
    produccionCampania.textContent = produccionDiariaCampaniaActual || 'Campaña activa'
    renderProduccionDiaria()
  } else {
    produccionCampania.textContent = 'Campaña activa'
    produccionResumen.classList.add('oculto')
    produccionTablaBody.replaceChildren()
    produccionEmpty.classList.add('oculto')
  }

  await cargarProduccionDiaria()
}

async function cargarProduccionDiaria() {
  btnActualizarProduccion.disabled = true
  btnReintentarProduccion.classList.add('oculto')
  mostrarFeedbackProduccion('Cargando producción…')

  if (!navigator.onLine) {
    mostrarFeedbackProduccion(
      'No se puede actualizar la producción sin conexión.',
      'error',
      true
    )
    btnActualizarProduccion.disabled = false
    return
  }

  try {
    const respuesta = await obtenerProduccionDiaria(operador.dni, (parametros) =>
      consultarCampania(backend.obtenerProduccionDiaria, parametros)
    )
    produccionDiariaActual = reemplazarProduccionDiaria(
      produccionDiariaActual,
      respuesta.produccion
    )
    produccionDiariaCampaniaActual = respuesta.campania.nombre || 'Campaña activa'
    produccionCampania.textContent = produccionDiariaCampaniaActual
    ocultarFeedbackProduccion()
    renderProduccionDiaria()
  } catch (error) {
    const mensaje = esErrorConexionProduccion(error)
      ? 'No se puede actualizar la producción sin conexión.'
      : `No se pudo cargar la producción: ${error.message}`
    mostrarFeedbackProduccion(mensaje, 'error', true)

    if (produccionDiariaActual.length === 0) {
      produccionResumen.classList.add('oculto')
      produccionTablaBody.replaceChildren()
      produccionEmpty.classList.add('oculto')
    }
  } finally {
    btnActualizarProduccion.disabled = false
  }
}

function renderProduccionDiaria() {
  const resumen = resumirProduccionDiaria(produccionDiariaActual)
  produccionResumen.textContent = `${formatearNumero(resumen.jabas)} ${
    resumen.jabas === 1 ? 'jaba' : 'jabas'
  } · ${formatearNumero(resumen.dias)} ${
    resumen.dias === 1 ? 'día con producción' : 'días con producción'
  }`
  produccionResumen.classList.remove('oculto')
  produccionTablaBody.replaceChildren()

  for (const fila of produccionDiariaActual) {
    const tr = document.createElement('tr')

    const fecha = document.createElement('td')
    fecha.className = 'produccion-table__date'
    const fechaPrincipal = document.createElement('strong')
    fechaPrincipal.textContent = formatearFechaCalendario(fila.fecha)
    const sesiones = document.createElement('span')
    sesiones.textContent = `${formatearNumero(fila.total_sesiones)} ${
      fila.total_sesiones === 1 ? 'sesión' : 'sesiones'
    }`
    fecha.append(fechaPrincipal, sesiones)

    const jabas = document.createElement('td')
    jabas.className = 'industrial-table__numeric produccion-table__metric'
    const totalJabas = document.createElement('strong')
    totalJabas.textContent = formatearNumero(fila.total_jabas)
    jabas.append(totalJabas)

    const cosechadores = document.createElement('td')
    cosechadores.className = 'industrial-table__numeric produccion-table__metric'
    const totalCosechadores = document.createElement('strong')
    totalCosechadores.textContent = formatearNumero(fila.total_cosechadores)
    cosechadores.append(totalCosechadores)

    tr.append(fecha, jabas, cosechadores)
    produccionTablaBody.append(tr)
  }

  produccionEmpty.classList.toggle('oculto', produccionDiariaActual.length > 0)
}

function mostrarFeedbackProduccion(mensaje, tipo = '', permitirReintento = false) {
  produccionFeedback.textContent = mensaje
  produccionFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
  btnReintentarProduccion.classList.toggle('oculto', !permitirReintento)
}

function ocultarFeedbackProduccion() {
  produccionFeedback.textContent = ''
  produccionFeedback.className = 'resultado ranking-feedback oculto'
  btnReintentarProduccion.classList.add('oculto')
}

async function abrirProduccionLotes() {
  lotesBusqueda.value = ''
  ordenProduccionLotes = ORDEN_PRODUCCION_LOTES.MAS_JABAS
  actualizarControlesOrdenLotes()
  mostrarVista(vistaProduccionLotes)

  if (produccionLotesActual.length > 0) {
    lotesCampania.textContent = produccionLotesCampaniaActual || 'Campaña activa'
    renderProduccionLotes()
  } else {
    lotesCampania.textContent = 'Campaña activa'
    lotesResumen.classList.add('oculto')
    lotesLista.replaceChildren()
    lotesEmpty.classList.add('oculto')
  }

  await cargarProduccionLotes()
  lotesBusqueda.focus()
}

async function cargarProduccionLotes() {
  btnActualizarLotes.disabled = true
  btnReintentarLotes.classList.add('oculto')
  mostrarFeedbackLotes('Cargando producción por lote…')

  if (!navigator.onLine) {
    mostrarFeedbackLotes(
      'No se puede actualizar la producción por lote sin conexión.',
      'error',
      true
    )
    btnActualizarLotes.disabled = false
    return
  }

  try {
    const respuesta = await obtenerProduccionLotes(operador.dni, (parametros) =>
      consultarCampania(backend.obtenerProduccionLotes, parametros)
    )
    const lotes = await obtenerLotes()
    const nombresLotes = new Map(lotes.map((lote) => [lote.lote_id, lote.nombre]))
    produccionLotesActual = reemplazarProduccionLotes(
      produccionLotesActual,
      respuesta.produccion.map((fila) => ({
        ...fila,
        lote_nombre:
          nombresLotes.get(fila.lote_id)?.trim() ||
          fila.lote_nombre?.trim() ||
          'Lote sin nombre'
      }))
    )
    produccionLotesCampaniaActual = respuesta.campania.nombre || 'Campaña activa'
    lotesCampania.textContent = produccionLotesCampaniaActual
    ocultarFeedbackLotes()
    renderProduccionLotes()
  } catch (error) {
    const mensaje = esErrorConexionProduccionLotes(error)
      ? 'No se puede actualizar la producción por lote sin conexión.'
      : `No se pudo cargar la producción por lote: ${error.message}`
    mostrarFeedbackLotes(mensaje, 'error', true)

    if (produccionLotesActual.length === 0) {
      lotesResumen.classList.add('oculto')
      lotesLista.replaceChildren()
      lotesEmpty.classList.add('oculto')
    }
  } finally {
    btnActualizarLotes.disabled = false
  }
}

function renderProduccionLotes() {
  const resumen = resumirProduccionLotes(produccionLotesActual)
  lotesResumen.textContent = `${formatearNumero(resumen.lotes)} ${
    resumen.lotes === 1 ? 'lote' : 'lotes'
  } · ${formatearNumero(resumen.jabas)} ${resumen.jabas === 1 ? 'jaba' : 'jabas'}`
  lotesResumen.classList.remove('oculto')

  const filtradas = buscarProduccionLotes(produccionLotesActual, lotesBusqueda.value)
  const filas = ordenarProduccionLotes(filtradas, ordenProduccionLotes)
  if (ordenProduccionLotes === ORDEN_PRODUCCION_LOTES.AZ) {
    filas.sort(
      (a, b) =>
        a.lote_nombre.localeCompare(b.lote_nombre, 'es', { sensitivity: 'base' }) ||
        a.variedad.localeCompare(b.variedad, 'es', { sensitivity: 'base' })
    )
  }
  lotesLista.replaceChildren()

  for (const fila of filas) {
    const articulo = document.createElement('article')
    articulo.className = 'lote-report-card'

    const cabecera = document.createElement('div')
    cabecera.className = 'lote-report-card__header'

    const identidad = document.createElement('div')
    identidad.className = 'lote-report-card__identity'
    const nombre = document.createElement('strong')
    nombre.textContent = fila.lote_nombre?.trim() || 'Lote sin nombre'
    const variedad = document.createElement('span')
    variedad.textContent = fila.variedad || 'Variedad no disponible'
    identidad.append(nombre, variedad)

    const produccion = document.createElement('div')
    produccion.className = 'lote-report-card__production'
    const total = document.createElement('strong')
    total.textContent = formatearNumero(fila.total_jabas)
    const unidad = document.createElement('span')
    unidad.textContent = fila.total_jabas === 1 ? 'jaba' : 'jabas'
    produccion.append(total, unidad)

    cabecera.append(identidad, produccion)
    articulo.append(cabecera)

    const metricas = document.createElement('div')
    metricas.className = 'lote-report-card__metrics'
    metricas.append(
      crearMetricaLote('Cosechadores', formatearNumero(fila.total_cosechadores)),
      crearMetricaLote('Sesiones', formatearNumero(fila.total_sesiones)),
      crearMetricaLote('Última', formatearUltimaLecturaLote(fila.ultima_lectura))
    )
    articulo.append(metricas)
    lotesLista.append(articulo)
  }

  if (filas.length > 0) {
    lotesEmpty.classList.add('oculto')
    return
  }

  const hayBusqueda = lotesBusqueda.value.trim().length > 0
  lotesEmpty.querySelector('strong').textContent = hayBusqueda
    ? 'No se encontraron lotes.'
    : 'Aún no hay producción por lote en esta campaña.'
  lotesEmpty.querySelector('p').textContent = hayBusqueda
    ? 'Pruebe con otro lote o variedad.'
    : 'Las lecturas sincronizadas aparecerán aquí.'
  lotesEmpty.classList.remove('oculto')
}

function crearMetricaLote(etiqueta, valor) {
  const metrica = document.createElement('div')
  metrica.className = 'lote-report-card__metric'
  const label = document.createElement('span')
  label.textContent = etiqueta
  const contenido = document.createElement('strong')
  contenido.textContent = valor
  metrica.append(label, contenido)
  return metrica
}

function actualizarControlesOrdenLotes() {
  const porJabas = ordenProduccionLotes === ORDEN_PRODUCCION_LOTES.MAS_JABAS
  btnOrdenLotesJabas.classList.toggle('selected', porJabas)
  btnOrdenLotesJabas.setAttribute('aria-pressed', String(porJabas))
  btnOrdenLotesAz.classList.toggle('selected', !porJabas)
  btnOrdenLotesAz.setAttribute('aria-pressed', String(!porJabas))
}

function cambiarOrdenProduccionLotes(orden) {
  ordenProduccionLotes = orden
  actualizarControlesOrdenLotes()
  renderProduccionLotes()
}

function mostrarFeedbackLotes(mensaje, tipo = '', permitirReintento = false) {
  lotesFeedback.textContent = mensaje
  lotesFeedback.className = `resultado ranking-feedback${tipo ? ` ${tipo}` : ''}`
  btnReintentarLotes.classList.toggle('oculto', !permitirReintento)
}

function ocultarFeedbackLotes() {
  lotesFeedback.textContent = ''
  lotesFeedback.className = 'resultado ranking-feedback oculto'
  btnReintentarLotes.classList.add('oculto')
}

function formatearNumero(valor) {
  return Number(valor || 0).toLocaleString('es-PE')
}

async function actualizarConsultaOperativa() {
  if (btnActualizarConsulta.disabled || !operador) return
  const consulta = consultaActual
  if (
    ![
      'asignados-hoy',
      'buscar-asignacion',
      'jaberos-campania',
      'buscar-jabero',
      'cosechadores-jabas',
      'sesiones-lectura'
    ].includes(consulta?.id)
  )
    return
  btnActualizarConsulta.disabled = true
  btnActualizarConsulta.setAttribute('aria-busy', 'true')
  consultaFeedback.classList.add('oculto')
  try {
    if (
      !navigator.onLine &&
      !['cosechadores-jabas', 'sesiones-lectura'].includes(consulta.id)
    ) {
      throw new Error('Sin conexión. Conéctese para actualizar los datos.')
    }
    if (navigator.onLine)
      await actualizarCacheOperativa(operador.dni, operador.campania.id)
    if (consultaActual !== consulta || vistaConsulta.classList.contains('oculto'))
      return
    if (['asignados-hoy', 'buscar-asignacion'].includes(consulta.id))
      await prepararConsultaAsignadosHoy()
    else if (['jaberos-campania', 'buscar-jabero'].includes(consulta.id))
      await prepararConsultaJaberosCampania()
    else if (consulta.id === 'cosechadores-jabas')
      await prepararConsultaCosechadoresJabas({ conservarFiltros: true })
    else await prepararConsultaSesionesLectura({ conservarFiltros: true })
  } catch (error) {
    if (consultaActual !== consulta || vistaConsulta.classList.contains('oculto'))
      return
    consultaFeedback.textContent =
      error.message || 'No se pudieron actualizar los datos.'
    consultaFeedback.className = 'resultado error'
  } finally {
    btnActualizarConsulta.disabled = false
    btnActualizarConsulta.removeAttribute('aria-busy')
  }
}

btnActualizarConsulta.addEventListener('click', actualizarConsultaOperativa)

consultaBusqueda.addEventListener('input', () => {
  if (['asignados-hoy', 'buscar-asignacion'].includes(consultaActual?.id))
    renderAsignadosHoy()
  if (['jaberos-campania', 'buscar-jabero'].includes(consultaActual?.id))
    renderJaberosCampania()
  if (consultaActual?.id === 'cosechadores-jabas') renderCosechadoresJabas()
  if (consultaActual?.id === 'sesiones-lectura') renderSesionesLectura()
})

rankingBusqueda.addEventListener('input', renderRankingCosechadores)
rankingPeriodo.addEventListener('change', () => {
  rankingCosechadoresActual = []
  rankingResumen.classList.add('oculto')
  rankingTablaBody.replaceChildren()
  rankingEmpty.classList.add('oculto')
  cargarRankingCosechadores()
})
btnActualizarRanking.addEventListener('click', cargarRankingCosechadores)
btnActualizarResumen.addEventListener('click', cargarResumenCampania)
btnReintentarResumen.addEventListener('click', cargarResumenCampania)
btnActualizarProduccion.addEventListener('click', cargarProduccionDiaria)
btnReintentarProduccion.addEventListener('click', cargarProduccionDiaria)
lotesBusqueda.addEventListener('input', renderProduccionLotes)
btnActualizarLotes.addEventListener('click', cargarProduccionLotes)
btnReintentarLotes.addEventListener('click', cargarProduccionLotes)
btnOrdenLotesJabas.addEventListener('click', () =>
  cambiarOrdenProduccionLotes(ORDEN_PRODUCCION_LOTES.MAS_JABAS)
)
btnOrdenLotesAz.addEventListener('click', () =>
  cambiarOrdenProduccionLotes(ORDEN_PRODUCCION_LOTES.AZ)
)

window.addEventListener('online', async () => {
  console.log('Conexión recuperada')

  try {
    await sincronizarPendientes()
  } catch (error) {
    console.error('No se pudieron sincronizar las operaciones pendientes:', error)
  }

  await actualizarEstadoConexion()
})

window.addEventListener('offline', actualizarEstadoConexion)
window.addEventListener('focus', () => {
  if (operador && !verificarVigenciaOperador()) return
  if (navigator.onLine)
    sincronizarPendientes().then(actualizarEstadoConexion).catch(console.error)
})
setInterval(() => {
  if (operador && !verificarVigenciaOperador()) return
  if (navigator.onLine)
    sincronizarPendientes().then(actualizarEstadoConexion).catch(console.error)
}, 30000)

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && operador) verificarVigenciaOperador()
})

document.addEventListener(
  'click',
  (event) => {
    if (operador && !verificarVigenciaOperador()) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  },
  true
)

function verificarVigenciaOperador() {
  if (!operador) return false
  if (autorizacionOperadorVigente(operador)) return true
  mostrarVista(vistaLogin)
  return false
}

function configurarEnvioScanner(formulario, input, procesar) {
  return configurarScanner(formulario, input, async (...argumentos) => {
    if (formulario !== formLogin && !verificarVigenciaOperador()) return
    return procesar(...argumentos)
  })
}

// LOGIN

configurarEnvioScanner(formLogin, dniOperadorInput, async (dni) => {
  limpiarMensajeLogin()
  if (!esDniValido(dni)) {
    mostrarErrorLogin('El DNI debe contener 8 dígitos.')
    dniOperadorInput.select()
    return
  }
  try {
    operador = await casosDeUso.validarOperador(dni)
    desactivarTecladoManual(dniOperadorInput)
    await prepararIngreso()
  } catch (error) {
    mostrarErrorLogin(error.message)
    dniOperadorInput.select()
  }
})

// MENÚ

btnMenuAsignacion.addEventListener('click', () => {
  limpiarAsignacion()
  mostrarVista(vistaAsignacion)
  nombreOperador.textContent = operador.nombre
  dniCosechadorInput.focus()
})

btnMenuJaberos.addEventListener('click', () => {
  limpiarRegistroJabero()
  jaberosOperador.textContent = operador.nombre
  mostrarVista(vistaJaberos)
  dniJaberoInput.focus()
})

btnMenuLectura.addEventListener('click', async () => {
  limpiarModuloLectura()
  lecturaOperador.textContent = operador.nombre
  mostrarVista(vistaLectura)
  await cargarLotes()
  await mostrarSesionesActivas()
  if (!sesionLectura) loteLectura.focus()
})

btnMenuReportes.addEventListener('click', () => {
  mostrarVista(vistaReportes)
})

btnVolverReportes.addEventListener('click', mostrarMenu)
btnReporteResumen.addEventListener('click', abrirResumenCampania)
btnVolverResumen.addEventListener('click', () => mostrarVista(vistaReportes))
btnReporteRanking.addEventListener('click', abrirRankingCosechadores)
btnVolverRanking.addEventListener('click', () => mostrarVista(vistaReportes))
btnReporteProduccion.addEventListener('click', abrirProduccionDiaria)
btnVolverProduccion.addEventListener('click', () => mostrarVista(vistaReportes))
btnReporteLotes.addEventListener('click', abrirProduccionLotes)
btnVolverLotes.addEventListener('click', () => mostrarVista(vistaReportes))

estadoConexion.addEventListener('click', mostrarEstadoSync)
document.querySelector('#btn-volver-sync').addEventListener('click', mostrarMenu)

async function mostrarEstadoSync() {
  mostrarVista(vistaSync)
  await actualizarVistaSync()
}

async function actualizarVistaSync() {
  const operaciones = (await obtenerColaCompleta())
    .filter((op) => op.payload.campaniaId === operador.campania.id)
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
  const pendientes = operaciones.filter((item) => item.estado === 'PENDIENTE')
  const errores = operaciones.filter((item) => item.estado === 'ERROR')
  resumenSync.textContent = `${pendientes.length} pendientes · ${errores.length} errores`
  operacionesError.replaceChildren()
  if (!errores.length) {
    operacionesError.textContent = 'No hay operaciones con error.'
    return
  }
  for (const operacion of errores) {
    const card = document.createElement('article')
    card.className = 'card sync-error-card'
    const titulo = document.createElement('h2')
    titulo.textContent = operacion.tipo.replaceAll('_', ' ')
    const detalle = document.createElement('p')
    detalle.className = 'detalle-sync'
    const payload = operacion.payload
    const dato =
      payload.codigoTicket ??
      payload.sesionId ??
      (payload.dniTrabajador
        ? `DNI terminado en ${payload.dniTrabajador.slice(-4)}`
        : '')
    const mensaje = String(operacion.error ?? 'Error sin detalle')
      .replace(/\b\d{8}\b/g, '********')
      .replace(/Bearer\s+\S+/gi, 'Bearer [oculto]')
    detalle.textContent = `${new Date(operacion.creado_en).toLocaleString()} · ${dato} · ${mensaje}`
    const acciones = document.createElement('div')
    acciones.className = 'acciones-sync'
    const reintentar = document.createElement('button')
    reintentar.className = 'btn-primary'
    reintentar.textContent = 'Reintentar'
    reintentar.addEventListener('click', async () => {
      await reintentarOperacion(operacion.id)
      if (navigator.onLine) await sincronizarPendientes()
      await actualizarVistaSync()
      await actualizarEstadoConexion()
    })
    acciones.append(reintentar)
    const descarte = evaluarDescarteOperacion(operacion, operaciones)
    if (descarte.permitido) {
      const descartar = document.createElement('button')
      descartar.className = 'btn-danger'
      descartar.textContent = 'Descartar'
      descartar.addEventListener('click', async () => {
        if (await descartarOperacion(operacion.id)) {
          await actualizarVistaSync()
          await actualizarEstadoConexion()
        }
      })
      acciones.append(descartar)
    } else {
      const motivo = document.createElement('p')
      motivo.className = 'detalle-sync'
      motivo.textContent = descarte.dependientes
        ? `Esta operación tiene ${descarte.dependientes} ${descarte.dependientes === 1 ? 'operación dependiente' : 'operaciones dependientes'} y no puede descartarse.`
        : 'Esta operación no admite descarte.'
      acciones.append(motivo)
    }
    card.append(titulo, detalle, acciones)
    operacionesError.append(card)
  }
}

async function mostrarSesionesActivas() {
  const sesiones = await obtenerSesionesActivas(operador.dni)
  sesionesRestaurables.replaceChildren()
  sesionesRestaurables.classList.toggle('oculto', !sesiones.length)
  if (!sesiones.length) return
  const lotes = await obtenerLotes()
  const nombresLotes = new Map(lotes.map((lote) => [lote.lote_id, lote.nombre]))
  const titulo = document.createElement('h2')
  titulo.textContent = 'Sesiones de lectura activas'
  sesionesRestaurables.append(titulo)
  for (const sesion of sesiones) {
    const fila = document.createElement('div')
    fila.className = 'card sesion-restaurable'
    const descripcion = document.createElement('p')
    const nombreLote =
      nombresLotes.get(sesion.lote_id)?.trim() ||
      sesion.lote_nombre?.trim() ||
      'Lote sin nombre'
    descripcion.textContent = `${sesion.jabero} · ${nombreLote} · ${sesion.variedad}`
    const total = document.createElement('p')
    total.textContent = `${await contarLecturasSesion(sesion.id)} jabas locales`
    const continuar = document.createElement('button')
    continuar.className = 'btn-primary'
    continuar.textContent = 'Continuar lectura'
    continuar.addEventListener('click', async () => {
      sesionLectura = sesion
      mostrarVista(vistaLectura)
      await mostrarSesionLectura()
    })
    const finalizar = document.createElement('button')
    finalizar.className = 'btn-secondary'
    finalizar.textContent = 'Finalizar sesión'
    finalizar.addEventListener('click', async () => {
      if (!(await confirmarFinalizarLectura('¿Finalizar la sesión de lectura?'))) return
      sesionLectura = sesion
      await finalizarSesionLectura()
    })
    fila.append(descripcion, total, continuar, finalizar)
    sesionesRestaurables.append(fila)
  }
}

// CERRAR SESIÓN

btnSalirMenu.addEventListener('click', cerrarSesion)

async function cerrarSesion() {
  try {
    await cerrarSesionDispositivo()
  } catch (error) {
    alert(error.message)
    return
  }
  operador = null
  cosechador = null
  sesionLectura = null
  sessionStorage.removeItem('operador_dni')
  sessionStorage.removeItem('campania_id')
  seleccionarCampaniaLocal('')
  dniOperadorInput.value = ''
  mostrarVista(vistaLogin)
  dniOperadorInput.focus()
}

// VOLVER AL MENÚ

btnVolverMenu.addEventListener('click', () => {
  limpiarAsignacion()
  mostrarMenu()
})

btnVolverMenuJaberos.addEventListener('click', () => {
  limpiarRegistroJabero()
  mostrarMenu()
})

// VALIDAR COSECHADOR

configurarEnvioScanner(formCosechador, dniCosechadorInput, async (dni) => {
  limpiarResultado()
  if (!esDniValido(dni)) {
    mostrarResultado('El DNI debe contener 8 dígitos.', 'error')
    dniCosechadorInput.select()
    return
  }
  try {
    cosechador = await buscarCosechador(dni)
    nombreCosechador.textContent = nombreCosechadorVisible(
      cosechador.nombre,
      cosechador.dni
    )
    campaniaCosechador.textContent = cosechador.campania
    infoCosechador.classList.remove('oculto')
    desactivarTecladoManual(dniCosechadorInput)
    habilitarTicket()
  } catch (error) {
    cosechador = null
    deshabilitarTicket()
    mostrarResultado(error.message, 'error')
    dniCosechadorInput.select()
  }
})

// ASIGNAR TICKET

configurarEnvioScanner(formTicket, codigoTicketInput, async (codigoTicket, liberar) => {
  limpiarResultado()
  if (!operador || !cosechador) {
    return
  }
  if (!codigoTicket) {
    mostrarResultado('Escanee un ticket.', 'error')
    codigoTicketInput.focus()
    return
  }
  codigoTicketInput.disabled = true
  let respuestaAsignacion
  try {
    respuestaAsignacion = await casosDeUso.asignarTicket({
      operador,
      cosechador,
      codigoTicket
    })
  } catch (error) {
    mostrarResultado(mensajeErrorTickets(error, codigoTicket), 'error')
    codigoTicketInput.disabled = false
    codigoTicketInput.select()
    return
  }

  const mensajeAsignacion = `Ticket ${codigoTicket} y conjunto de tickets relacionado asignados`
  mostrarResultado(mensajeAsignacion, 'exito')
  desactivarTecladoManual(codigoTicketInput)
  setTimeout(prepararSiguienteCosechador, 1200)
  liberar()
  await actualizarEstadoConexion()

  if (await respuestaAsignacion.sincronizar()) {
    await actualizarEstadoConexion()
    const op = (await obtenerColaCompleta()).find(
      (o) => o.id === respuestaAsignacion.operacion?.id
    )
    if (resultado.textContent === mensajeAsignacion) {
      if (op?.estado === 'SINCRONIZADA')
        mostrarResultado(
          `Ticket ${codigoTicket} y conjunto de tickets relacionado asignados`,
          'exito'
        )
      else if (op?.estado === 'ERROR') mostrarResultado(op.error, 'error')
    }
  }
})

// REGISTRO DE JABEROS

configurarEnvioScanner(formJabero, dniJaberoInput, async (dni, liberar) => {
  limpiarResultadoJabero()
  if (!esDniValido(dni)) {
    mostrarResultadoJabero('El DNI debe contener 8 dígitos.', 'error')
    dniJaberoInput.select()
    return
  }
  let resultado
  try {
    resultado = await casosDeUso.registrarJabero({ operador, dni })
    const { trabajador } = resultado

    mostrarResultadoJabero(
      `${nombreCosechadorVisible(trabajador?.nombre, dni)} registrado como jabero`,
      'exito'
    )
    dniJaberoInput.value = ''
    desactivarTecladoManual(dniJaberoInput)
    dniJaberoInput.focus()
  } catch (error) {
    mostrarResultadoJabero(error.message, 'error')
    dniJaberoInput.select()
    return
  }

  liberar()
  await resultado.sincronizar()
  await actualizarEstadoConexion()
})

// NAVEGACIÓN

function mostrarVista(vista) {
  if (operador && !autorizacionOperadorVigente(operador)) {
    operador = null
    sessionStorage.removeItem('operador_dni')
    vista = vistaLogin
    mostrarErrorLogin('La autorización venció. Ingrese con una asignación de hoy.')
  }
  desactivarTecladoManual()
  cerrarMenuContextual()
  vistaLogin.classList.add('oculto')
  vistaCultivos.classList.add('oculto')
  vistaMenu.classList.add('oculto')
  vistaAsignacion.classList.add('oculto')
  vistaJaberos.classList.add('oculto')
  vistaLectura.classList.add('oculto')
  vistaSync.classList.add('oculto')
  vistaConsulta.classList.add('oculto')
  vistaReportes.classList.add('oculto')
  vistaResumenCampania.classList.add('oculto')
  vistaRankingCosechadores.classList.add('oculto')
  vistaProduccionDiaria.classList.add('oculto')
  vistaProduccionLotes.classList.add('oculto')
  if (vista === vistaLogin && mostrarIngresoDispositivo()) return
  vista.classList.remove('oculto')
}

function mostrarMenu() {
  if (!verificarVigenciaOperador()) return
  mostrarVista(vistaMenu)
  menuOperador.textContent = operador.nombre
  actualizarEstadoConexion()
  mostrarSesionesActivas().catch(console.error)
}

// ASIGNACIÓN - UI

function habilitarTicket() {
  cardTicket.classList.remove('deshabilitado')
  codigoTicketInput.disabled = false
  codigoTicketInput.parentElement.querySelector('.btn-teclado').disabled = false
  codigoTicketInput.value = ''
  codigoTicketInput.focus()
}

function deshabilitarTicket() {
  desactivarTecladoManual(codigoTicketInput)
  cardTicket.classList.add('deshabilitado')
  codigoTicketInput.disabled = true
  codigoTicketInput.parentElement.querySelector('.btn-teclado').disabled = true
  codigoTicketInput.value = ''
  infoCosechador.classList.add('oculto')
}

function prepararSiguienteCosechador() {
  desactivarTecladoManual()
  cosechador = null
  dniCosechadorInput.value = ''
  infoCosechador.classList.add('oculto')
  deshabilitarTicket()
  dniCosechadorInput.focus()
}

function limpiarAsignacion() {
  desactivarTecladoManual()
  cosechador = null
  dniCosechadorInput.value = ''
  codigoTicketInput.value = ''
  infoCosechador.classList.add('oculto')
  deshabilitarTicket()
  limpiarResultado()
}

// MENSAJES

function mostrarResultado(mensaje, tipo) {
  resultado.textContent = mensaje
  resultado.className = `resultado ${tipo}`
  resultado.classList.remove('oculto')
}

function limpiarResultado() {
  resultado.textContent = ''
  resultado.className = 'resultado oculto'
}

function mostrarErrorLogin(mensaje) {
  loginMensaje.textContent = mensaje
  loginMensaje.className = 'mensaje error'
}

function limpiarMensajeLogin() {
  loginMensaje.textContent = ''
  loginMensaje.className = 'mensaje'
}

async function actualizarEstadoConexion() {
  let pendientes
  let errores
  try {
    pendientes = await contarPendientes()
    errores = await contarErrores()
    if (sesionLectura) {
      await actualizarTotalesLecturaEnVista(
        sesionLectura,
        { totalSesion, etiquetaCosechador, totalCosechador },
        {
          contarLecturasSesion,
          obtenerUltimaLecturaSesion,
          contarLecturasCosechador,
          obtenerTrabajador
        }
      )
    }
  } catch (error) {
    console.error('No se pudo consultar la cola de sincronización:', error)
  }

  if (!navigator.onLine) {
    estadoConexion.textContent =
      pendientes === undefined
        ? 'Sin conexión'
        : `Sin conexión · ${pendientes} pendientes`
    estadoConexion.className = 'estado-conexion offline'
    return
  }

  if (errores > 0) {
    estadoConexion.textContent = `${errores} ${errores === 1 ? 'error de sincronización' : 'errores de sincronización'}`
    estadoConexion.className = 'estado-conexion error-sync'
    return
  }

  if (pendientes > 0) {
    estadoConexion.textContent = `${pendientes} ${pendientes === 1 ? 'registro pendiente' : 'registros pendientes'}`
    estadoConexion.className = 'estado-conexion warning-sync'
    return
  }

  estadoConexion.textContent = ''
  estadoConexion.className = 'estado-conexion oculto'
}

// RESTAURAR SESIÓN AL RECARGAR

async function restaurarSesion() {
  const dni = sessionStorage.getItem('operador_dni')
  if (!dni) {
    return
  }
  try {
    operador = await casosDeUso.validarOperador(dni)
    await prepararIngreso(sessionStorage.getItem('campania_id'))
  } catch {
    sessionStorage.removeItem('operador_dni')
  }
}

restaurarSesion()

function mostrarResultadoJabero(mensaje, tipo) {
  resultadoJabero.textContent = mensaje
  resultadoJabero.className = `resultado ${tipo}`
  resultadoJabero.classList.remove('oculto')
}

function limpiarResultadoJabero() {
  resultadoJabero.textContent = ''
  resultadoJabero.className = 'resultado oculto'
}

function limpiarRegistroJabero() {
  desactivarTecladoManual(dniJaberoInput)
  dniJaberoInput.value = ''
  limpiarResultadoJabero()
}

async function cargarLotes() {
  loteLectura.disabled = true
  lotesLecturaDisponibles = []
  cargarVariedadesLectura()
  loteLectura.innerHTML = '<option value="">Cargando lotes...</option>'
  try {
    const lotes = await obtenerLotes()
    lotesLecturaDisponibles = lotes
    loteLectura.innerHTML = '<option value="">Seleccione un lote</option>'
    for (const lote of lotes) {
      const option = document.createElement('option')
      option.value = lote.lote_id
      option.textContent = lote.nombre?.trim() || 'Lote sin nombre'
      loteLectura.appendChild(option)
    }
    loteLectura.disabled = false
  } catch (error) {
    mostrarMensajeLectura(error.message, 'error')
  }
}

function cargarVariedadesLectura() {
  const lote = lotesLecturaDisponibles.find(
    (item) => item.lote_id === loteLectura.value
  )
  const variedades = obtenerVariedadesLote(lote)
  variedadLectura.replaceChildren()
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = lote
    ? 'Seleccione una variedad'
    : 'Seleccione primero un lote'
  variedadLectura.appendChild(placeholder)
  for (const variedad of variedades) {
    const option = document.createElement('option')
    option.value = variedad.id ?? ''
    option.textContent = variedad.nombre
    variedadLectura.appendChild(option)
    if (variedades.length === 1) option.selected = true
  }
  variedadLectura.disabled = !variedades.length
}

loteLectura.addEventListener('change', cargarVariedadesLectura)

configurarEnvioScanner(formIniciarLectura, dniJaberoLectura, async (dni) => {
  if (!dni) {
    mostrarMensajeLectura('Ingresar DNI.', 'error')
    dniJaberoLectura.focus()
    return
  }
  const loteId = loteLectura.value
  if (!loteId) {
    mostrarMensajeLectura('Seleccione un lote.', 'error')
    return
  }
  if (!esDniValido(dni)) {
    mostrarMensajeLectura('El DNI debe contener 8 dígitos.', 'error')
    dniJaberoLectura.select()
    return
  }
  let resultado
  try {
    resultado = await casosDeUso.iniciarSesionLectura({
      operador,
      dni,
      loteId,
      variedadId: variedadLectura.value
    })
    sesionLectura = resultado.sesion
    desactivarTecladoManual(dniJaberoLectura)
    await mostrarSesionLectura()
  } catch (error) {
    mostrarMensajeLectura(error.message, 'error')
    dniJaberoLectura.select()
    return
  }

  await resultado.sincronizar()
  await actualizarEstadoConexion()
})

configurarEnvioScanner(formLecturaTicket, ticketLectura, async (codigo, liberar) => {
  if (!sesionLectura) {
    return
  }
  if (!codigo) {
    return
  }
  ticketLectura.disabled = true
  let resultado
  try {
    resultado = await casosDeUso.registrarLecturaJaba({
      operador,
      sesionLectura,
      codigo
    })
    const { ticket, total, totalPersona } = resultado
    const nombreTicket = nombreCosechadorVisible(
      ticket.cosechador,
      ticket.cosechador_dni
    )
    mostrarEstadoLecturaTicket('', { estadoLecturaTicket, resultadoLectura })
    totalSesion.textContent = total
    mostrarContadorCosechador(nombreTicket, totalPersona, {
      etiquetaCosechador,
      totalCosechador
    })
    ticketLectura.value = ''
    ticketLectura.disabled = false
    desactivarTecladoManual(ticketLectura)
    ticketLectura.focus()
  } catch (error) {
    mostrarEstadoLecturaTicket(mensajeErrorTickets(error, codigo), {
      estadoLecturaTicket,
      resultadoLectura
    })
    ticketLectura.disabled = false
    ticketLectura.select()
    return
  }

  liberar()
  await resultado.sincronizar()
  await actualizarEstadoConexion()
})

btnFinalizarLectura.addEventListener('click', async () => {
  if (!sesionLectura) {
    return
  }
  const confirmar = await confirmarFinalizarLectura('¿Finalizar la sesión de lectura?')
  if (!confirmar) {
    return
  }
  try {
    await finalizarSesionLectura()
  } catch (error) {
    mostrarMensajeLectura(error.message, 'error')
  }
})

btnVolverMenuLectura.addEventListener('click', async () => {
  if (!sesionLectura) {
    mostrarMenu()
    return
  }
  const confirmar = await confirmarFinalizarLectura(
    'Hay una sesión activa. ¿Desea finalizarla y volver al menú?'
  )
  if (!confirmar) {
    return
  }
  try {
    await finalizarSesionLectura()
  } catch (error) {
    mostrarMensajeLectura(error.message, 'error')
  }
})

async function finalizarSesionLectura() {
  const resultado = await casosDeUso.cerrarSesionLectura({ operador, sesionLectura })

  sesionLectura = null
  mostrarMenu()

  await resultado.sincronizar()
  await actualizarEstadoConexion()
}

async function mostrarSesionLectura() {
  desactivarTecladoManual()
  await mostrarSesionLecturaEnVista(
    sesionLectura,
    {
      configuracionLectura,
      sesionLecturaActiva,
      sesionJabero,
      sesionLote,
      sesionVariedad,
      totalSesion,
      etiquetaCosechador,
      totalCosechador,
      mensajeModuloLectura,
      ticketLectura,
      estadoLecturaTicket,
      resultadoLectura
    },
    {
      contarLecturasSesion,
      obtenerUltimaLecturaSesion,
      contarLecturasCosechador,
      obtenerTicket,
      obtenerTrabajador,
      obtenerLotes
    }
  )
}

function mostrarMensajeLectura(mensaje, tipo) {
  mensajeModuloLectura.textContent = mensaje
  mensajeModuloLectura.className = `resultado ${tipo}`
}

function limpiarModuloLectura() {
  desactivarTecladoManual()
  sesionLectura = null
  configuracionLectura.classList.remove('oculto')
  sesionLecturaActiva.classList.add('oculto')
  dniJaberoLectura.value = ''
  ticketLectura.value = ''
  mostrarEstadoLecturaTicket('', { estadoLecturaTicket, resultadoLectura })
  mensajeModuloLectura.textContent = ''
  mensajeModuloLectura.className = 'resultado oculto'
  totalSesion.textContent = '0'
  mostrarContadorCosechador(null, 0, { etiquetaCosechador, totalCosechador })
}
