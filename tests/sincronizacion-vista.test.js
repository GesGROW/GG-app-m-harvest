import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { crearSincronizacion } from '../src/presentation/sincronizacion/index.js'
import { evaluarDescarteOperacion } from '../src/offline/cola.js'
import { documentoVista } from './helpers/elementoVista.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
function operacion(id, cambios = {}) {
  return {
    id,
    tipo: 'ASIGNAR_TICKET',
    estado: 'ERROR',
    payload: { campaniaId: 'A', codigoTicket: `T-${id}` },
    creado_en: `2026-10-30T10:00:0${id}Z`,
    error: 'No disponible',
    ...cambios
  }
}
function preparar(operaciones = [], extra = {}) {
  const document = documentoVista(html)
  const nodo = (id) => document.querySelector(`#${id}`)
  const estado = {
    operador: { dni: '47480378', campania: { id: 'A' } },
    online: true,
    autorizado: true,
    operaciones,
    descartable: true
  }
  const eventos = [],
    errores = [],
    navegacion = []
  const fuentes = {
    obtenerOperaciones: async () => estado.operaciones,
    contarPendientes: async () =>
      estado.operaciones.filter((op) => op.estado === 'PENDIENTE').length,
    contarErrores: async () =>
      estado.operaciones.filter((op) => op.estado === 'ERROR' && !op.resueltaHarvest)
        .length,
    async reintentar(id) {
      eventos.push(['reintentar', id])
      estado.operaciones = estado.operaciones.map((op) =>
        op.id === id ? { ...op, estado: 'PENDIENTE' } : op
      )
    },
    async descartar(id) {
      eventos.push(['descartar', id])
      if (estado.descartable)
        estado.operaciones = estado.operaciones.filter((op) => op.id !== id)
      return estado.descartable
    },
    evaluarDescarte: evaluarDescarteOperacion,
    ...extra
  }
  function mostrarVista(vista) {
    controlador.alCambiarVista(vista)
    nodo('vista-sync').classList.add('oculto')
    vista.classList.remove('oculto')
    navegacion.push(vista)
  }
  const controlador = crearSincronizacion({
    document,
    obtenerOperador: () => estado.operador,
    verificarVigenciaOperador: () => estado.autorizado && Boolean(estado.operador),
    estaEnLinea: () => estado.online,
    cola: fuentes,
    sincronizar: async () => eventos.push(['sincronizar']),
    actualizarTotalesLectura: async () => eventos.push(['totales']),
    mostrarVista,
    mostrarMenu: () => mostrarVista(nodo('vista-menu')),
    registrarError: (...args) => errores.push(args)
  })
  return {
    document,
    nodo,
    estado,
    eventos,
    errores,
    navegacion,
    fuentes,
    controlador,
    abrir: () => nodo('estado-conexion').emitir('click'),
    salir: () => nodo('btn-volver-sync').emitir('click'),
    tarjetas: () => nodo('operaciones-error').children,
    acciones: (i = 0) => nodo('operaciones-error').children[i].children[2].children
  }
}

test('la lista filtra por campaña, ordena errores y distingue pendientes y conciliadas', async () => {
  const v = preparar([
    operacion('3', { resueltaHarvest: true }),
    operacion('2', { estado: 'PENDIENTE' }),
    operacion('1'),
    operacion('4', { payload: { campaniaId: 'B' } })
  ])
  await v.abrir()
  assert.equal(
    v.nodo('resumen-sync').textContent,
    '1 pendientes · 1 errores · 1 conciliadas'
  )
  assert.equal(v.tarjetas().length, 2)
  assert.match(v.tarjetas()[0].children[1].textContent, /T-1/)
  assert.match(v.tarjetas()[1].children[1].textContent, /T-3/)
  assert.equal(v.acciones(1).length, 1)
  assert.match(v.acciones(1)[0].textContent, /Se conserva como historial/)
  await v.acciones(1)[0].emitir('click')
  assert.equal(v.eventos.length, 0)
  await v.salir()
  assert.equal(v.navegacion.at(-1), v.nodo('vista-menu'))
  assert.equal(v.tarjetas().length, 0)
})

