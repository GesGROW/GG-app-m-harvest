import { casosDeUsoParaVista } from './helpers/casosDeUso.js'
import assert from 'node:assert/strict'
import { seleccionarVariedadLote } from '@gesgrow/core/contexts/campaign-management/domain/variedadesLote.js'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import {
  configurarEnvioScanner,
  esDniValido,
  normalizarValorScanner
} from '../src/modules/scanner.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const siguienteTurno = () => new Promise((resolve) => setTimeout(resolve, 70))

function elemento() {
  const eventos = new Map()
  return {
    value: '',
    disabled: false,
    focus() {},
    select() {},
    addEventListener(tipo, callback) {
      const callbacks = eventos.get(tipo) ?? []
      callbacks.push(callback)
      eventos.set(tipo, callbacks)
    },
    emitir(tipo, propiedades = {}) {
      const event = {
        currentTarget: this,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true
        },
        ...propiedades
      }
      for (const callback of eventos.get(tipo) ?? []) callback(event)
      return event
    }
  }
}

test('scanner funciona sin insertar panel ni listeners adicionales de diagnóstico', async () => {
  const form = elemento()
  const input = elemento()
  input.ownerDocument = {
    createElement() {
      throw new Error('No debe crear diagnóstico')
    }
  }
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '01748037'
  form.emitir('submit')
  await siguienteTurno()
  assert.deepEqual(valores, ['01748037'])
})

for (const [descripcion, valor, esperado] of [
  ['ocho dígitos', '17480378', '17480378'],
  ['terminador CR', '17480378\r', '17480378'],
  ['terminador LF', '17480378\n', '17480378'],
  ['terminador tab', '17480378\t', '17480378'],
  ['cero inicial', '01748037', '01748037']
]) {
  test(`normaliza DNI con ${descripcion} y conserva el string`, () => {
    const dni = normalizarValorScanner(valor)
    assert.equal(dni, esperado)
    assert.equal(typeof dni, 'string')
    assert.equal(esDniValido(dni), true)
  })
}

for (const valor of ['1748037', '174803789', '1748A378', '1748\r0378']) {
  test(`rechaza DNI inválido ${JSON.stringify(valor)} sin eliminar caracteres`, () => {
    const dni = normalizarValorScanner(valor)
    assert.equal(dni, valor)
    assert.equal(esDniValido(dni), false)
  })
}

test('normaliza valores ausentes a string vacío', () => {
  assert.equal(normalizarValorScanner(null), '')
  assert.equal(normalizarValorScanner(undefined), '')
  assert.equal(esDniValido(''), false)
})

for (const key of ['Enter', '\r', '\n']) {
  test(`el terminador ${JSON.stringify(key)} procesa el DNI completo una vez`, async () => {
    const form = elemento()
    const input = elemento()
    const valores = []
    configurarEnvioScanner(form, input, (dni) => valores.push(dni))
    input.value = '17480378'
    const event = input.emitir('keydown', { key })
    assert.equal(event.defaultPrevented, true)
    await siguienteTurno()
    assert.deepEqual(valores, ['17480378'])
  })
}

test('Enter lee el DOM después de completar la escritura, sin usar un valor anterior', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '1748037'
  input.emitir('keydown', { key: 'Enter' })
  input.value = '17480378\r'
  input.emitir('input')
  assert.deepEqual(valores, [])
  await siguienteTurno()
  assert.deepEqual(valores, ['17480378'])
})

test('espera el último input aunque llegue en otro turno después de Enter', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '1748037'
  input.emitir('keydown', { key: 'Enter' })
  await new Promise((resolve) => setTimeout(resolve, 10))
  input.value = '17480378'
  input.emitir('input', { data: '8', inputType: 'insertText' })
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(valores, ['17480378'])
})

for (const propiedades of [
  { key: 'Unidentified', keyCode: 13 },
  { key: 'Unidentified', code: 'NumpadEnter' },
  { keyCode: 13 }
]) {
  test(`procesa Enter no identificado con ${JSON.stringify(propiedades)}`, async () => {
    const form = elemento()
    const input = elemento()
    const valores = []
    configurarEnvioScanner(form, input, (dni) => valores.push(dni))
    input.value = '01748037'
    const event = input.emitir('keydown', propiedades)
    await siguienteTurno()
    assert.equal(event.defaultPrevented, true)
    assert.deepEqual(valores, ['01748037'])
  })
}

