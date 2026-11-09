export function resumirRecipientes(lecturas) {
  let jarras = 0,
    jabas = 0,
    decimos = 0,
    sinPeso = 0
  for (const l of lecturas) {
    if (l.tipoRecipiente === 'JARRA') jarras++
    else jabas++
    if (l.pesoKg == null) sinPeso++
    else decimos += Math.round(l.pesoKg * 10)
  }
  return { jarras, jabas, kg: decimos / 10, sinPeso }
}

export function describirRecipientes(r) {
  const peso =
    r.sinPeso === r.jabas + r.jarras && r.sinPeso > 0
      ? 'Sin peso registrado'
      : `${r.kg.toLocaleString('es-PE', { maximumFractionDigits: 1 })} kg estimados${r.sinPeso ? ' (parcial)' : ''}`
  return `${r.jabas} jabas | ${r.jarras} jarras | ${peso}`
}
