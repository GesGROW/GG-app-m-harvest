import { readFileSync } from 'node:fs'
import { documentoVista } from './elementoVista.js'
import { casosDeUsoParaVista } from './casosDeUso.js'
import { crearIngreso } from '../../src/presentation/ingreso/index.js'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

export function ingresoCampo(fuentes = {}, opciones = {}) {
  const document = documentoVista(html)
  const nodo = (id) => document.querySelector(`#${id}`)
  const storage = new Map()
  const consultas = [],
    menus = [],
    errores = [],
    avisos = [],
    teclados = []
  const envios = new Map()
  let limpiezas = 0
  fuentes.operador ??= {
    dni: '47480378',
    nombre: 'Operador',
    campanias: [{ id: 'A' }]
  }
  fuentes.navigator ??= { onLine: true }
  fuentes.validarOperador ??= async () => fuentes.operador
  fuentes.seleccionarCampaniaLocal ??= async (id) => consultas.push(['seleccion', id])
  fuentes.obtenerCacheCampania ??= async (id) => ({ id })
  fuentes.actualizarCacheOperativa ??= async (dni, id) =>
    consultas.push(['cache', dni, id])
  fuentes.sincronizarPendientes ??= async () => {}
  fuentes.esErrorTemporal ??= () => false
  function mostrarVista(vista) {
    for (const item of document.querySelectorAll('.vista')) item.classList.add('oculto')
    vista.classList.remove('oculto')
    consultas.push(['vista', vista.getAttribute('id')])
  }
  const ingreso = crearIngreso({
    document,
    casosDeUso: opciones.casosDeUso ?? casosDeUsoParaVista(fuentes),
    configurarScanner:
      opciones.scanner ?? ((form, _input, enviar) => envios.set(form, enviar)),
    desactivarTecladoManual: (...inputs) => teclados.push(inputs),
    almacenSesion: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    seleccionarCampaniaLocal: (...args) => fuentes.seleccionarCampaniaLocal(...args),
    cerrarSesionDispositivo: () => fuentes.cerrarSesionDispositivo?.(),
    limpiarFlujos: () => limpiezas++,
    mostrarVista,
    mostrarMenu: () => menus.push(ingreso.obtenerOperador().campania.id),
    actualizarEstadoConexion: async () => {},
    esAutorizacionVigente: opciones.esAutorizacionVigente ?? (() => true),
    registrarError: (...args) => errores.push(args),
    avisar: (texto) => avisos.push(texto)
  })
  return {
    ingreso,
    document,
    nodo,
    storage,
    consultas,
    menus,
    errores,
    avisos,
    teclados,
    fuentes,
    limpiezas: () => limpiezas,
    envios,
    enviar: (dni = fuentes.operador.dni) => envios.get(nodo('form-login'))(dni),
    async restaurar(id) {
      storage.set('operador_dni', fuentes.operador.dni)
      if (id) storage.set('campania_id', id)
      await ingreso.restaurar()
    }
  }
}
