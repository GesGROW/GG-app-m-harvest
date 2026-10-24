import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { configurarVistaAccesoEmpresa } from '../src/modules/accesoEmpresa.js'
import { crearAccesoEmpresa } from '../src/application/accesoEmpresa.js'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const turno = () => new Promise((resolve) => setImmediate(resolve))
function nodo() {
  const eventos = new Map(),
    clases = new Set(['oculto'])
  return {
    value: '',
    textContent: '',
    dataset: {},
    children: [],
    classList: {
      add: (c) => clases.add(c),
      remove: (c) => clases.delete(c),
      contains: (c) => clases.has(c),
      toggle(c, valor) {
        valor ? clases.add(c) : clases.delete(c)
      }
    },
    focus() {},
    append(...hijos) {
      this.children.push(...hijos)
      if (this.value === '' && hijos[0]?.value) this.value = hijos[0].value
    },
    replaceChildren(...hijos) {
      this.children = hijos
      this.value = ''
    },
    addEventListener: (tipo, callback) => eventos.set(tipo, callback),
    emitir(tipo) {
      eventos.get(tipo)?.({ preventDefault() {} })
    }
  }
}
async function escenario(
  tenants,
  pruebas,
  modulos = ['HARVEST', 'WORKFORCE', 'CAMPAIGN']
) {
  const selectors = [
    '#vista-login',
    '#vista-acceso-empresa',
    '#btn-ingreso-cuenta',
    ...Array.from(
      html.matchAll(/id="(cuenta-[^"]+|form-cuenta|btn-cuenta-[^"]+)"/g),
      (m) => '#' + m[1]
    )
  ]
  const nodes = Object.fromEntries(selectors.map((id) => [id, nodo()]))
  for (const [id, permiso] of [
    ['campanias', 'harvest.view'],
    ['trabajadores', 'workforce.manage'],
    ['equipo', 'company.manage'],
    ['reporte', 'reports.view']
  ]) {
    nodes['#btn-cuenta-' + id].dataset.permiso = permiso
    if (id !== 'equipo')
      nodes['#btn-cuenta-' + id].dataset.modulo =
        id === 'trabajadores' ? 'WORKFORCE' : 'HARVEST'
  }
  nodes['#vista-acceso-empresa'].querySelector = (id) => nodes[id]
  nodes['#cuenta-panel'].querySelectorAll = () =>
    Object.values(nodes).filter((n) => n.dataset.permiso)
  const anterior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: (id) => nodes[id],
      querySelectorAll: () => [nodes['#vista-login'], nodes['#vista-acceso-empresa']],
      createElement: nodo
    }
  })
  let autenticado = false,
    selecciones = []
  const identity = {
    iniciarSesion: async () => {
      autenticado = true
    },
    obtenerSesion: async () => (autenticado ? { sujeto: 'S' } : null),
    cerrarSesion: async () => {
      autenticado = false
    }
  }
  const acceso = {
    obtenerIdentidad: async () => ({
      usuario: { id: 'U', nombre: 'Persona sin trabajador' },
      membresias: tenants.map((tenantId) => ({
        id: tenantId,
        usuarioId: 'U',
        tenantId
      })),
      empresas: tenants.map((id) => ({ id, nombre: 'Empresa ' + id }))
    }),
    resolverContexto: async (tenantId) => {
      selecciones.push(tenantId)
      if (!tenants.includes(tenantId)) throw new Error('Empresa no autorizada')
      return {
        usuarioId: 'U',
        membresiaId: tenantId,
        tenantId,
        empresa: 'Empresa ' + tenantId,
        permisos:
          tenantId === 'A'
            ? ['harvest.view', 'reports.view']
            : ['harvest.view', 'workforce.manage']
      }
    },
    listarCampanias: async (tenantId) => [
      { id: 'C-' + tenantId, codigo: tenantId, nombre: 'Campaña' }
    ],
    listarTrabajadores: async () => {
      throw new Error('No debe ejecutarse sin permiso')
    }
  }
  try {
    configurarVistaAccesoEmpresa({
      acceso: crearAccesoEmpresa({
        identity,
        acceso,
        entitlements: {
          puedeUsarModulo: async (_tenant, modulo) => modulos.includes(modulo)
        }
      })
    })
    nodes['#btn-ingreso-cuenta'].emitir('click')
    await turno()
    nodes['#cuenta-email'].value = 'cuenta@example.test'
    nodes['#cuenta-password'].value = 'clave-de-prueba'
    nodes['#form-cuenta'].emitir('submit')
    await turno()
    await pruebas(nodes, selecciones)
  } finally {
    if (anterior) Object.defineProperty(globalThis, 'document', anterior)
    else delete globalThis.document
  }
}
test('cuenta sin trabajador elige entre empresas y muestra acciones por permisos efectivos', async () => {
  await escenario(['A', 'B'], async (nodes, selecciones) => {
    assert.equal(nodes['#cuenta-empresas'].children.length, 2)
    assert.equal(nodes['#cuenta-password'].value, '')
    nodes['#cuenta-empresas'].children[0].emitir('click')
    await turno()
    assert.equal(nodes['#cuenta-empresa-activa'].textContent, 'Empresa A')
    assert.ok(nodes['#btn-cuenta-trabajadores'].classList.contains('oculto'))
    assert.ok(!nodes['#btn-cuenta-reporte'].classList.contains('oculto'))
    // Un click manipulado sobre un botón oculto tampoco concede la capacidad.
    nodes['#btn-cuenta-trabajadores'].emitir('click')
    await turno()
    assert.match(nodes['#cuenta-mensaje'].textContent, /No tiene permiso/)
    nodes['#cuenta-empresas'].children[1].emitir('click')
    await turno()
    assert.equal(nodes['#cuenta-empresa-activa'].textContent, 'Empresa B')
    assert.ok(!nodes['#btn-cuenta-trabajadores'].classList.contains('oculto'))
    assert.ok(nodes['#btn-cuenta-reporte'].classList.contains('oculto'))
    assert.ok(selecciones.includes('A') && selecciones.includes('B'))
  })
})
test('sin membresía no muestra panel autorizado; una empresa se activa sin elección adicional', async () => {
  await escenario([], async (nodes) => {
    assert.match(nodes['#cuenta-mensaje'].textContent, /no tiene una empresa/)
    assert.ok(nodes['#cuenta-panel'].classList.contains('oculto'))
  })
  await escenario(['A'], async (nodes) => {
    assert.equal(nodes['#cuenta-empresa-activa'].textContent, 'Empresa A')
    assert.ok(!nodes['#cuenta-panel'].classList.contains('oculto'))
    nodes['#btn-cuenta-salir'].emitir('click')
    await turno()
    assert.ok(nodes['#vista-acceso-empresa'].classList.contains('oculto'))
    assert.ok(!nodes['#vista-login'].classList.contains('oculto'))
  })
})

test('cuenta con permisos y sin módulos conserva sesión y oculta acciones; click manipulado se rechaza', async () => {
  await escenario(
    ['A'],
    async (nodes) => {
      assert.ok(!nodes['#cuenta-panel'].classList.contains('oculto'))
      assert.match(nodes['#cuenta-modulos'].textContent, /no tiene módulos habilitados/)
      assert.ok(nodes['#btn-cuenta-reporte'].classList.contains('oculto'))
      assert.ok(nodes['#btn-cuenta-campanias'].classList.contains('oculto'))
      assert.equal(nodes['#cuenta-campania'].children.length, 0)
      nodes['#btn-cuenta-campanias'].emitir('click')
      await turno()
      assert.match(nodes['#cuenta-mensaje'].textContent, /no está habilitado/)
    },
    []
  )
})
