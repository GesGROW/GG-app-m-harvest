import { snapshotHarvest } from './helpers/snapshotHarvest.js'
import { casosDeUsoParaVista } from './helpers/casosDeUso.js'
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { beforeEach } from 'node:test'
import vm from 'node:vm'
import { openDB } from 'idb'
import * as local from '../src/offline/db.js'
import * as asignados from '@gesgrow/core/contexts/harvest/application/queries/asignadosHoy.js'
import * as jaberos from '@gesgrow/core/contexts/workforce/application/queries/jaberosCampania.js'
import * as cosechadores from '@gesgrow/core/contexts/harvest/application/queries/cosechadoresJabas.js'
import * as sesiones from '@gesgrow/core/contexts/harvest/application/queries/sesionesLectura.js'
import { nombreCosechadorVisible } from '../src/modules/cosechadorLocal.js'
import { crearSupabaseBackend } from '../src/infrastructure/supabase/backendAdapter.js'

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
const main = read('../src/main.js')
const html = read('../index.html')
const base = (trabajadores = [], tickets = []) => ({
  campania: { id: 'campania-test', nombre: 'Campaña 2026', estado: 'ACTIVA' },
  sincronizado_en: new Date().toISOString(),
  trabajadores,
  tickets,
  lotes: []
})
beforeEach(async () => {
  await local.seleccionarCampaniaLocal('campania-test')
  const db = await openDB('scc', 5)
  const tx = db.transaction([...db.objectStoreNames], 'readwrite')
  for (const name of db.objectStoreNames) await tx.objectStore(name).clear()
  await tx.done
  db.close()
  await local.guardarCache(base())
})

function element() {
  const classes = new Set()
  const attributes = new Map()
  const selected = new Map()
  return {
    value: '',
    textContent: '',
    className: '',
    children: [],
    disabled: false,
    dataset: {},
    classList: {
      add: (...items) => items.forEach((c) => classes.add(c)),
      remove: (...items) => items.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle(c, value = !classes.has(c)) {
        value ? classes.add(c) : classes.delete(c)
      }
    },
    append(...items) {
      this.children.push(...items)
    },
    replaceChildren(...items) {
      this.children = items
    },
    querySelector(selector) {
      if (!selected.has(selector)) selected.set(selector, element())
      return selected.get(selector)
    },
    querySelectorAll() {
      return this.children
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name),
    focus() {},
    select() {},
    addEventListener() {}
  }
}

function consulta(id, consultar = async () => ({ data: base() })) {
  const nodes = Object.fromEntries(
    [
      'tituloConsultaHeader',
      'btnActualizarConsulta',
      'consultaFeedback',
      'consultaBusqueda',
      'consultaChips',
      'consultaContador',
      'consultaTablaHead',
      'consultaTablaBody',
      'consultaEmpty',
      'consultaEmptyAccion',
      'vistaConsulta'
    ].map((n) => [n, element()])
  )
  const calls = []
  const ctx = vm.createContext({
    ...nodes,
    ...local,
    ...asignados,
    ...jaberos,
    ...cosechadores,
    ...sesiones,
    nombreCosechadorVisible,
    document: { createElement: element },
    operador: { dni: '47480378', campania: { id: 'campania-test' } },
    consultaActual: null,
    ticketsConsultaActual: [],
    trabajadoresConsultaActual: [],
    sesionLectura: null,
    sesionesConsultaActual: [],
    cosechadoresJabasActual: [],
    ordenCosechadoresJabas: cosechadores.ORDEN_COSECHADORES_JABAS.MAS_JABAS,
    filtroSesionesLectura: sesiones.FILTROS_SESIONES_LECTURA.TODAS,
    navigator: { onLine: true },
    mostrarVista() {},
    backend: crearSupabaseBackend({
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'harvest_obtener_snapshot')
          return {
            data: snapshotHarvest({
              campaniaId: args.p_campania_id,
              operadorDni: args.p_dni_operador,
              codigos: []
            })
          }
        return consultar()
      }
    })
  })
  const cache = read('../src/modules/cacheOperativa.js')
  vm.runInContext(
    cache.slice(cache.indexOf('export async')).replace('export ', ''),
    ctx
  )
  vm.runInContext(
    main.slice(
      main.indexOf('async function mostrarConsulta('),
      main.indexOf('function abrirDetalleSesionLectura(')
    ),
    ctx
  )
  vm.runInContext(
    main.slice(
      main.indexOf('async function actualizarConsultaOperativa('),
      main.indexOf("btnActualizarConsulta.addEventListener('click'")
    ),
    ctx
  )
  return {
    ctx,
    nodes,
    calls,
    abrir: () =>
      ctx.mostrarConsulta({
        id,
        titulo: id === 'asignados-hoy' ? 'Asignados hoy' : 'Jaberos de campaña'
      }),
    actualizar: () => ctx.actualizarConsultaOperativa(),
    nombres: () =>
      nodes.consultaTablaBody.children.map((r) => r.children[0].children[0].textContent)
  }
}