test('sin errores muestra el estado vacío y conserva el total de pendientes', async () => {
  const v = preparar([operacion('1', { estado: 'PENDIENTE' })])
  await v.abrir()
  assert.equal(v.nodo('resumen-sync').textContent, '1 pendientes · 0 errores')
  assert.equal(v.nodo('operaciones-error').textContent, 'No hay operaciones con error.')
})

test('las tarjetas conservan el ocultamiento de DNI y credenciales en el error', async () => {
  const v = preparar([
    operacion('1', {
      tipo: 'REGISTRAR_JABERO',
      payload: { campaniaId: 'A', dniTrabajador: '12345678' },
      error: 'DNI 12345678 Bearer credencial-secreta'
    })
  ])
  await v.abrir()
  const detalle = v.tarjetas()[0].children[1].textContent
  assert.match(detalle, /DNI terminado en 5678/)
  assert.match(detalle, /\*{8}/)
  assert.match(detalle, /Bearer \[oculto\]/)
  assert.doesNotMatch(detalle, /12345678|credencial-secreta/)
})

for (const online of [true, false]) {
  test(`reintentar ${online ? 'online sincroniza' : 'offline conserva pendiente'} y refresca los indicadores`, async () => {
    const v = preparar([operacion('1')])
    v.estado.online = online
    await v.abrir()
    await v.acciones()[0].emitir('click')
    assert.deepEqual(
      v.eventos,
      online
        ? [['reintentar', '1'], ['sincronizar'], ['totales']]
        : [['reintentar', '1'], ['totales']]
    )
    assert.equal(v.nodo('resumen-sync').textContent, '1 pendientes · 0 errores')
    assert.equal(v.estado.operaciones[0].estado, 'PENDIENTE')
  })
}

test('una operación con dependientes no ofrece descarte; una lectura tampoco lo admite', async () => {
  const asignacion = operacion('1')
  const dependiente = operacion('2', {
    tipo: 'REGISTRAR_JABA',
    estado: 'PENDIENTE',
    payload: { campaniaId: 'A', codigoTicket: 'T-1' }
  })
  const lectura = operacion('3', { tipo: 'REGISTRAR_JABA' })
  const v = preparar([asignacion, dependiente, lectura])
  await v.abrir()
  assert.deepEqual(
    v.acciones().map((a) => a.textContent),
    [
      'Reintentar',
      'Esta operación tiene 1 operación dependiente y no puede descartarse.'
    ]
  )
  assert.deepEqual(
    v.acciones(1).map((a) => a.textContent),
    ['Reintentar', 'Esta operación no admite descarte.']
  )
  assert.equal(v.eventos.length, 0)
})

test('descarte permitido usa la operación elegida y actualiza lista y contadores', async () => {
  const v = preparar([operacion('1')])
  await v.abrir()
  assert.equal(v.acciones()[1].textContent, 'Descartar')
  await v.acciones()[1].emitir('click')
  assert.deepEqual(v.eventos, [['descartar', '1'], ['totales']])
  assert.equal(v.estado.operaciones.length, 0)
  assert.equal(v.nodo('resumen-sync').textContent, '0 pendientes · 0 errores')
})

test('si persistencia rechaza un descarte, conserva la tarjeta sin simular la eliminación', async () => {
  const v = preparar([operacion('1')])
  v.estado.descartable = false
  await v.abrir()
  const tarjeta = v.tarjetas()[0]
  await v.acciones()[1].emitir('click')
  assert.equal(v.tarjetas()[0], tarjeta)
  assert.equal(v.estado.operaciones.length, 1)
  assert.deepEqual(v.eventos, [['descartar', '1']])
})

test('dos acciones simultáneas sobre una tarjeta ejecutan una sola mutación', async () => {
  let completar,
    llamadas = 0
  const v = preparar([operacion('1')], {
    reintentar: () => {
      llamadas++
      return new Promise((resolve) => {
        completar = resolve
      })
    }
  })
  await v.abrir()
  const [reintentar, descartar] = v.acciones()
  const pendiente = reintentar.emitir('click')
  assert.equal(reintentar.disabled, true)
  assert.equal(descartar.disabled, true)
  await descartar.emitir('click')
  assert.equal(llamadas, 1)
  assert.equal(v.eventos.length, 0)
  completar()
  await pendiente
})

