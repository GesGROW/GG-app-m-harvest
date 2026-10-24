export function archivoExcluido(nombre, esEnlace = false) {
  const normalizado = nombre.toLowerCase()
  return (
    esEnlace ||
    ['.git', 'node_modules', 'dist', 'secrets'].includes(normalizado) ||
    /^\.env(?:\.|$)/.test(normalizado) ||
    /(?:secret|credential|service[_-]?role|private[._-]?key|\.pem$|\.p12$|\.pfx$|id_rsa)/.test(
      normalizado
    ) ||
    /^arbol-y-contenido(?:\.|$)/.test(normalizado)
  )
}

export function contenidoSensible(contenido) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{32,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsb_secret_[a-z0-9_-]{10,}|\bsk_[a-z0-9_-]{20,}|\beyJ[a-z0-9_-]{20,}\.eyJ[a-z0-9_-]{20,}\.[a-z0-9_-]{10,}|\b(?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)\s*[:=]\s*["']?\S{12,}/i.test(
    contenido
  )
}