test('un CR recibido por input sin keydown termina el escaneo', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '17480378'
  input.emitir('input', { data: '17480378\r', inputType: 'insertText' })
  await siguienteTurno()
  assert.deepEqual(valores, ['17480378'])
})

test('un salto de línea por beforeinput termina el escaneo sin insertarse', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '17480378'
  const event = input.emitir('beforeinput', {
    data: null,
    inputType: 'insertLineBreak'
  })
  form.emitir('submit')
  await siguienteTurno()
  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(valores, ['17480378'])
})

test('datos y CR juntos en beforeinput se escriben antes de procesar el DOM', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  const event = input.emitir('beforeinput', {
    data: '01748037\r',
    inputType: 'insertText'
  })
  assert.equal(event.defaultPrevented, false)
  input.value = '01748037'
  input.emitir('input', { data: '01748037\r', inputType: 'insertText' })
  await siguienteTurno()
  assert.deepEqual(valores, ['01748037'])
})

test('escribir ocho dígitos sin terminador no envía y el código 229 no es Enter', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '17480378'
  input.emitir('input', { data: '17480378', inputType: 'insertText' })
  input.emitir('keydown', { key: 'Unidentified', keyCode: 229 })
  input.emitir('keydown', { key: '8', keyCode: 13 })
  await siguienteTurno()
  assert.deepEqual(valores, [])
})

test('Enter, beforeinput, input y submit del mismo escaneo se agrupan una sola vez', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '17480378'
  input.emitir('keydown', { key: 'Enter' })
  input.emitir('beforeinput', { data: '\r', inputType: 'insertText' })
  input.emitir('input', { data: '\r', inputType: 'insertText' })
  form.emitir('submit')
  await siguienteTurno()
  assert.deepEqual(valores, ['17480378'])
})

test('keydown, keyup y submit de un escaneo generan una sola ejecución', async () => {
  const form = elemento()
  const input = elemento()
  let ejecuciones = 0
  configurarEnvioScanner(form, input, () => ejecuciones++)
  input.value = '17480378'
  input.emitir('keydown', { key: 'Enter' })
  input.emitir('keyup', { key: 'Enter' })
  const event = form.emitir('submit')
  input.emitir('keydown', { key: 'Enter' })
  assert.equal(event.defaultPrevented, true)
  await siguienteTurno()
  assert.equal(ejecuciones, 1)
})

test('no repite la operación pendiente y permite el siguiente escaneo al terminar', async () => {
  const form = elemento()
  const input = elemento()
  let terminar
  let ejecuciones = 0
  configurarEnvioScanner(form, input, () => {
    ejecuciones++
    return new Promise((resolve) => {
      terminar = resolve
    })
  })
  input.value = '17480378'
  input.emitir('keydown', { key: 'Enter' })
  await siguienteTurno()
  input.emitir('keydown', { key: 'Enter' })
  form.emitir('submit')
  await siguienteTurno()
  assert.equal(ejecuciones, 1)
  terminar()
  await siguienteTurno()
  input.value = '01748037'
  input.emitir('keydown', { key: 'Enter' })
  await siguienteTurno()
  assert.equal(ejecuciones, 2)
  terminar()
})

test('ignora Enter repetido, composición y teclas que no son terminadores', async () => {
  const form = elemento()
  const input = elemento()
  let ejecuciones = 0
  configurarEnvioScanner(form, input, () => ejecuciones++)
  assert.equal(
    input.emitir('keydown', { key: 'Enter', repeat: true }).defaultPrevented,
    true
  )
  assert.equal(
    input.emitir('keydown', { key: 'Enter', isComposing: true }).defaultPrevented,
    false
  )
  assert.equal(input.emitir('keydown', { key: '8' }).defaultPrevented, false)
  await siguienteTurno()
  assert.equal(ejecuciones, 0)
})

test('submit manual usa la misma ruta y conserva el cero inicial', async () => {
  const form = elemento()
  const input = elemento()
  const valores = []
  configurarEnvioScanner(form, input, (dni) => valores.push(dni))
  input.value = '01748037\t'
  form.emitir('submit')
  await siguienteTurno()
  assert.deepEqual(valores, ['01748037'])
})

