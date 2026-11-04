import { crearConsultaAsignaciones } from './asignaciones.js'
import { crearConsultaJaberos } from './jaberos.js'
import { crearConsultaCosechadores } from './cosechadores.js'
import { crearConsultaSesiones } from './sesiones.js'

export function crearConsultasEnVista({
  document,
  mostrarVista,
  consultas,
  obtenerOperador,
  obtenerSesionLectura,
  estaEnLinea,
  abrirDetalleSesionLectura
}) {
  const vistaConsulta = document.querySelector('#vista-consulta')
  const elementos = Object.fromEntries(
    Object.entries({
      tituloConsultaHeader: '#titulo-consulta-header',
      consultaBusqueda: '#consulta-busqueda',
      consultaChips: '#consulta-chips',
      consultaTablaHead: '#consulta-tabla-head',
      consultaTablaBody: '#consulta-tabla-body',
      consultaEmpty: '#consulta-empty',
      consultaEmptyAccion: '#consulta-empty-accion',
      consultaContador: '#consulta-contador',
      btnActualizarConsulta: '#btn-actualizar-consulta',
      consultaFeedback: '#consulta-feedback'
    }).map(([nombre, selector]) => [nombre, document.querySelector(selector)])
  )
  const {
    consultaTablaHead,
    tituloConsultaHeader,
    btnActualizarConsulta,
    consultaFeedback,
    consultaBusqueda,
    consultaContador,
    consultaChips,
    consultaEmptyAccion
  } = elementos
  let consultaActual = null
  let revision = 0
  const dependencias = { document, elementos, consultas }
  const asignaciones = crearConsultaAsignaciones({
    ...dependencias,
    obtenerConfiguracion: () => consultaActual
  })
  const jaberos = crearConsultaJaberos(dependencias)
  const cosechadores = crearConsultaCosechadores({
    ...dependencias,
    obtenerSesionLectura
  })
  const sesiones = crearConsultaSesiones({ ...dependencias, abrirDetalleSesionLectura })
  const vistas = {
    'asignados-hoy': asignaciones,
    'buscar-asignacion': asignaciones,
    'jaberos-campania': jaberos,
    'buscar-jabero': jaberos,
    'cosechadores-jabas': cosechadores,
    'sesiones-lectura': sesiones
  }

  async function abrir(configuracion) {
    const vista = vistas[configuracion.id]
    if (!vista) throw new Error('Consulta no disponible.')
    consultaActual = configuracion
    const version = ++revision
    const vigente = () => version === revision
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
    try {
      await vista.preparar({ vigente })
    } catch (error) {
      if (!vigente()) return
      throw error
    }
    if (!vigente()) return
    mostrarVista(vistaConsulta)
    if (!consultaBusqueda.disabled) consultaBusqueda.focus()
  }

  async function actualizar() {
    if (btnActualizarConsulta.disabled || !obtenerOperador() || !consultaActual) return
    const version = revision
    const consulta = consultaActual
    const vigente = () =>
      version === revision && !vistaConsulta.classList.contains('oculto')
    btnActualizarConsulta.disabled = true
    btnActualizarConsulta.setAttribute('aria-busy', 'true')
    consultaFeedback.classList.add('oculto')
    try {
      if (
        !estaEnLinea() &&
        !['cosechadores-jabas', 'sesiones-lectura'].includes(consulta.id)
      )
        throw new Error('Sin conexión. Conéctese para actualizar los datos.')
      if (estaEnLinea()) await consultas.actualizar()
      if (!vigente()) return
      await vistas[consulta.id].preparar({ conservarFiltros: true, vigente })
    } catch (error) {
      if (!vigente()) return
      consultaFeedback.textContent =
        error.message || 'No se pudieron actualizar los datos.'
      consultaFeedback.className = 'resultado error'
    } finally {
      btnActualizarConsulta.disabled = false
      btnActualizarConsulta.removeAttribute('aria-busy')
    }
  }

  btnActualizarConsulta.addEventListener('click', actualizar)
  consultaBusqueda.addEventListener('input', () => vistas[consultaActual?.id]?.render())

  return Object.freeze({
    abrir,
    actualizar,
    alCambiarVista(vista) {
      if (vista === vistaConsulta) return
      revision++
      consultaActual = null
    }
  })
}