for (const id of [
  'asignados-hoy',
  'jaberos-campania',
  'buscar-asignacion',
  'buscar-jabero'
]) {
  test(`${id}: AppBar suficiente, sin introducción ni filtros, con búsqueda y Actualizar`, async () => {
    const vista = consulta(id)
    await vista.abrir()
    assert.equal(vista.nodes.consultaChips.classList.contains('oculto'), true)
    assert.equal(vista.nodes.consultaChips.children.length, 0)
    assert.equal(vista.nodes.btnActualizarConsulta.classList.contains('oculto'), false)
    assert.equal(vista.nodes.consultaBusqueda.disabled, false)
    assert.equal(vista.nodes.consultaContador.classList.contains('oculto'), false)
    assert.ok(vista.nodes.tituloConsultaHeader.textContent)
    const bloque = html.slice(html.indexOf('<section id="vista-consulta"'))
    assert.doesNotMatch(bloque, /<h1|class="eyebrow"|consulta-introduccion/)
    assert.doesNotMatch(bloque, /aria-label="Filtros"|href="#icon-filter"/)
    const boton = bloque.match(
      /<button\s+id="btn-actualizar-consulta"[\s\S]*?<\/button>/
    )[0]
    assert.match(boton, /aria-label="Actualizar"/)
    assert.match(boton, /href="#icon-refresh"/)
    assert.doesNotMatch(boton, />\s*Actualizar\s*</)
  })
}

test('éxito de asignación online y offline dice exactamente Ticket C71048263 asignado', async () => {
  const start = main.indexOf('configurarEnvioScanner(formTicket,')
  const end = main.indexOf('// REGISTRO DE JABEROS', start)
  for (const onLine of [true, false]) {
    let handler
    const mensajes = []
    const ctx = {
      configurarEnvioScanner: (_form, _input, callback) => {
        handler = callback
      },
      formTicket: {},
      codigoTicketInput: element(),
      limpiarResultado() {},
      operador: { dni: '47480378' },
      cosechador: { dni: '43829105', nombre: 'Fausto Rodríguez' },
      obtenerTicket: async () => null,
      existeTicketPendiente: async () => false,
      guardarAsignacionOffline: async () => {},
      navigator: { onLine },
      mostrarResultado: (mensaje, tipo) => mensajes.push({ mensaje, tipo }),
      desactivarTecladoManual() {},
      setTimeout() {},
      prepararSiguienteCosechador() {},
      actualizarEstadoConexion: async () => {},
      sincronizarPendientes: async () => {}
    }
    ctx.casosDeUso = casosDeUsoParaVista(ctx)
    vm.runInNewContext(main.slice(start, end), ctx)
    await handler('C71048263', () => {})
    assert.deepEqual(mensajes, [
      { mensaje: 'Ticket C71048263 asignado', tipo: 'exito' }
    ])
    assert.doesNotMatch(mensajes[0].mensaje, /pendiente|guardado|sin conexión/i)
  }
})

test('Actualizar recibe nombre oficial y lo renderiza inmediatamente en asignación pendiente', async () => {
  const op = await local.guardarAsignacionOffline({
    codigoTicket: 'C71048263',
    cosechadorDni: '43829105',
    cosechador: 'DNI 43829105',
    dniOperador: '47480378'
  })
  const vista = consulta('asignados-hoy', async () => ({
    data: base([
      {
        dni: '43829105',
        nombre: 'Fausto Rodríguez',
        activo: true,
        roles: ['COSECHADOR']
      }
    ])
  }))
  await vista.abrir()
  assert.deepEqual(vista.nombres(), ['DNI 43829105'])
  await vista.actualizar()
  assert.deepEqual(vista.nombres(), ['Fausto Rodríguez'])
  assert.equal(vista.calls[0].name, 'obtener_cache_operativa_campania')
  assert.equal(vista.calls[0].args.p_dni_operador, '47480378')
  assert.equal((await local.obtenerTicket('C71048263')).estado_sync, 'PENDIENTE')
  assert.equal((await local.obtenerColaCompleta())[0].id, op.id)
  assert.equal(vista.nodes.btnActualizarConsulta.disabled, false)
})

