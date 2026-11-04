import { readFileSync } from 'node:fs'
import { crearLecturaTickets } from '../../src/presentation/lectura/index.js'
import { casosDeUsoParaVista } from './casosDeUso.js'
import { documentoVista } from './elementoVista.js'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
export function lecturaCampo(fuentes = {}, { scanner } = {}) {
  const document = documentoVista(html)
  const nodo = (id) => document.querySelector(`#${id}`)
  fuentes.operador ??= { dni: '47480378', nombre: 'Operador', campania: { id: 'A' } }
  fuentes.navigator ??= { onLine: false }
  const callbacks = new Map(),
    cambios = [],
    teclados = []
  const consultas = Object.fromEntries(
    Object.entries({
      obtenerLotes: [],
      obtenerTicket: null,
      obtenerTrabajador: null,
      obtenerSesionesActivas: [],
      contarLecturasSesion: 0,
      contarLecturasCosechador: 0,
      obtenerUltimaLecturaSesion: null
    }).map(([nombre, fallback]) => [
      nombre,
      (...args) =>
        fuentes[nombre] ? fuentes[nombre](...args) : Promise.resolve(fallback)
    ])
  )
  const mensajes = []
  const mensaje = nodo('mensaje-modulo-lectura')
  let texto = ''
  Object.defineProperty(mensaje, 'textContent', {
    get: () => texto,
    set: (valor) => {
      texto = valor
      if (valor) mensajes.push(valor)
    }
  })
  function mostrarVista(vista) {
    for (const id of ['vista-menu', 'vista-lectura']) nodo(id).classList.add('oculto')
    vista.classList.remove('oculto')
    cambios.push(vista)
  }
  const lectura = crearLecturaTickets({
    document,
    consultas,
    casosDeUso: fuentes.casosDeUso ?? casosDeUsoParaVista(fuentes),
    obtenerOperador: () => fuentes.operador,
    configurarEnvioScanner(form, input, callback) {
      callbacks.set(form, callback)
      scanner?.(form, input, callback)
    },
    desactivarTecladoManual: (...inputs) => teclados.push(inputs),
    actualizarEstadoConexion: (...args) => fuentes.actualizarEstadoConexion?.(...args),
    mostrarVista,
    mostrarMenu: () => mostrarVista(nodo('vista-menu'))
  })
  const preparada = fuentes.sesionLectura
    ? lectura.continuar(fuentes.sesionLectura)
    : Promise.resolve()
  return {
    document,
    nodo,
    fuentes,
    lectura,
    preparada,
    cambios,
    teclados,
    mensajes,
    mostrarVista,
    enviar: async (form, valor, liberar = () => {}) => {
      await preparada
      return callbacks.get(nodo(form))(valor, liberar)
    },
    abrir: () => nodo('btn-menu-lectura').emitir('click'),
    elementos: Object.fromEntries(
      Object.entries({
        configuracionLectura: 'configuracion-lectura',
        sesionLecturaActiva: 'sesion-lectura-activa',
        sesionJabero: 'sesion-jabero',
        sesionLote: 'sesion-lote',
        sesionVariedad: 'sesion-variedad',
        totalSesion: 'total-sesion',
        etiquetaCosechador: 'etiqueta-cosechador',
        totalCosechador: 'total-cosechador',
        mensajeModuloLectura: 'mensaje-modulo-lectura',
        ticketLectura: 'ticket-lectura',
        estadoLecturaTicket: 'estado-lectura-ticket',
        resultadoLectura: 'resultado-lectura'
      }).map(([nombre, id]) => [nombre, nodo(id)])
    )
  }
}
