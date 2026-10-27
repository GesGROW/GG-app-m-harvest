import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { crearLectorQrCamara } from '../src/modules/lectorQrCamara.js'

test('lee un QR real desde un frame aunque el navegador no tenga BarcodeDetector', async () => {
  const { url, rows } = JSON.parse(
    readFileSync(new URL('./helpers/qr-vinculacion.json', import.meta.url), 'utf8')
  )
  const scale = 4,
    margin = 4,
    width = (rows.length + margin * 2) * scale
  const data = new Uint8ClampedArray(width * width * 4).fill(255)
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows.length; x++)
      if (rows[y][x] === '1') {
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i =
              (((y + margin) * scale + dy) * width + (x + margin) * scale + dx) * 4
            data[i] = data[i + 1] = data[i + 2] = 0
          }
      }
  const lector = await crearLectorQrCamara({
    navegador: {},
    doc: {
      createElement: () => ({
        getContext: () => ({
          drawImage() {},
          getImageData: () => ({ data, width, height: width })
        })
      })
    }
  })
  assert.deepEqual(await lector.detect({ videoWidth: width, videoHeight: width }), [
    { rawValue: url }
  ])
  assert.deepEqual(await lector.detect({ videoWidth: 0, videoHeight: 0 }), [])
})
