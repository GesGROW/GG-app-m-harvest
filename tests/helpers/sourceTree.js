import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const pwaSrc = fileURLToPath(new URL('../../src/', import.meta.url))
export const sharedSrc = fileURLToPath(
  new URL('./src/', import.meta.resolve('@gesgrow/core/package.json'))
)

// Architectural checks traverse both the field application and shared rules.
export function sourceFiles() {
  return new Map(
    [pwaSrc, sharedSrc].flatMap((root) =>
      readdirSync(root, { recursive: true })
        .filter((file) => file.endsWith('.js'))
        .map((file) => [
          path.join(root, file),
          readFileSync(path.join(root, file), 'utf8')
        ])
    )
  )
}
