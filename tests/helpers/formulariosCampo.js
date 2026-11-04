import { readFileSync } from 'node:fs'
import { crearAsignacionTickets } from '../../src/presentation/operacion/asignacionTickets.js'
import { crearRegistroJaberos } from '../../src/presentation/operacion/registroJaberos.js'
import { casosDeUsoParaVista } from './casosDeUso.js'
import { documentoVista } from './elementoVista.js'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

export function formulariosCampo(fuentes = {}, { scanner } = {}) {
  const document = documentoVista(html)
  const nodo = (id) => document.querySelector(`#${id}`)
  const handlers = new Map(),
    timers = new Map()
  const mensajesAsignacion = [],
    mensajesJabero = [],
    cambios = [],
    teclados = []
  let timerId = 0
  fuentes.operador ??= { dni: '47480378', nombre: 'Operador', campania: { id: 'A' } }
  fuentes.navigator ??= { onLine: false }
  for (const id of ['dni-cosechador', 'codigo-ticket', 'dni-jabero']) {
    const boton = document.createElement('button')
    nodo(id).parentElement = { querySelector: () => boton }
  }
  for (const [id, mensajes] of [
    ['resultado', mensajesAsignacion],
    ['resultado-jabero', mensajesJabero]
  ]) {
    const el = nodo(id),
      quitar = el.classList.remove
    el.classList.remove = (...clases) => {
      quitar(...clases)
      if (el.textContent)
        mensajes.push({
          mensaje: el.textContent,
          tipo: el.classList.contains('error') ? 'error' : 'exito'
        })
    }
  }
  function mostrarVista(vista) {
    for (const id of ['vista-asignacion', 'vista-jaberos', 'vista-menu'])
      nodo(id).classList.add('oculto')
    vista.classList.remove('oculto')
    cambios.push(vista)
  }
  const dependencias = {
    document,
    casosDeUso: fuentes.casosDeUso ?? casosDeUsoParaVista(fuentes),
    obtenerOperador: () => fuentes.operador,
    configurarEnvioScanner(form, input, callback) {
      handlers.set(form, callback)
      scanner?.(form, input, callback)
    },
    desactivarTecladoManual: (...inputs) => teclados.push(inputs),
    actualizarEstadoConexion: (...args) => fuentes.actualizarEstadoConexion?.(...args),
    mostrarVista,
    mostrarMenu: () => mostrarVista(nodo('vista-menu'))
  }
  const asignacion = crearAsignacionTickets({
    ...dependencias,
    buscarCosechador: (dni) =>
      fuentes.buscarCosechador
        ? fuentes.buscarCosechador(dni)
        : Promise.resolve({ ...fuentes.cosechador, dni }),
    obtenerColaCompleta: (...args) => fuentes.obtenerColaCompleta?.(...args) ?? [],
    temporizadores: {
      setTimeout(callback, ms) {
        const id = ++timerId
        timers.set(id, { callback, ms })
        return id
      },
      clearTimeout: (id) => timers.delete(id)
    }
  })
  const jaberos = crearRegistroJaberos(dependencias)
  return {
    document,
    nodo,
    fuentes,
    asignacion,
    jaberos,
    timers,
    mensajesAsignacion,
    mensajesJabero,
    cambios,
    teclados,
    enviar: (form, valor, liberar = () => {}) =>
      handlers.get(nodo(form))(valor, liberar),
    abrirAsignacion: () => nodo('btn-menu-asignacion').emitir('click'),
    abrirJaberos: () => nodo('btn-menu-jaberos').emitir('click'),
    mostrarVista,
    ejecutarTemporizador() {
      const entry = timers.entries().next().value
      if (!entry) return
      timers.delete(entry[0])
      entry[1].callback()
    }
  }
}
