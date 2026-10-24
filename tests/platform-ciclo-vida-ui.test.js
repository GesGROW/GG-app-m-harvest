import assert from 'node:assert/strict'
import test from 'node:test'
import { configurarAdministracionComercial } from '../src/modules/administracionComercial.js'
const turno = () => new Promise((resolve) => setImmediate(resolve))
function nodo() {
  const clases = new Set(['oculto']),
    eventos = new Map()
  return {
    value: '',
    textContent: '',
    children: [],
    dataset: {},
    disabled: false,
    classList: {
      add: (c) => clases.add(c),
      remove: (c) => clases.delete(c),
      contains: (c) => clases.has(c),
      toggle: (c, v) => (v ? clases.add(c) : clases.delete(c))
    },
    addEventListener: (tipo, handler) => eventos.set(tipo, handler),
    emitir: (tipo) => eventos.get(tipo)?.({ preventDefault() {} }),
    replaceChildren(...hijos) {
      this.children = hijos
      this.value = ''
    },
    append(...hijos) {
      this.children.push(...hijos)
      if (!this.value && hijos[0]?.value) this.value = hijos[0].value
    }
  }
}
test('vista comercial requiere delegación, conserva ID al reintentar, programa y muestra historial con texto seguro', async () => {
  const ids = [
    'btn-cuenta-comercial',
    'cuenta-comercial',
    'form-cuenta-comercial',
    'cuenta-comercial-mensaje',
    'cuenta-comercial-resumen',
    'cuenta-comercial-historial',
    'cuenta-comercial-accion',
    'cuenta-comercial-operacion',
    'cuenta-comercial-plan',
    'cuenta-comercial-motivo',
    'cuenta-comercial-effective',
    'cuenta-comercial-hasta',
    'cuenta-comercial-estado',
    'cuenta-comercial-modulo',
    'cuenta-comercial-origen',
    'btn-cuenta-comercial-aplicar',
    'btn-cuenta-comercial-nueva',
    'btn-cuenta-comercial-refrescar'
  ]
  const nodes = Object.fromEntries(ids.map((id) => [id, nodo()]))
  nodes['cuenta-comercial'].querySelectorAll = () => []
  let permitido = false,
    falla = true
  const comandos = [],
    evil = '<img src=x onerror=alert(1)>'
  const previo = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: nodo }
  })
  try {
    const ui = configurarAdministracionComercial({
      vista: { querySelector: (s) => nodes[s.slice(1)] },
      comercial: {
        puedeAdministrar: async () => permitido,
        consultar: async () => ({
          estado: {
            suscripcion: { plan_id: 'P', estado: 'ACTIVA', hasta: null },
            modulos: []
          },
          planes: [{ id: 'P', nombre: 'Piloto' }],
          programados: [],
          historial: [
            {
              fecha_hora: '2026-10-14',
              tipo_evento: 'CAMBIAR_PLAN',
              fase: 'PROGRAMADA',
              effective_at: '2030-01-01',
              actor: { usuarioId: 'U' },
              estado_anterior: { suscripcion: null },
              estado_nuevo: { suscripcion: null },
              motivo: evil,
              contexto: {}
            }
          ]
        }),
        cambiarPlan: async (datos) => {
          comandos.push(datos)
          if (falla) throw new Error('Respuesta perdida')
          return { fase: 'PROGRAMADA', effectiveAt: '2030-01-01' }
        }
      }
    })
    await ui.activar()
    assert.ok(nodes['btn-cuenta-comercial'].classList.contains('oculto'))
    permitido = true
    await ui.activar()
    assert.ok(!nodes['btn-cuenta-comercial'].classList.contains('oculto'))
    nodes['btn-cuenta-comercial'].emitir('click')
    await turno()
    assert.ok(!nodes['cuenta-comercial'].classList.contains('oculto'))
    const cells =
      nodes['cuenta-comercial-historial'].children[0].children[1].children[0].children
    assert.equal(cells.at(-1).textContent, evil)
    nodes['cuenta-comercial-accion'].value = 'cambiarPlan'
    nodes['cuenta-comercial-motivo'].value = 'Acuerdo'
    nodes['cuenta-comercial-effective'].value = '2030-01-01T12:00'
    await nodes['form-cuenta-comercial'].emitir('submit')
    const id = comandos[0].operacionId
    assert.match(nodes['cuenta-comercial-mensaje'].textContent, /perdida/)
    falla = false
    await nodes['form-cuenta-comercial'].emitir('submit')
    assert.equal(comandos[1].operacionId, id)
    assert.match(nodes['cuenta-comercial-mensaje'].textContent, /programado/)
    nodes['btn-cuenta-comercial-nueva'].emitir('click')
    assert.notEqual(nodes['cuenta-comercial-operacion'].value, id)
    ui.ocultar()
    assert.ok(nodes['cuenta-comercial'].classList.contains('oculto'))
    assert.equal(nodes['cuenta-comercial-historial'].children.length, 0)
  } finally {
    if (previo) Object.defineProperty(globalThis, 'document', previo)
    else delete globalThis.document
  }
})