test('un input deshabilitado no genera operaciones', async () => {
  const form = elemento()
  const input = elemento()
  let ejecuciones = 0
  configurarEnvioScanner(form, input, () => ejecuciones++)
  input.disabled = true
  form.emitir('submit')
  await siguienteTurno()
  assert.equal(ejecuciones, 0)
  input.disabled = false
  input.emitir('keydown', { key: 'Enter' })
  input.disabled = true
  await siguienteTurno()
  assert.equal(ejecuciones, 0)
})

test('permite escanear tras guardar localmente sin esperar la sincronización anterior', async () => {
  const form = elemento()
  const input = elemento()
  const operaciones = []
  configurarEnvioScanner(form, input, (codigo, liberar) => {
    let terminar
    const sincronizacion = new Promise((resolve) => {
      terminar = resolve
    })
    operaciones.push({ codigo, liberar, terminar })
    return sincronizacion
  })
  input.value = 'TICKET-1'
  input.emitir('keydown', { key: 'Enter' })
  await siguienteTurno()
  operaciones[0].liberar()
  input.value = 'TICKET-2'
  input.emitir('keydown', { key: 'Enter' })
  await siguienteTurno()
  assert.equal(operaciones.length, 2)
  // La finalización de la primera sincronización no debe desbloquear la
  // segunda operación, que todavía está guardando localmente.
  operaciones[0].terminar()
  await siguienteTurno()
  form.emitir('submit')
  await siguienteTurno()
  assert.deepEqual(
    operaciones.map(({ codigo }) => codigo),
    ['TICKET-1', 'TICKET-2']
  )
  operaciones[1].terminar()
})

function asignacionSimulada(
  buscar = async (dni) => ({ dni, nombre: 'Ana', campania: 'Actual' })
) {
  const form = elemento()
  const input = elemento()
  const mensajes = []
  let busquedas = 0
  let habilitaciones = 0
  input.select = () => {}
  const inicio = main.indexOf('configurarEnvioScanner(formCosechador,')
  const fin = main.indexOf('// ASIGNAR TICKET', inicio)
  assert.ok(inicio >= 0 && fin > inicio)
  runInNewContext(main.slice(inicio, fin), {
    configurarEnvioScanner,
    esDniValido,
    formCosechador: form,
    dniCosechadorInput: input,
    cosechador: null,
    limpiarResultado: () => {},
    mostrarResultado: (mensaje) => mensajes.push(mensaje),
    buscarCosechador: (dni) => {
      busquedas++
      return buscar(dni)
    },
    nombreCosechadorVisible: (nombre) => nombre,
    nombreCosechador: {},
    campaniaCosechador: {},
    infoCosechador: { classList: { remove() {} } },
    desactivarTecladoManual: () => {},
    habilitarTicket: () => habilitaciones++,
    deshabilitarTicket: () => {}
  })
  return {
    form,
    input,
    mensajes,
    busquedas: () => busquedas,
    habilitaciones: () => habilitaciones
  }
}

for (const valor of [
  '17480378',
  '17480378\r',
  '17480378\n',
  '17480378\t',
  '01748037'
]) {
  test(`ASIGNAR TICKETS continúa sin error con ${JSON.stringify(valor)} y Enter`, async () => {
    const vista = asignacionSimulada()
    vista.input.value = valor
    vista.input.emitir('keydown', { key: 'Enter' })
    vista.form.emitir('submit')
    await siguienteTurno()
    assert.deepEqual(vista.mensajes, [])
    assert.equal(vista.busquedas(), 1)
    assert.equal(vista.habilitaciones(), 1)
  })
}

test('ASIGNAR TICKETS no valida los siete dígitos anteriores al último input', async () => {
  const vista = asignacionSimulada()
  vista.input.value = '1748037'
  vista.input.emitir('keydown', { key: 'Enter' })
  vista.input.value = '17480378'
  await siguienteTurno()
  assert.deepEqual(vista.mensajes, [])
  assert.equal(vista.habilitaciones(), 1)
})

