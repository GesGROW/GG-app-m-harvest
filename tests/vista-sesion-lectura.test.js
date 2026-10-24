import { casosDeUsoParaVista } from './helpers/casosDeUso.js'
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import {
  contarLecturasCosechador,
  contarLecturasSesion,
  guardarLecturaLocal,
  guardarTicketLocal,
  obtenerTicket,
  obtenerTrabajador,
  obtenerUltimaLecturaSesion
} from '../src/offline/db.js'
import {
  mostrarContadorCosechador,
  actualizarTotalesLecturaEnVista,
  mostrarEstadoLecturaTicket,
  mostrarSesionLecturaEnVista
} from '../src/modules/vistaSesionLectura.js'

const consultas = {
  contarLecturasSesion,
  obtenerUltimaLecturaSesion,
  contarLecturasCosechador,
  obtenerTicket,
  obtenerTrabajador
}

test('reconciliar conteos elimina producción rechazada sin tocar input, foco ni mensaje de rechazo', async () => {
  const elementos = vista()
  elementos.ticketLectura.value = 'ESCANEO-EN-CURSO'
  elementos.resultadoLectura.textContent = 'Ticket rechazado'
  await actualizarTotalesLecturaEnVista(sesion('RECHAZADA'), elementos, {
    contarLecturasSesion: async () => 0,
    obtenerUltimaLecturaSesion: async () => undefined
  })
  assert.equal(elementos.totalSesion.textContent, 0)
  assert.equal(elementos.totalCosechador.textContent, '0')
  assert.equal(elementos.ticketLectura.value, 'ESCANEO-EN-CURSO')
  assert.equal(elementos.ticketLectura.enfocado, false)
  assert.equal(elementos.resultadoLectura.textContent, 'Ticket rechazado')
})

function elemento() {
  const clases = new Set()
  const atributos = new Map()
  const hijos = new Map()
  return {
    textContent: '',
    className: '',
    value: '',
    enfocado: false,
    classList: {
      add: (clase) => clases.add(clase),
      remove: (clase) => clases.delete(clase),
      contains: (clase) => clases.has(clase),
      toggle: (clase, activo) => (activo ? clases.add(clase) : clases.delete(clase))
    },
    setAttribute: (nombre, valor) => atributos.set(nombre, valor),
    getAttribute: (nombre) => atributos.get(nombre),
    querySelector(selector) {
      if (!hijos.has(selector)) hijos.set(selector, elemento())
      return hijos.get(selector)
    },
    select() {
      this.seleccionado = true
    },
    focus() {
      this.enfocado = true
    }
  }
}

function vista() {
  return Object.fromEntries(
    [
      'configuracionLectura',
      'sesionLecturaActiva',
      'sesionJabero',
      'sesionLote',
      'sesionVariedad',
      'totalSesion',
      'etiquetaCosechador',
      'totalCosechador',
      'mensajeModuloLectura',
      'ticketLectura',
      'resultadoLectura',
      'estadoLecturaTicket'
    ].map((nombre) => [nombre, elemento()])
  )
}

function sesion(id) {
  return { sesion_id: id, jabero: 'Juan', lote_codigo: 'L1', variedad: 'Uva' }
}

test('una sesión válida oculta el error previo de configuración', async () => {
  const elementos = vista()
  elementos.mensajeModuloLectura.textContent = 'El DNI debe contener 8 dígitos.'
  elementos.mensajeModuloLectura.className = 'resultado error'
  mostrarEstadoLecturaTicket('Error anterior', elementos)
  await mostrarSesionLecturaEnVista(sesion('ui-sesion-nueva'), elementos, consultas)

  assert.equal(elementos.mensajeModuloLectura.textContent, '')
  assert.equal(elementos.mensajeModuloLectura.className, 'resultado oculto')
  assert.equal(elementos.configuracionLectura.classList.contains('oculto'), true)
  assert.equal(elementos.sesionLecturaActiva.classList.contains('oculto'), false)
  assert.equal(elementos.ticketLectura.enfocado, true)
  assert.equal(elementos.resultadoLectura.textContent, '')
  assert.equal(elementos.resultadoLectura.className, 'resultado oculto')
  assert.equal(
    elementos.estadoLecturaTicket.querySelector('use').getAttribute('href'),
    '#icon-check'
  )
  assert.equal(
    elementos.estadoLecturaTicket.classList.contains('paso-numero--error'),
    false
  )
})

