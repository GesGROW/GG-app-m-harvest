import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = path.resolve(root, process.argv[2] ?? 'vendor')
const staging = mkdtempSync(path.join(tmpdir(), 'gesgrow-harvest-contracts-'))
mkdirSync(destination, { recursive: true })
for (const dir of ['src', 'tests/helpers'])
  cpSync(path.join(root, dir), path.join(staging, dir), {
    recursive: true,
    filter: (p) => !path.extname(p) || p.endsWith('.js')
  })
cpSync(path.join(root, 'index.html'), path.join(staging, 'index.html'))
const version = JSON.parse(readFileSync(path.join(root, 'package.json'))).version
writeFileSync(
  path.join(staging, 'package.json'),
  JSON.stringify(
    {
      name: '@gesgrow/harvest-client-contracts',
      version,
      private: true,
      type: 'module',
      description:
        'Instantánea del cliente de campo para pruebas de compatibilidad del backend; no se despliega',
      files: ['src', 'tests/helpers', 'index.html'],
      exports: {
        './package.json': './package.json',
        './src/*': './src/*',
        './tests/helpers/*': './tests/helpers/*',
        './index.html': './index.html'
      },
      peerDependencies: { '@gesgrow/core': '0.1.0', idb: '8.0.3' }
    },
    null,
    2
  )
)
if (!process.env.npm_execpath)
  throw new Error('Ejecutar mediante npm run pack:contracts')
process.stdout.write(
  execFileSync(
    process.execPath,
    [process.env.npm_execpath, 'pack', '--json', '--pack-destination', destination],
    { cwd: staging, encoding: 'utf8' }
  )
)