test('Actualizar conserva ticket ERROR, sus detalles y recibo local mientras cambia nombre', async () => {
  const op = await local.guardarAsignacionOffline({
    codigoTicket: 'ERROR-1',
    cosechadorDni: '43829105',
    cosechador: 'DNI 43829105',
    dniOperador: '47480378'
  })
  await local.marcarTicketError('ERROR-1', 'Ticket rechazado')
  await local.marcarOperacionError(op.id, 'Ticket rechazado')
  const colaAntes = await local.obtenerColaCompleta()
  const vista = consulta('asignados-hoy', async () => ({
    data: base(
      [{ dni: '43829105', nombre: 'Fausto Rodríguez', roles: ['COSECHADOR'] }],
      [{ codigo_ticket: 'ERROR-1', cosechador_dni: '43829105', cosechador: '' }]
    )
  }))
  await vista.abrir()
  await vista.actualizar()
  assert.deepEqual(vista.nombres(), ['Fausto Rodríguez'])
  const t = await local.obtenerTicket('ERROR-1')
  assert.equal(t.estado_sync, 'ERROR')
  assert.equal(t.error, 'Ticket rechazado')
  assert.equal(t.operacion_id, op.id)
  assert.deepEqual(await local.obtenerColaCompleta(), colaAntes)
})

test('jabero nuevo offline crea provisional y una operación; escaneo repetido no duplica', async () => {
  const op = await local.registrarJaberoOffline('47480378', '76338971')
  const t = await local.obtenerTrabajador('76338971')
  assert.equal(t.nombre, 'DNI 76338971')
  assert.equal(t.activo, true)
  assert.deepEqual(t.roles, ['JABERO'])
  assert.equal(t.estado_sync_jabero, 'PENDIENTE')
  assert.equal(t.provisional_local, true)
  assert.equal(op.tipo, 'REGISTRAR_JABERO')
  assert.equal((await local.obtenerColaCompleta()).length, 1)
  await assert.rejects(
    local.registrarJaberoOffline('47480378', '76338971'),
    /ya está registrado/
  )
  assert.equal((await local.obtenerColaCompleta()).length, 1)
})

test('jaberos muestra Activo e Inactivo y conserva Pendiente y Error al refrescar', async () => {
  const trabajadores = [
    { dni: '80000001', nombre: 'Ana', activo: true, roles: ['JABERO'] },
    { dni: '80000002', nombre: 'Bruno', activo: false, roles: ['JABERO'] },
    { dni: '80000003', nombre: 'Carla', activo: true, roles: [] },
    { dni: '80000004', nombre: 'Diego', activo: true, roles: [] }
  ]
  await local.guardarCache(base(trabajadores))
  await local.registrarJaberoOffline('47480378', '80000003')
  const rechazo = await local.registrarJaberoOffline('47480378', '80000004')
  await local.marcarJabero('80000004', 'ERROR', rechazo.id)
  await local.marcarOperacionError(rechazo.id, 'Registro rechazado')
  const vista = consulta('jaberos-campania', async () => ({
    data: base(trabajadores.slice(0, 2))
  }))
  const estados = () =>
    vista.nodes.consultaTablaBody.children.map(
      (fila) => fila.children[2].children[0].textContent
    )
  await vista.abrir()
  assert.deepEqual(estados(), ['Activo', 'Inactivo', 'Pendiente', 'Error'])
  await vista.actualizar()
  assert.deepEqual(estados(), ['Activo', 'Inactivo', 'Pendiente', 'Error'])
  vista.nodes.consultaBusqueda.value = '80000003'
  vista.ctx.renderJaberosCampania()
  assert.deepEqual(estados(), ['Pendiente'])
})

test('un jabero de campaña puede reasignarse sin duplicar el rol local', async () => {
  await local.guardarCache(
    base([{ dni: '76338971', nombre: 'Marco', activo: true, roles: ['JABERO'] }])
  )
  const primera = await local.registrarJaberoOffline('47480378', '76338971')
  await local.marcarJabero('76338971', 'SINCRONIZADO', primera.id)
  await local.marcarOperacionSincronizada(primera.id)
  const segunda = await local.registrarJaberoOffline('47480378', '76338971')
  assert.notEqual(primera.id, segunda.id)
  assert.deepEqual((await local.obtenerTrabajador('76338971')).roles, ['JABERO'])
  assert.equal(
    (await local.obtenerTrabajador('76338971')).estado_sync_jabero,
    'PENDIENTE'
  )
})

