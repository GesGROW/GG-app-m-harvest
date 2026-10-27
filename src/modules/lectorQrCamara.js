export async function crearLectorQrCamara({ navegador = window, doc = document } = {}) {
  if (navegador.BarcodeDetector) {
    try {
      const formatos = await navegador.BarcodeDetector.getSupportedFormats?.()
      if (!formatos || formatos.includes('qr_code'))
        return new navegador.BarcodeDetector({ formats: ['qr_code'] })
    } catch {
      /* Usar el lector local cuando el navegador no admite QR nativos. */
    }
  }
  const { default: jsQR } = await import('jsqr')
  const canvas = doc.createElement('canvas')
  const contexto = canvas.getContext('2d', { willReadFrequently: true })
  if (!contexto) throw new Error('No se pudo preparar la cámara para leer el QR.')
  return {
    async detect(video) {
      if (!video.videoWidth || !video.videoHeight) return []
      const escala = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.max(1, Math.round(video.videoWidth * escala))
      canvas.height = Math.max(1, Math.round(video.videoHeight * escala))
      contexto.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imagen = contexto.getImageData(0, 0, canvas.width, canvas.height)
      const codigo = jsQR(imagen.data, imagen.width, imagen.height, {
        inversionAttempts: 'dontInvert'
      })
      return codigo ? [{ rawValue: codigo.data }] : []
    }
  }
}