test('ASIGNAR TICKETS espera inputs de tareas posteriores y rechaza un noveno dígito', async () => {
  for (const dni of ['17480378', '174803789']) {
    const vista = asignacionSimulada()
    vista.input.value = '1748037'
    vista.input.emitir('keydown', { key: 'Enter' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    vista.input.value = dni
    vista.input.emitir('input', { data: dni.slice(7), inputType: 'insertText' })
    await siguienteTurno()
    if (dni.length === 8) {
      assert.deepEqual(vista.mensajes, [])
      assert.equal(vista.habilitaciones(), 1)
    } else {
      assert.deepEqual(vista.mensajes, ['El DNI debe contener 8 dígitos.'])
      assert.equal(vista.busquedas(), 0)
    }
  }
})

function formularioSimulado(nombreForm, nombreInput, marcadorFin, contextoExtra) {
  const form = elemento()
  const input = elemento()
  const inicio = main.indexOf(`configurarEnvioScanner(${nombreForm},`)
  const fin = main.indexOf(marcadorFin, inicio)
  assert.ok(inicio >= 0 && fin > inicio)
  const contexto = {
    configurarEnvioScanner,
    esDniValido,
    seleccionarVariedadLote,
    [nombreForm]: form,
    [nombreInput]: input,
    navigator: { onLine: false },
    desactivarTecladoManual() {},
    actualizarEstadoConexion: async () => {},
    ...contextoExtra
  }
  contexto.casosDeUso = casosDeUsoParaVista(contexto)
  runInNewContext(main.slice(inicio, fin), contexto)
  return { form, input, contexto }
}

async function escanearDniConUltimoDigitoTardio(input) {
  input.value = '0174803'
  input.emitir('keydown', { key: 'Enter' })
  await new Promise((resolve) => setTimeout(resolve, 10))
  input.value = '01748037'
  input.emitir('input', { data: '7', inputType: 'insertText' })
  await siguienteTurno()
}

test('LOGIN también espera el DNI completo cuando el último input llega tarde', async () => {
  const errores = []
  const consultas = []
  let continuaciones = 0
  const vista = formularioSimulado('formLogin', 'dniOperadorInput', '// MENÚ', {
    operador: null,
    limpiarMensajeLogin() {},
    mostrarErrorLogin: (mensaje) => errores.push(mensaje),
    validarOperador: async (dni) => {
      consultas.push(dni)
      return { dni, offline: true }
    },
    sessionStorage: { setItem() {} },
    mostrarMenu: () => continuaciones++
    ,prepararIngreso: async () => continuaciones++
  })
  await escanearDniConUltimoDigitoTardio(vista.input)
  assert.deepEqual(errores, [])
  assert.deepEqual(consultas, ['01748037'])
  assert.equal(continuaciones, 1)
})

test('REGISTRAR JABERO también espera el DNI completo y registra una vez', async () => {
  const mensajes = []
  const registros = []
  const vista = formularioSimulado('formJabero', 'dniJaberoInput', '// NAVEGACIÓN', {
    operador: { dni: '17480378' },
    limpiarResultadoJabero() {},
    mostrarResultadoJabero: (mensaje, tipo) => mensajes.push({ mensaje, tipo }),
    obtenerTrabajador: async () => ({ nombre: 'Ana', roles: [] }),
    nombreCosechadorVisible: (nombre, dni) => nombre || `DNI ${dni}`,
    registrarJaberoOffline: async (operador, dni) => registros.push({ operador, dni })
  })
  await escanearDniConUltimoDigitoTardio(vista.input)
  assert.deepEqual(registros, [{ operador: '17480378', dni: '01748037' }])
  assert.equal(mensajes.length, 1)
  assert.equal(mensajes[0].tipo, 'exito')
})

test('INICIAR LECTURA también espera el DNI del jabero y conserva el cero', async () => {
  const errores = []
  const sesiones = []
  const lote = { lote_id: 'lote-1', codigo: 'L1', variedad: 'V1' }
  let continuaciones = 0
  const vista = formularioSimulado(
    'formIniciarLectura',
    'dniJaberoLectura',
    'configurarEnvioScanner(formLecturaTicket,',
    {
      operador: { dni: '17480378', campania: { id: 'campania-test' } },
      sesionLectura: null,
      loteLectura: { value: lote.lote_id },
      variedadLectura: { value: '' },
      mostrarMensajeLectura: (mensaje) => errores.push(mensaje),
      obtenerTrabajador: async () => ({ nombre: 'Ana', roles: ['JABERO'] }),
      obtenerSesionActivaJabero: async () => null,
      obtenerLotes: async () => [lote],
      crypto: { randomUUID: () => 'sesion-1' },
      iniciarSesionOffline: async (sesion) => sesiones.push(sesion),
      mostrarSesionLectura: async () => continuaciones++
    }
  )
  await escanearDniConUltimoDigitoTardio(vista.input)
  assert.deepEqual(errores, [])
  assert.equal(sesiones.length, 1)
  assert.equal(sesiones[0].dni_jabero, '01748037')
  assert.equal(continuaciones, 1)
})

test('INICIAR LECTURA sin DNI pide ingresar DNI antes de validar lote', async () => {
  const errores = []
  const vista = formularioSimulado(
    'formIniciarLectura',
    'dniJaberoLectura',
    'configurarEnvioScanner(formLecturaTicket,',
    {
      loteLectura: { value: '' },
      mostrarMensajeLectura: (mensaje) => errores.push(mensaje)
    }
  )
  vista.input.value = '   '
  vista.form.emitir('submit', {})
  await siguienteTurno()
  assert.deepEqual(errores, ['Ingresar DNI.'])
})

test('INICIAR LECTURA guarda la variedad seleccionada en un lote con varias variedades', async () => {
  const errores = []
  const sesiones = []
  const lote = { lote_id: 'lote-multiple', codigo: 'L2', variedades: [
    { id: 'v1', nombre: 'Ventura' }, { id: 'v2', nombre: 'Biloxi' }
  ] }
  const vista = formularioSimulado('formIniciarLectura', 'dniJaberoLectura',
    'configurarEnvioScanner(formLecturaTicket,', {
      operador: { dni: '17480378', campania: { id: 'campania-test' } }, sesionLectura: null,
      loteLectura: { value: lote.lote_id }, variedadLectura: { value: 'v2' },
      mostrarMensajeLectura: (mensaje) => errores.push(mensaje),
      obtenerTrabajador: async () => ({ nombre: 'Ana', roles: ['JABERO'] }),
      obtenerSesionActivaJabero: async () => null, obtenerLotes: async () => [lote],
      crypto: { randomUUID: () => 'sesion-multiple' },
      iniciarSesionOffline: async (sesion) => sesiones.push(sesion),
      mostrarSesionLectura: async () => {}
    })
  vista.input.value = '01748037'
  vista.form.emitir('submit', {})
  await siguienteTurno()
  assert.deepEqual(errores, [])
  assert.equal(sesiones[0].variedad_id, 'v2')
  assert.equal(sesiones[0].variedad, 'Biloxi')
  vista.contexto.variedadLectura.value = ''
  vista.form.emitir('submit', {})
  await siguienteTurno()
  assert.deepEqual(errores, ['Seleccione una variedad del lote.'])
  assert.equal(sesiones.length, 1)
})

test('ASIGNAR TICKET permite otro ticket aunque la sincronización anterior siga pendiente', async () => {
  const asignaciones = []
  const sincronizaciones = []
  const vista = formularioSimulado(
    'formTicket',
    'codigoTicketInput',
    '// REGISTRO DE JABEROS',
    {
      operador: { dni: '17480378' },
      cosechador: { dni: '01748037', nombre: 'Ana' },
      navigator: { onLine: true },
      limpiarResultado() {},
      mostrarResultado() {},
      obtenerTicket: async () => null,
      existeTicketPendiente: async () => false,
      guardarAsignacionOffline: async (asignacion) => asignaciones.push(asignacion),
      setTimeout() {},
      prepararSiguienteCosechador() {},
      sincronizarPendientes: () =>
        new Promise((resolve) => sincronizaciones.push(resolve))
    }
  )
  vista.input.value = 'TICKET-01'
  vista.input.emitir('keydown', { key: 'Enter' })
  vista.form.emitir('submit')
  await siguienteTurno()
  assert.equal(asignaciones.length, 1)
  assert.equal(sincronizaciones.length, 1)
  // Simular el campo habilitado para la siguiente asignación después del
  // temporizador de la UI, sin dar por terminada la sincronización anterior.
  vista.input.disabled = false
  vista.input.value = 'TICKET-02'
  vista.input.emitir('input', { data: 'TICKET-02\r', inputType: 'insertText' })
  await siguienteTurno()
  assert.deepEqual(
    asignaciones.map(({ codigoTicket }) => codigoTicket),
    ['TICKET-01', 'TICKET-02']
  )
  for (const terminar of sincronizaciones) terminar()
})

test('LECTURA DE TICKET también procesa CR por input una sola vez', async () => {
  const lecturas = []
  const vista = formularioSimulado(
    'formLecturaTicket',
    'ticketLectura',
    'btnFinalizarLectura.addEventListener',
    {
      operador: { dni: '17480378' },
      sesionLectura: { sesion_id: 'sesion-1', dni_jabero: '01748037' },
      obtenerTrabajador: async () => ({ roles: ['JABERO'] }),
      obtenerColaCompleta: async () => [],
      obtenerTicket: async (codigo) => ({
        codigo,
        cosechador_dni: '01748037',
        cosechador: 'Ana'
      }),
      crypto: { randomUUID: () => 'lectura-1' },
      registrarLecturaOffline: async (lectura) => lecturas.push(lectura),
      contarLecturasSesion: async () => 1,
      contarLecturasCosechador: async () => 1,
      nombreCosechadorVisible: (nombre) => nombre,
      resultadoLectura: {},
      estadoLecturaTicket: {},
      mostrarEstadoLecturaTicket() {},
      totalSesion: {},
      etiquetaCosechador: {},
      totalCosechador: {},
      mostrarContadorCosechador() {}
    }
  )
  vista.input.value = '00012345'
  vista.input.emitir('input', { data: '00012345\r', inputType: 'insertText' })
  vista.form.emitir('submit')
  await siguienteTurno()
  assert.equal(lecturas.length, 1)
  assert.equal(lecturas[0].codigo_ticket, '00012345')
})

test('ASIGNAR TICKETS mantiene la validación y permite corregir un DNI inválido', async () => {
  const vista = asignacionSimulada()
  vista.input.value = '1748037'
  vista.input.emitir('keydown', { key: 'Enter' })
  await siguienteTurno()
  assert.deepEqual(vista.mensajes, ['El DNI debe contener 8 dígitos.'])
  assert.equal(vista.busquedas(), 0)
  vista.input.value = '17480378'
  vista.input.emitir('keydown', { key: 'Enter' })
  await siguienteTurno()
  assert.equal(vista.busquedas(), 1)
})

test('ASIGNAR TICKETS rechaza nueve dígitos y letras antes de buscar', async () => {
  for (const dni of ['174803789', '1748A378']) {
    const vista = asignacionSimulada()
    vista.input.value = dni
    vista.input.emitir('keydown', { key: 'Enter' })
    await siguienteTurno()
    assert.deepEqual(vista.mensajes, ['El DNI debe contener 8 dígitos.'])
    assert.equal(vista.busquedas(), 0)
  }
})

test('ASIGNAR TICKETS permite reintentar después de un error de búsqueda', async () => {
  const vista = asignacionSimulada(async () => {
    throw new Error('Error local')
  })
  vista.input.value = '17480378'
  vista.form.emitir('submit')
  await siguienteTurno()
  assert.deepEqual(vista.mensajes, ['Error local'])
  vista.form.emitir('submit')
  await siguienteTurno()
  assert.equal(vista.busquedas(), 2)
})

test('los seis inputs de scanner comparten la ruta Enter/submit', () => {
  for (const [form, input] of [
    ['formLogin', 'dniOperadorInput'],
    ['formCosechador', 'dniCosechadorInput'],
    ['formTicket', 'codigoTicketInput'],
    ['formJabero', 'dniJaberoInput'],
    ['formIniciarLectura', 'dniJaberoLectura'],
    ['formLecturaTicket', 'ticketLectura']
  ]) {
    assert.ok(main.includes(`configurarEnvioScanner(${form}, ${input},`), input)
    assert.ok(!main.includes(`${form}.addEventListener('submit'`), form)
  }
})

test('el login no muestra el logo SCC', () => {
  const login = html.slice(
    html.indexOf('<section id="vista-login"'),
    html.indexOf('<section id="vista-menu"')
  )
  assert.doesNotMatch(login, /marca-scc|marca-scc__simbolo/)
  assert.match(login, /Sistema de Control de Cosecha/)
})

test('los inputs DNI no truncan escaneos inválidos a ocho dígitos', () => {
  for (const id of [
    'dni-operador',
    'dni-cosechador',
    'dni-jabero',
    'dni-jabero-lectura'
  ]) {
    const input = html.match(new RegExp(`<input\\s+id="${id}"[\\s\\S]*?/>`))?.[0]
    assert.ok(input, id)
    assert.doesNotMatch(input, /maxlength=/)
  }
})