test('una mutación fallida deja los botones disponibles para reintentar', async () => {
  let llamadas = 0
  const v = preparar([operacion('1')], {
    reintentar: async () => {
      llamadas++
      throw new Error('No se pudo escribir')
    }
  })
  await v.abrir()
  const boton = v.acciones()[0]
  await assert.rejects(boton.emitir('click'), /No se pudo escribir/)
  assert.equal(boton.disabled, false)
  await assert.rejects(boton.emitir('click'), /No se pudo escribir/)
  assert.equal(llamadas, 2)
})

test('una tarjeta anterior no actúa tras salir, cambiar campaña o perder autorización', async () => {
  for (const cambio of ['vista', 'campania', 'autorizacion']) {
    const v = preparar([operacion('1')])
    await v.abrir()
    const boton = v.acciones()[0]
    if (cambio === 'vista') await v.salir()
    if (cambio === 'campania')
      v.estado.operador = { dni: '80000001', campania: { id: 'B' } }
    if (cambio === 'autorizacion') v.estado.autorizado = false
    await boton.emitir('click')
    assert.equal(v.eventos.length, 0)
  }
})

test('una carga tardía de lista no pinta tras cambiar de campaña', async () => {
  let completar
  const v = preparar([], {
    obtenerOperaciones: () =>
      new Promise((resolve) => {
        completar = resolve
      })
  })
  const pendiente = v.abrir()
  await v.salir()
  v.estado.operador = { dni: '80000001', campania: { id: 'B' } }
  completar([operacion('1')])
  await pendiente
  assert.equal(v.tarjetas().length, 0)
  assert.equal(v.nodo('resumen-sync').textContent, '')
  assert.equal(v.navegacion.at(-1), v.nodo('vista-menu'))
})

for (const [online, pendientes, errores, texto, clase] of [
  [false, 2, 1, 'Sin conexión · 2 pendientes', 'offline'],
  [true, 2, 1, '1 error de sincronización', 'error-sync'],
  [true, 2, 3, '3 errores de sincronización', 'error-sync'],
  [true, 1, 0, '1 registro pendiente', 'warning-sync'],
  [true, 2, 0, '2 registros pendientes', 'warning-sync'],
  [true, 0, 0, '', 'oculto']
]) {
  test(`indicador: ${texto || 'sin pendientes'}`, async () => {
    const v = preparar([], {
      contarPendientes: async () => pendientes,
      contarErrores: async () => errores
    })
    v.estado.online = online
    await v.controlador.actualizarEstado()
    assert.equal(v.nodo('estado-conexion').textContent, texto)
    assert.equal(v.nodo('estado-conexion').classList.contains(clase), true)
    assert.deepEqual(v.eventos, [['totales']])
  })
}

test('si falla la lectura de cola offline muestra desconexión y registra el fallo', async () => {
  const v = preparar([], {
    contarPendientes: async () => {
      throw new Error('DB no disponible')
    }
  })
  v.estado.online = false
  await v.controlador.actualizarEstado()
  assert.equal(v.nodo('estado-conexion').textContent, 'Sin conexión')
  assert.equal(v.errores.length, 1)
  assert.equal(v.errores[0][1].message, 'DB no disponible')
})

test('una actualización antigua del indicador no reemplaza el estado más reciente', async () => {
  let completar,
    llamadas = 0
  const v = preparar([], {
    contarPendientes: () =>
      ++llamadas === 1
        ? new Promise((resolve) => {
            completar = resolve
          })
        : Promise.resolve(0)
  })
  const anterior = v.controlador.actualizarEstado()
  await v.controlador.actualizarEstado()
  completar(9)
  await anterior
  assert.equal(v.nodo('estado-conexion').textContent, '')
  assert.equal(v.nodo('estado-conexion').classList.contains('oculto'), true)
  assert.deepEqual(v.eventos, [['totales']])
})

test('sin autorización no abre la pantalla ni lee la cola', async () => {
  let consultas = 0
  const v = preparar([], {
    obtenerOperaciones: async () => {
      consultas++
      return []
    }
  })
  v.estado.autorizado = false
  await v.abrir()
  assert.equal(consultas, 0)
  assert.equal(v.navegacion.length, 0)
})
