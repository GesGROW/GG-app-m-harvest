import { createHash } from 'node:crypto'
import { readFileSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { archivoExcluido, contenidoSensible } from './filtros-exportacion.js'

const proyecto = fileURLToPath(new URL('..', import.meta.url))
const salida = resolve(proyecto, 'arbol-y-contenido.txt')
const decodificador = new TextDecoder('utf-8', { fatal: true })
const archivos = []
const lineasArbol = [`${basename(proyecto)}/`]

function rutaRelativa(ruta) {
  return relative(proyecto, ruta).split(sep).join('/')
}

function dibujarCarpeta(carpeta, prefijo = '') {
  const entradas = readdirSync(carpeta, { withFileTypes: true })
    .filter((entrada) => {
      if (
        resolve(carpeta, entrada.name) === salida ||
        archivoExcluido(entrada.name, entrada.isSymbolicLink())
      )
        return false
      if (entrada.isFile()) {
        const bytes = readFileSync(join(carpeta, entrada.name))
        if (!bytes.includes(0) && contenidoSensible(bytes.toString('utf8')))
          return false
      }
      return true
    })
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name, 'es')
    })

  entradas.forEach((entrada, indice) => {
    const ruta = join(carpeta, entrada.name)
    const ultima = indice === entradas.length - 1
    const rama = ultima ? '└── ' : '├── '
    const siguientePrefijo = prefijo + (ultima ? '    ' : '│   ')
    const sufijo = entrada.isDirectory() ? '/' : ''

    lineasArbol.push(`${prefijo}${rama}${entrada.name}${sufijo}`)

    if (entrada.isDirectory()) {
      dibujarCarpeta(ruta, siguientePrefijo)
    } else if (entrada.isFile()) {
      archivos.push({ ruta, enlace: false })
    }
  })
}

function describirArchivo({ ruta, enlace }) {
  const encabezado = [`ARCHIVO: ${rutaRelativa(ruta)}`]

  if (enlace) {
    return [...encabezado, 'TIPO: enlace simbólico', '', readlinkSync(ruta)].join('\n')
  }

  const bytes = readFileSync(ruta)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let contenido
  let codificacion = 'UTF-8'

  try {
    if (bytes.includes(0)) {
      throw new Error('Archivo binario')
    }
    contenido = decodificador.decode(bytes)
  } catch {
    codificacion = 'Base64 (binario)'
    contenido = bytes.toString('base64')
  }

  return [
    ...encabezado,
    `CODIFICACIÓN: ${codificacion}`,
    `TAMAÑO: ${bytes.length} bytes`,
    `SHA-256: ${sha256}`,
    '',
    contenido
  ].join('\n')
}

dibujarCarpeta(proyecto)

const separador = '='.repeat(80)
const informe = [
  `Proyecto: ${basename(proyecto)}`,
  `Generado: ${new Date().toISOString()}`,
  `Archivos incluidos: ${archivos.length}`,
  'Excluidos: .git/, node_modules/, dist/, .env*, secretos, enlaces simbólicos y archivos generados por el exportador.',
  '',
  'ÁRBOL',
  lineasArbol.join('\n'),
  '',
  'CONTENIDO DE LOS ARCHIVOS',
  ...archivos.map((archivo) => `${separador}\n${describirArchivo(archivo)}`),
  separador,
  ''
].join('\n')

writeFileSync(salida, informe, 'utf8')
console.log(`Creado: ${salida}`)