for (const estado of ['PENDIENTE', 'ERROR']) {
  test(`refresco conserva jabero ${estado} ausente del servidor; nombre oficial reemplaza fallback`, async () => {
    const op = await local.registrarJaberoOffline('47480378', '76338971')
    if (estado === 'ERROR') {
      await local.marcarJabero('76338971', 'ERROR', op.id)
      await local.marcarOperacionError(op.id, 'Rechazo')
    }
    await local.guardarCache(base())
    const vista = consulta('jaberos-campania', async () => ({
      data: base([
        { dni: '76338971', nombre: 'Marco Góngora', activo: true, roles: ['JABERO'] }
      ])
    }))
    await vista.abrir()
    assert.deepEqual(vista.nombres(), ['DNI 76338971'])
    await vista.actualizar()
    assert.deepEqual(vista.nombres(), ['Marco Góngora'])
    const t = await local.obtenerTrabajador('76338971')
    assert.equal(t.estado_sync_jabero, estado)
    assert.equal(t.operacion_jabero_id, op.id)
    assert.equal(t.provisional_local, undefined)
    assert.equal((await local.obtenerColaCompleta())[0].estado, estado)
  })
}

test('nombre oficial también reemplaza fallback de ticket confirmado', async () => {
  const vista = consulta('asignados-hoy', async () => ({
    data: base(
      [{ dni: '43829105', nombre: 'Fausto Rodríguez', roles: ['COSECHADOR'] }],
      [
        {
          codigo_ticket: 'C71048263',
          cosechador_dni: '43829105',
          cosechador: '',
          fecha_asignacion: new Date().toISOString()
        }
      ]
    )
  }))
  await vista.abrir()
  await vista.actualizar()
  assert.deepEqual(vista.nombres(), ['Fausto Rodríguez'])
})

test('Actualizar preserva búsqueda y maneja fallo remoto sin borrar datos', async () => {
  await local.guardarCache(
    base([{ dni: '76338971', nombre: 'Marco Góngora', roles: ['JABERO'] }])
  )
  const vista = consulta('jaberos-campania', async () => ({
    error: { message: 'No se pudo conectar' }
  }))
  await vista.abrir()
  vista.nodes.consultaBusqueda.value = 'Marco'
  await vista.actualizar()
  assert.equal(vista.nodes.consultaBusqueda.value, 'Marco')
  assert.deepEqual(vista.nombres(), ['Marco Góngora'])
  assert.equal(vista.nodes.consultaFeedback.textContent, 'No se pudo conectar')
  assert.equal(vista.nodes.btnActualizarConsulta.disabled, false)
  assert.equal((await local.obtenerTrabajador('76338971')).nombre, 'Marco Góngora')
})

test('Actualizar offline informa el motivo, no consulta Supabase ni pierde provisionales', async () => {
  await local.registrarJaberoOffline('47480378', '76338971')
  const vista = consulta('jaberos-campania')
  await vista.abrir()
  vista.ctx.navigator.onLine = false
  await vista.actualizar()
  assert.equal(vista.calls.length, 0)
  assert.match(vista.nodes.consultaFeedback.textContent, /Sin conexión/)
  assert.deepEqual(vista.nombres(), ['DNI 76338971'])
})