function escaneoSimulado({ onLine = false, errorGuardar = null } = {}) {
  const elementos = vista()
  const lecturas = []
  let procesar
  const contexto = {
    ...elementos,
    formLecturaTicket: {},
    configurarEnvioScanner: (_form, _input, callback) => {
      procesar = callback
    },
    sesionLectura: { sesion_id: 'sesion-ui', dni_jabero: '76338971' },
    operador: { dni: '47480378' },
    obtenerTrabajador: async () => ({ estado_sync_jabero: 'SINCRONIZADO' }),
    obtenerColaCompleta: async () => [],
    obtenerTicket: async (codigo) =>
      codigo === 'VALIDO'
        ? {
            codigo_ticket: codigo,
            cosechador_dni: '43829105',
            cosechador: 'Fausto Rodríguez',
            estado_sync: 'SINCRONIZADO'
          }
        : null,
    crypto: { randomUUID: () => `lectura-${lecturas.length}` },
    registrarLecturaOffline: async (lectura) => {
      if (errorGuardar) throw new Error(errorGuardar)
      lecturas.push(lectura)
    },
    contarLecturasSesion: async () => lecturas.length,
    contarLecturasCosechador: async () => lecturas.length,
    nombreCosechadorVisible: (nombre, dni) => nombre || `DNI ${dni}`,
    mostrarContadorCosechador,
    mostrarEstadoLecturaTicket,
    desactivarTecladoManual() {},
    navigator: { onLine },
    sincronizarPendientes: async () => {},
    actualizarEstadoConexion: async () => {}
  }
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  const inicio = main.indexOf('configurarEnvioScanner(formLecturaTicket,')
  const fin = main.indexOf('btnFinalizarLectura.addEventListener', inicio)
  contexto.casosDeUso = casosDeUsoParaVista(contexto)
  runInNewContext(main.slice(inicio, fin), contexto)
  return {
    elementos,
    lecturas,
    contexto,
    procesar: (codigo) => procesar(codigo, () => {})
  }
}

test('lectura válida online y offline actualiza conteos sin mensaje de éxito y mantiene check', async () => {
  for (const onLine of [true, false]) {
    const { elementos, lecturas, procesar } = escaneoSimulado({ onLine })
    await procesar('VALIDO')
    assert.equal(lecturas.length, 1)
    assert.equal(elementos.totalSesion.textContent, 1)
    assert.equal(elementos.etiquetaCosechador.textContent, 'Fausto Rodríguez')
    assert.equal(elementos.totalCosechador.textContent, '1 jaba')
    assert.equal(elementos.resultadoLectura.textContent, '')
    assert.equal(elementos.resultadoLectura.className, 'resultado oculto')
    assert.equal(
      elementos.estadoLecturaTicket.querySelector('use').getAttribute('href'),
      '#icon-check'
    )
    assert.equal(
      elementos.estadoLecturaTicket.classList.contains('paso-numero--error'),
      false
    )
  }
})

test('ticket no asignado muestra error y cambia indicador a X roja sin registrar jaba', async () => {
  const { elementos, lecturas, procesar } = escaneoSimulado()
  await procesar('NO-ASIGNADO')
  assert.equal(lecturas.length, 0)
  assert.equal(
    elementos.resultadoLectura.textContent,
    'El ticket no está asignado a ningún cosechador.'
  )
  assert.equal(elementos.resultadoLectura.className, 'resultado error')
  assert.equal(
    elementos.estadoLecturaTicket.querySelector('use').getAttribute('href'),
    '#icon-close'
  )
  assert.equal(
    elementos.estadoLecturaTicket.classList.contains('paso-numero--error'),
    true
  )
  assert.equal(
    elementos.estadoLecturaTicket.getAttribute('aria-label'),
    'Error al leer ticket'
  )
  assert.equal(elementos.ticketLectura.seleccionado, true)
})

