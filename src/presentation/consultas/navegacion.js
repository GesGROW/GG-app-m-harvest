import { configurarMenuContextual } from '../../modules/menuContextual.js'
import {
  formatearFechaSesion,
  obtenerBadgeEstadoSesion
} from '@gesgrow/core/contexts/harvest/index.js'
import { crearConfiguracionConsultas } from './configuracion.js'
import { crearConsultasEnVista } from './index.js'

export function crearNavegacionContextual({
  document,
  mostrarVista,
  consultas: carga,
  obtenerOperador,
  obtenerSesionLectura,
  estaEnLinea,
  vistas,
  abrirOperacion,
  continuarSesion
}) {
  const contextTitle = document.querySelector('#context-title')
  const contextOptions = document.querySelector('#context-options')
  const menuContextual = configurarMenuContextual({
    dialogo: document.querySelector('#context-overlay'),
    botonCerrar: document.querySelector('#btn-cerrar-contexto')
  })
  const consultasContextuales = crearConfiguracionConsultas(vistas)
  let contextoActual = null
  const consultas = crearConsultasEnVista({
    document,
    mostrarVista,
    consultas: carga,
    obtenerOperador,
    obtenerSesionLectura,
    estaEnLinea,
    abrirDetalleSesionLectura
  })
  document.querySelectorAll('.btn-contexto').forEach((boton) => {
    boton.addEventListener('click', () => abrirMenuContextual(boton.dataset.contexto))
  })
  document
    .querySelector('#btn-volver-consulta')
    .addEventListener('click', () => abrirOperacion(contextoActual))
  document
    .querySelector('#consulta-empty-accion')
    .addEventListener('click', () => abrirOperacion('lectura'))

  function abrirMenuContextual(contexto) {
    const configuracion = consultasContextuales[contexto]
    if (!configuracion) return

    contextoActual = contexto
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
          await abrirOperacion(contexto)
          return
        }
        await consultas.abrir(opcion)
      })
      contextOptions.append(boton)
    }

    menuContextual.abrir()
  }

  function cerrarMenuContextual() {
    menuContextual.cerrar()
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
      ['Total de jabas', String(sesion.recipientes?.jabas ?? sesion.total_jabas)],
      ...(sesion.recipientes
        ? [
            ['Total de jarras', String(sesion.recipientes.jarras)],
            [
              'Kg estimados',
              sesion.recipientes.sinPeso === sesion.total_jabas
                ? 'Sin peso registrado'
                : `${sesion.recipientes.kg}${sesion.recipientes.sinPeso ? ' (parcial)' : ''}`
            ]
          ]
        : []),
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
        cerrarMenuContextual()
        await continuarSesion(sesion)
      })
      contextOptions.append(continuar)
    }

    menuContextual.abrir()
  }

  return Object.freeze({
    alCambiarVista(vista) {
      menuContextual.cerrar()
      consultas.alCambiarVista(vista)
    }
  })
}
