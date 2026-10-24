import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceFiles } from './helpers/sourceTree.js'

test('Application no manipula DOM ni conoce Supabase o códigos PostgREST', () => {
  const application = new URL('../src/application/', import.meta.url)
  for (const file of readdirSync(application, { recursive: true }).filter((file) =>
    file.endsWith('.js')
  )) {
    const fuente = readFileSync(
      new URL(file.replaceAll('\\', '/'), application),
      'utf8'
    )
    assert.doesNotMatch(
      fuente,
      /\bdocument\b|\bwindow\b|sessionStorage|querySelector|classList|\.textContent|\.innerHTML/,
      file
    )
    assert.doesNotMatch(fuente, /supabase|PGRST\d+|PostgREST|React/, file)
  }
})

test('main delega los siete casos y no escribe comandos operativos ni genera UUID', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  for (const nombre of [
    'validarOperador',
    'ingresarCampania',
    'asignarTicket',
    'registrarJabero',
    'iniciarSesionLectura',
    'registrarLecturaJaba',
    'cerrarSesionLectura'
  ]) {
    assert.ok(main.includes(`casosDeUso.${nombre}(`), nombre)
  }
  assert.doesNotMatch(
    main,
    /guardarAsignacionOffline|registrarJaberoOffline|iniciarSesionOffline|registrarLecturaOffline|finalizarSesionOffline|existeTicketPendiente|obtenerSesionActivaJabero|crypto\.randomUUID/
  )
})

const src = fileURLToPath(new URL('../src/', import.meta.url))
const fuentes = sourceFiles()
const application = path.join(src, 'application') + path.sep

function imports(fuente) {
  return [
    ...fuente.matchAll(
      /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g
    )
  ].map((match) => match[1])
}

test('Application y sus dependencias transitivas solo alcanzan puertos y lógica independiente', () => {
  const visitados = new Set()
  function visitar(file) {
    if (visitados.has(file)) return
    visitados.add(file)
    assert.ok(!file.startsWith(path.join(src, 'offline') + path.sep), file)
    assert.ok(!file.startsWith(path.join(src, 'infrastructure') + path.sep), file)
    const fuente = fuentes.get(file)
    assert.notEqual(fuente, undefined, `Import no resuelto: ${file}`)
    assert.doesNotMatch(
      fuente,
      /\bindexedDB\b|\bIDBDatabase\b|\bIDBObjectStore\b|\.objectStore\(/,
      file
    )
    for (const dependencia of imports(fuente)) {
      assert.notEqual(dependencia, 'idb', file)
      assert.ok(!dependencia.startsWith('idb/'), file)
      if (!dependencia.startsWith('.')) {
        assert.ok(
          dependencia.startsWith('@gesgrow/core/'),
          `Dependencia externa de Application: ${file}: ${dependencia}`
        )
      }
      const resuelto = dependencia.startsWith('@gesgrow/core/')
        ? fileURLToPath(import.meta.resolve(dependencia))
        : path.resolve(path.dirname(file), dependencia)
      visitar(fuentes.has(resuelto) ? resuelto : resuelto + '.js')
    }
  }
  for (const file of fuentes.keys()) if (file.startsWith(application)) visitar(file)
  assert.ok(
    visitados.has(path.join(src, 'ports', 'offline', 'validarPuertosOffline.js'))
  )
})

test('los casos de uso no interpretan comandos, payloads o transacciones de la cola', () => {
  for (const [file, fuente] of fuentes) {
    if (!file.startsWith(application)) continue
    assert.doesNotMatch(
      fuente,
      /ASIGNAR_TICKET|REGISTRAR_JABERO|INICIAR_SESION|REGISTRAR_JABA|CERRAR_SESION|\.payload\b|obtenerColaCompleta|\.transaction\(/,
      file
    )
  }
})

test('bootstrap construye e inyecta los adapters antes de cargar presentación', () => {
  const bootstrap = fuentes.get(path.join(src, 'bootstrap.js'))
  assert.match(bootstrap, /configurarCasosDeUso\(\s*crearCasosDeUso\(/)
  assert.match(bootstrap, /offline:\s*crearAdaptadoresOffline\(\)/)
  assert.ok(
    bootstrap.indexOf('configurarCasosDeUso(') <
      bootstrap.indexOf("import('./main.js')")
  )
  const fachada = fuentes.get(path.join(src, 'application', 'casosDeUso.js'))
  assert.doesNotMatch(fachada, /crearAdaptadoresOffline|crearCasosDeUso\(/)
})
