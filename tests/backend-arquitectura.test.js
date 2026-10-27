import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { sourceFiles, sharedSrc } from './helpers/sourceTree.js'

const src = fileURLToPath(new URL('../src/', import.meta.url))
const infraestructura = path.join(src, 'infrastructure', 'supabase') + path.sep

const fuentes = sourceFiles()

function imports(texto) {
  return [
    ...texto.matchAll(
      /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\(\s*)['"]([^'"]+)['"]/g
    )
  ].map((match) => match[1])
}

test('SDK y llamadas RPC están confinados a infrastructure/supabase', () => {
  for (const [file, texto] of fuentes) {
    if (file.startsWith(infraestructura)) continue
    assert.doesNotMatch(texto, /@supabase\/supabase-js/, file)
    assert.doesNotMatch(texto, /\bsupabase\s*\.\s*rpc\b/, file)
    assert.doesNotMatch(texto, /\bPGRST\d+\b|PostgREST/i, file)
  }
})

test('UI, módulos y offline no importan infraestructura ni conocen nombres RPC', () => {
  const adapter = fuentes.get(path.join(infraestructura, 'backendAdapter.js'))
  const nombres = [...adapter.matchAll(/['"]([a-z]+(?:_[a-z0-9]+)+)['"]/g)]
    .map((match) => match[1])
    .filter((nombre) => !nombre.startsWith('p_'))
  for (const [file, texto] of fuentes) {
    if (
      file !== path.join(src, 'main.js') &&
      !file.startsWith(path.join(src, 'modules') + path.sep) &&
      !file.startsWith(path.join(src, 'offline') + path.sep)
    )
      continue
    for (const dependencia of imports(texto)) {
      assert.doesNotMatch(dependencia, /supabase|infrastructure/, file)
    }
    assert.doesNotMatch(texto, /parametrosCampania/, file)
    for (const nombre of nombres) {
      assert.ok(
        !texto.includes(`'${nombre}'`) && !texto.includes(`"${nombre}"`),
        `${file}: ${nombre}`
      )
    }
  }
})

test('el grafo completo de sync.js no alcanza infraestructura ni el SDK', () => {
  const visitados = new Set()
  function visitar(file) {
    if (visitados.has(file)) return
    visitados.add(file)
    assert.ok(!file.startsWith(infraestructura), file)
    const texto = fuentes.get(file)
    assert.notEqual(texto, undefined, `Import no resuelto: ${file}`)
    for (const dependencia of imports(texto)) {
      assert.doesNotMatch(dependencia, /supabase/, `${file}: ${dependencia}`)
      if (!dependencia.startsWith('.') && !dependencia.startsWith('@gesgrow/core/'))
        continue
      const resuelto = dependencia.startsWith('@gesgrow/core/')
        ? fileURLToPath(import.meta.resolve(dependencia))
        : path.resolve(path.dirname(file), dependencia)
      visitar(fuentes.has(resuelto) ? resuelto : resuelto + '.js')
    }
  }
  visitar(path.join(src, 'offline', 'sync.js'))
  assert.ok(visitados.has(path.join(sharedSrc, 'backend', 'backend.js')))
})

test('el arranque configura el puerto antes de cargar la aplicación', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /<script type="module" src="\/src\/bootstrap.js"><\/script>/)
  const bootstrap = fuentes.get(path.join(src, 'bootstrap.js'))
  assert.ok(
    bootstrap.indexOf(
      'configurarBackend(protegerBackendDispositivo(campo, dispositivo))'
    ) < bootstrap.indexOf("import('./main.js')")
  )
})
