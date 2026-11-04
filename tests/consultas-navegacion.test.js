import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { crearConsultasOperativas } from '../src/application/crearConsultasOperativas.js'
import { crearConsultasEnVista } from '../src/presentation/consultas/index.js'
import { crearNavegacionContextual } from '../src/presentation/consultas/navegacion.js'
import { documentoVista } from './helpers/elementoVista.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const operador = { dni: '47480378', campania: { id: 'A' } }
const sesion = {
  id: 'S',
  dni_operador: operador.dni,
  dni_jabero: '80000001',
  lote_id: 'L',
  lote_codigo: 'L-1',
  variedad: 'Hass',
  estado: 'ACTIVA',
  fecha_inicio: '2026-10-30T12:00:00Z'
}

function preparar({ estadoSesion = 'ACTIVA' } = {}) {
  const document = documentoVista(html)
  const nodo = (id) => document.querySelector(`#${id}`)
  const estados = { sesionLectura: null }
  const operaciones = [],
    continuadas = [],
    cambios = [],
    refrescos = []
  const carga = crearConsultasOperativas({
    obtenerOperador: () => operador,
    obtenerSesionLectura: () => estados.sesionLectura,
    lecturas: {
      obtenerAsignacionesTickets: async () => [],
      obtenerTrabajadores: async () => [
        { dni: sesion.dni_jabero, nombre: 'Ana Pérez', roles: ['JABERO'] }
      ],
      obtenerLotes: async () => [{ lote_id: 'L', nombre: 'Campo Norte' }],
      obtenerSesionesOperador: async (dni) => {
        assert.equal(dni, operador.dni)
        return [{ ...sesion, estado: estadoSesion }]
      },
      obtenerLecturasSesion: async () => [
        { sesion_id: 'S', cosechador_dni: '12345678' }
      ]
    },
    actualizarCache: async (...args) => refrescos.push(args)
  })
  const vistas = {
    asignacion: nodo('vista-asignacion'),
    jaberos: nodo('vista-jaberos'),
    lectura: nodo('vista-lectura')
  }
  function mostrarVista(vista) {
    navegacion.alCambiarVista(vista)
    for (const el of [nodo('vista-consulta'), ...Object.values(vistas)])
      el.classList.add('oculto')
    vista.classList.remove('oculto')
    cambios.push(vista)
  }
  const navegacion = crearNavegacionContextual({
    document,
    vistas,
    mostrarVista,
    consultas: carga,
    obtenerOperador: () => operador,
    obtenerSesionLectura: () => estados.sesionLectura,
    estaEnLinea: () => true,
    abrirOperacion: async (contexto) => {
      operaciones.push(contexto)
      mostrarVista(vistas[contexto])
    },
    continuarSesion: async (seleccionada) => {
      continuadas.push(seleccionada)
      mostrarVista(vistas.lectura)
    }
  })
  const botonContexto = (contexto) =>
    document
      .querySelectorAll('.btn-contexto')
      .find((b) => b.dataset.contexto === contexto)
  async function abrir(contexto, indice) {
    const boton = botonContexto(contexto)
    boton.focus()
    await boton.emitir('click')
    if (indice !== undefined)
      await nodo('context-options').children[indice].emitir('click')
  }
  return {
    document,
    nodo,
    abrir,
    botonContexto,
    operaciones,
    continuadas,
    cambios,
    refrescos
  }
}

for (const contexto of ['asignacion', 'jaberos', 'lectura']) {
  test(`${contexto}: menú modal conserva foco, operación y retorno desde la consulta`, async () => {
    const v = preparar()
    const boton = v.botonContexto(contexto)
    await v.abrir(contexto)
    assert.equal(v.nodo('context-overlay').open, true)
    assert.equal(v.document.activeElement, v.nodo('btn-cerrar-contexto'))
    if (contexto === 'asignacion')
      assert.deepEqual(
        v.nodo('context-options').children.map((el) => el.textContent),
        ['Operar', 'Asignados hoy']
      )
    await v.nodo('btn-cerrar-contexto').emitir('click')
    assert.equal(v.document.activeElement, boton)
    await v.abrir(contexto, 0)
    assert.equal(v.nodo('context-overlay').open, false)
    assert.equal(v.operaciones.at(-1), contexto)
    await v.abrir(contexto, 1)
    assert.equal(v.cambios.at(-1), v.nodo('vista-consulta'))
    if (contexto !== 'lectura')
      assert.equal(v.document.activeElement, v.nodo('consulta-busqueda'))
    await v.nodo('btn-volver-consulta').emitir('click')
    assert.equal(v.operaciones.at(-1), contexto)
  })
}

test('sin sesión, Cosechadores explica el estado y permite volver a lectura', async () => {
  const v = preparar()
  await v.abrir('lectura', 1)
  assert.equal(v.nodo('consulta-busqueda').disabled, true)
  assert.match(
    v.nodo('consulta-empty').querySelector('strong').textContent,
    /No hay una sesión/
  )
  assert.equal(v.nodo('consulta-empty-accion').classList.contains('oculto'), false)
  await v.nodo('consulta-empty-accion').emitir('click')
  assert.equal(v.operaciones.at(-1), 'lectura')
})