test('lectura correcta después de error limpia el mensaje y restaura el check', async () => {
  const { elementos, lecturas, procesar } = escaneoSimulado()
  await procesar('NO-ASIGNADO')
  await procesar('VALIDO')
  assert.equal(lecturas.length, 1)
  assert.equal(elementos.resultadoLectura.textContent, '')
  assert.equal(elementos.resultadoLectura.className, 'resultado oculto')
  assert.equal(
    elementos.estadoLecturaTicket.querySelector('use').getAttribute('href'),
    '#icon-check'
  )
  assert.equal(
    elementos.estadoLecturaTicket.classList.contains('paso-numero--error'),
    false
  )
})

test('error al guardar lectura muestra mensaje y X roja', async () => {
  const { elementos, lecturas, procesar } = escaneoSimulado({
    errorGuardar: 'No se pudo guardar la jaba'
  })
  await procesar('VALIDO')
  assert.equal(lecturas.length, 0)
  assert.equal(elementos.resultadoLectura.textContent, 'No se pudo guardar la jaba')
  assert.equal(
    elementos.estadoLecturaTicket.classList.contains('paso-numero--error'),
    true
  )
})

test('ticket con error de sincronización muestra X roja y mantiene rechazo operativo', async () => {
  const { elementos, lecturas, contexto, procesar } = escaneoSimulado()
  contexto.obtenerTicket = async () => ({ estado_sync: 'ERROR' })
  await procesar('VALIDO')
  assert.equal(lecturas.length, 0)
  assert.equal(
    elementos.resultadoLectura.textContent,
    'Este ticket presenta un error de sincronización.'
  )
  assert.equal(
    elementos.estadoLecturaTicket.querySelector('use').getAttribute('href'),
    '#icon-close'
  )
})

test('una sesión sin lecturas muestra el estado inicial neutral', async () => {
  const elementos = vista()
  await mostrarSesionLecturaEnVista(sesion('ui-sesion-vacia'), elementos, consultas)

  assert.equal(elementos.totalSesion.textContent, 0)
  assert.equal(elementos.etiquetaCosechador.textContent, 'Cosechador actual')
  assert.equal(elementos.totalCosechador.textContent, '0')
})

test('una lectura actualiza inmediatamente el nombre y las jabas del cosechador', async () => {
  const elementos = vista()
  const id = 'ui-sesion-escaneo'
  for (const numero of [1, 2]) {
    await guardarLecturaLocal({
      id: `ui-escaneo-${numero}`,
      sesion_id: id,
      codigo_ticket: 'UI-TICKET-ANA',
      cosechador_dni: '80000001',
      cosechador: 'Ana López',
      fecha_hora: `2026-09-29T10:00:0${numero}Z`
    })
    elementos.totalSesion.textContent = await contarLecturasSesion(id)
    mostrarContadorCosechador(
      'Ana López',
      await contarLecturasCosechador(id, '80000001'),
      elementos
    )
  }

  assert.equal(elementos.totalSesion.textContent, 2)
  assert.equal(elementos.etiquetaCosechador.textContent, 'Ana López')
  assert.equal(elementos.totalCosechador.textContent, '2 jabas')
})

test('al restaurar usa la última lectura y resuelve su nombre desde el ticket', async () => {
  const id = 'ui-sesion-restaurada'
  await guardarTicketLocal({
    codigoTicket: 'UI-TICKET-ANA-ANTIGUO',
    cosechadorDni: '80000001',
    cosechador: 'Ana López'
  })
  await guardarTicketLocal({
    codigoTicket: 'UI-TICKET-LUIS',
    cosechadorDni: '80000002',
    cosechador: 'Luis Pérez'
  })
  for (const [numero, codigo, dni] of [
    [1, 'UI-TICKET-ANA-ANTIGUO', '80000001'],
    [2, 'UI-TICKET-LUIS', '80000002'],
    [3, 'UI-TICKET-ANA-ANTIGUO', '80000001']
  ]) {
    await guardarLecturaLocal({
      id: `ui-restaurada-${numero}`,
      sesion_id: id,
      codigo_ticket: codigo,
      cosechador_dni: dni,
      fecha_hora: `2026-09-29T11:00:0${numero}Z`
    })
  }

  const elementos = vista()
  await mostrarSesionLecturaEnVista(sesion(id), elementos, consultas)
  assert.equal(elementos.totalSesion.textContent, 3)
  assert.equal(elementos.etiquetaCosechador.textContent, 'Ana López')
  assert.equal(elementos.totalCosechador.textContent, '2 jabas')
})