test('dos Actualizar simultáneos hacen una consulta y no renderizan una vista abandonada', async () => {
  let resolve
  const vista = consulta(
    'jaberos-campania',
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  await vista.abrir()
  const primero = vista.actualizar()
  await vista.actualizar()
  assert.equal(vista.calls.length, 1)
  vista.ctx.consultaActual = { id: 'otra-vista' }
  resolve({ data: base([{ dni: '76338971', nombre: 'Marco', roles: ['JABERO'] }]) })
  await primero
  assert.deepEqual(vista.nombres(), [])
  assert.equal(vista.nodes.btnActualizarConsulta.disabled, false)
})

test('alta offline rechaza DNI inválido, inactivo y campaña cerrada sin encolar', async () => {
  await assert.rejects(local.registrarJaberoOffline('47480378', 'abc'), /8 dígitos/)
  await local.guardarCache(
    base([{ dni: '76338971', nombre: '', roles: [], activo: false }])
  )
  await assert.rejects(local.registrarJaberoOffline('47480378', '76338971'), /inactivo/)
  await local.guardarCache({ ...base(), campania: { estado: 'CERRADA' } })
  await assert.rejects(
    local.registrarJaberoOffline('47480378', '76338972'),
    /campaña activa/
  )
  assert.equal((await local.obtenerColaCompleta()).length, 0)
})

test('Registrar Jabero permite DNI desconocido desde el formulario online y offline', async () => {
  const start = main.indexOf('configurarEnvioScanner(formJabero,')
  const end = main.indexOf('// NAVEGACIÓN', start)
  for (const onLine of [true, false]) {
    let handler
    const mensajes = []
    const ctx = {
      ...local,
      nombreCosechadorVisible,
      configurarEnvioScanner: (_form, _input, callback) => {
        handler = callback
      },
      esDniValido: (dni) => /^\d{8}$/.test(dni),
      formJabero: {},
      dniJaberoInput: element(),
      limpiarResultadoJabero() {},
      operador: { dni: '47480378' },
      navigator: { onLine },
      mostrarResultadoJabero: (mensaje, tipo) => mensajes.push({ mensaje, tipo }),
      desactivarTecladoManual() {},
      actualizarEstadoConexion: async () => {},
      sincronizarPendientes: async () => {}
    }
    ctx.casosDeUso = casosDeUsoParaVista(ctx)
    vm.runInNewContext(main.slice(start, end), ctx)
    const dni = onLine ? '76338980' : '76338981'
    await handler(dni, () => {})
    assert.deepEqual(mensajes, [
      { mensaje: `DNI ${dni} registrado como jabero`, tipo: 'exito' }
    ])
    assert.equal((await local.obtenerTrabajador(dni)).estado_sync_jabero, 'PENDIENTE')
  }
  assert.equal((await local.obtenerColaCompleta()).length, 2)
})

test('respuesta inválida o fallo de escritura aborta refresco sin perder datos locales', async () => {
  await local.registrarJaberoOffline('47480378', '76338971')
  await local.guardarAsignacionOffline({
    codigoTicket: 'C71048263',
    cosechadorDni: '43829105',
    cosechador: 'DNI 43829105',
    dniOperador: '47480378'
  })
  const trabajadores = await local.obtenerTrabajadores()
  const tickets = await local.obtenerTickets()
  const cola = await local.obtenerColaCompleta()
  for (const data of [{ ...base(), trabajadores: null }, base([{}])]) {
    const vista = consulta('asignados-hoy', async () => ({ data }))
    await vista.abrir()
    await vista.actualizar()
    assert.ok(vista.nodes.consultaFeedback.textContent)
    assert.deepEqual(await local.obtenerTrabajadores(), trabajadores)
    assert.deepEqual(await local.obtenerTickets(), tickets)
    assert.deepEqual(await local.obtenerColaCompleta(), cola)
  }
})

test('fallback de trabajador no sobrescribe un nombre real en tickets al refrescar', async () => {
  await local.guardarAsignacionOffline({
    codigoTicket: 'C71048263',
    cosechadorDni: '43829105',
    cosechador: 'Fausto Rodríguez',
    dniOperador: '47480378'
  })
  await local.guardarCache(
    base([{ dni: '43829105', nombre: 'DNI 43829105', roles: ['COSECHADOR'] }])
  )
  assert.equal((await local.obtenerTicket('C71048263')).cosechador, 'Fausto Rodríguez')
})

test('Buscar asignación incluye días anteriores y busca por DNI, nombre o ticket', async () => {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - 1)
  await local.guardarCache(
    base(
      [],
      [
        {
          codigo_ticket: 'AYER-01',
          cosechador_dni: '43829105',
          cosechador: 'Fausto Rodríguez',
          fecha_asignacion: fecha.toISOString()
        }
      ]
    )
  )
  const vista = consulta('buscar-asignacion')
  await vista.abrir()
  assert.deepEqual(vista.nombres(), ['Fausto Rodríguez'])
  for (const busqueda of ['43829105', 'fausto', 'ayer-01']) {
    vista.nodes.consultaBusqueda.value = busqueda
    vista.ctx.renderAsignadosHoy()
    assert.deepEqual(vista.nombres(), ['Fausto Rodríguez'])
  }
  const hoy = consulta('asignados-hoy')
  await hoy.abrir()
  assert.deepEqual(hoy.nombres(), [])
})