for (const tecla of ['Enter', ' ']) {
  test(`detalle con ${JSON.stringify(tecla)} conserva nombre de lote, totales y sesión a continuar`, async () => {
    const v = preparar()
    await v.abrir('lectura', 2)
    const fila = v.nodo('consulta-tabla-body').children[0]
    fila.focus()
    const evento = await fila.emitir('keydown', { key: tecla })
    assert.equal(evento.defaultPrevented, true)
    assert.equal(v.nodo('context-overlay').open, true)
    const campos = Object.fromEntries(
      v
        .nodo('context-options')
        .children[0].children.map((grupo) => grupo.children.map((el) => el.textContent))
    )
    assert.equal(campos.Lote, 'Campo Norte')
    assert.equal(campos.Jabero, 'Ana Pérez')
    assert.equal(campos['Total de jabas'], '1')
    await v.nodo('context-options').children[1].emitir('click')
    assert.equal(v.continuadas[0].id, 'S')
    assert.equal(v.continuadas[0].lote_codigo, 'L-1')
    assert.equal(v.nodo('context-overlay').open, false)
    assert.equal(v.cambios.at(-1), v.nodo('vista-lectura'))
  })
}

test('una sesión cerrada muestra detalle sin ofrecer continuar; Escape devuelve el foco', async () => {
  const v = preparar({ estadoSesion: 'CERRADA' })
  await v.abrir('lectura', 2)
  const fila = v.nodo('consulta-tabla-body').children[0]
  fila.focus()
  await fila.emitir('click')
  assert.equal(v.nodo('context-options').children.length, 1)
  await v.nodo('context-overlay').emitir('cancel')
  assert.equal(v.nodo('context-overlay').open, false)
  assert.equal(v.document.activeElement, fila)
  assert.equal(v.continuadas.length, 0)
})

function consultaDemorada(consultas) {
  const document = documentoVista(html)
  const cambios = []
  const controlador = crearConsultasEnVista({
    document,
    consultas,
    obtenerOperador: () => operador,
    obtenerSesionLectura: () => null,
    estaEnLinea: () => true,
    abrirDetalleSesionLectura() {},
    mostrarVista: (vista) => {
      vista.classList.remove('oculto')
      cambios.push(vista)
    }
  })
  return {
    controlador,
    document,
    cambios,
    nodo: (id) => document.querySelector(`#${id}`)
  }
}

for (const rechazar of [false, true]) {
  test(`salir durante una carga inicial ignora ${rechazar ? 'un error tardío' : 'una respuesta tardía'}`, async () => {
    let completar
    const v = consultaDemorada({
      asignaciones: () =>
        new Promise((resolve, reject) => {
          completar = rechazar ? reject : resolve
        })
    })
    const pendiente = v.controlador.abrir({
      id: 'asignados-hoy',
      titulo: 'Asignados hoy'
    })
    v.controlador.alCambiarVista(null)
    completar(rechazar ? new Error('Sin conexión') : [])
    await pendiente
    assert.equal(v.cambios.length, 0)
    assert.equal(v.nodo('consulta-tabla-body').children.length, 0)
  })
}

test('cambiar de consulta durante una lectura local no deja que la anterior pinte o robe foco', async () => {
  let completar
  const v = consultaDemorada({
    asignaciones: () =>
      new Promise((resolve) => {
        completar = resolve
      }),
    jaberos: async () => [{ dni: '80000001', nombre: 'Ana Pérez', roles: ['JABERO'] }]
  })
  const pendiente = v.controlador.abrir({
    id: 'asignados-hoy',
    titulo: 'Asignados hoy'
  })
  await v.controlador.abrir({ id: 'jaberos-campania', titulo: 'Jaberos' })
  completar([])
  await pendiente
  assert.equal(v.cambios.length, 1)
  assert.equal(v.nodo('titulo-consulta-header').textContent, 'Jaberos')
  assert.equal(
    v.nodo('consulta-tabla-body').children[0].children[0].children[0].textContent,
    'Ana Pérez'
  )
  assert.equal(v.document.activeElement, v.nodo('consulta-busqueda'))
})

test('la coordinación descarta lecturas de otra campaña o de un operador anterior', async () => {
  for (const siguiente of [
    null,
    { dni: operador.dni, campania: { id: 'B' } },
    { dni: '80000002', campania: operador.campania }
  ]) {
    let actual = operador,
      completar
    const consultas = crearConsultasOperativas({
      obtenerOperador: () => actual,
      obtenerSesionLectura: () => null,
      lecturas: {
        obtenerTrabajadores: () =>
          new Promise((resolve) => {
            completar = resolve
          })
      }
    })
    const pendiente = consultas.jaberos()
    actual = siguiente
    completar([])
    await assert.rejects(pendiente, /campaña de trabajo cambió/)
  }
})