test('Buscar jabero usa la lista local y Actualizar muestra el nombre oficial', async () => {
  await local.registrarJaberoOffline('47480378', '76338971')
  const vista = consulta('buscar-jabero', async () => ({
    data: base([
      { dni: '76338971', nombre: 'Marco Góngora', roles: ['JABERO'], activo: true }
    ])
  }))
  await vista.abrir()
  assert.deepEqual(vista.nombres(), ['DNI 76338971'])
  vista.nodes.consultaBusqueda.value = '76338971'
  await vista.actualizar()
  assert.deepEqual(vista.nombres(), ['Marco Góngora'])
  assert.equal(vista.nodes.consultaBusqueda.value, '76338971')
})

test('Cosechadores y jabas refresca nombres y conserva el orden operativo', async () => {
  await local.guardarLecturaLocal({
    id: 'lectura-test',
    sesion_id: 'sesion-test',
    cosechador_dni: '43829105',
    cosechador: 'DNI 43829105',
    fecha_hora: new Date().toISOString(),
    estado_sync: 'PENDIENTE'
  })
  const vista = consulta('cosechadores-jabas', async () => ({
    data: base([{ dni: '43829105', nombre: 'Fausto Rodríguez', roles: ['COSECHADOR'] }])
  }))
  vista.ctx.sesionLectura = { sesion_id: 'sesion-test' }
  await vista.abrir()
  assert.deepEqual(vista.nombres(), ['DNI 43829105'])
  assert.equal(vista.nodes.btnActualizarConsulta.classList.contains('oculto'), false)
  vista.ctx.ordenCosechadoresJabas = cosechadores.ORDEN_COSECHADORES_JABAS.AZ
  await vista.actualizar()
  assert.deepEqual(vista.nombres(), ['Fausto Rodríguez'])
  assert.equal(
    vista.ctx.ordenCosechadoresJabas,
    cosechadores.ORDEN_COSECHADORES_JABAS.AZ
  )
  assert.equal(
    vista.nodes.consultaChips.children[2].getAttribute('aria-pressed'),
    'true'
  )
  assert.equal((await local.obtenerLecturasSesion('sesion-test')).length, 1)
})

test('Sesiones refresca nombres y conserva Activas/Cerradas sin perder lecturas locales', async () => {
  await local.guardarSesionLocal({
    id: 'sesion-test',
    dni_operador: '47480378',
    dni_jabero: '76338971',
    jabero: 'DNI 76338971',
    estado: 'ACTIVA',
    fecha_inicio: new Date().toISOString()
  })
  const vista = consulta('sesiones-lectura', async () => ({
    data: base([{ dni: '76338971', nombre: 'Marco Góngora', roles: ['JABERO'] }])
  }))
  await vista.abrir()
  vista.ctx.filtroSesionesLectura = sesiones.FILTROS_SESIONES_LECTURA.ACTIVAS
  await vista.actualizar()
  assert.deepEqual(vista.nombres(), ['Marco Góngora'])
  assert.equal(
    vista.ctx.filtroSesionesLectura,
    sesiones.FILTROS_SESIONES_LECTURA.ACTIVAS
  )
  assert.equal(
    vista.nodes.consultaChips.children[1].getAttribute('aria-pressed'),
    'true'
  )
  vista.ctx.navigator.onLine = false
  await vista.actualizar()
  assert.equal(vista.calls.length, 2)
  assert.deepEqual(vista.nombres(), ['Marco Góngora'])
})

test('cada reporte conserva AppBar, contexto de campaña y refresco solo por icono', () => {
  for (const id of [
    'vista-reportes',
    'vista-resumen-campania',
    'vista-ranking-cosechadores',
    'vista-produccion-diaria',
    'vista-produccion-lotes'
  ]) {
    const inicio = html.indexOf(`<section id="${id}"`)
    const bloque = html.slice(inicio, html.indexOf('</section>', inicio))
    assert.match(bloque, /app-header__title/)
    assert.doesNotMatch(bloque, /<h1|class="eyebrow"/)
    if (id === 'vista-reportes') continue
    assert.match(bloque, /class="report-context"/)
    const boton = bloque.match(/<button\s+id="btn-actualizar-[\s\S]*?<\/button>/)[0]
    assert.match(boton, /href="#icon-refresh"/)
    assert.match(boton, /aria-label="Actualizar/)
    assert.doesNotMatch(boton, />\s*Actualizar\s*</)
  }
})
