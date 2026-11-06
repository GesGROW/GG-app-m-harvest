// Confirma la apertura en el servidor antes de habilitar lecturas locales.
// La cola conserva el mismo UUID: una repetición confirma la sesión existente.
export function crearAperturaSesionEnLinea({ offline, backend, enLinea }) {
  return Object.freeze({
    ...offline,
    cosecha: Object.freeze({
      ...offline.cosecha,
      async iniciarSesion(sesion, dniOperador) {
        if (!enLinea()) throw new Error('Necesitas internet para abrir la sesión. Después podrás registrar jabas sin conexión.')
        await offline.sincronizacion.sincronizar()
        const r = await backend.iniciarSesionLectura({
          dniOperador, campaniaId: sesion.campania_id, dniJabero: sesion.dni_jabero,
          loteId: sesion.lote_id, variedadId: sesion.variedad_id, sesionId: sesion.id
        })
        const confirmado = r?.sesion ?? r
        if (confirmado?.ok === false || (confirmado?.id ?? confirmado?.sesion_id) !== sesion.id)
          throw new Error('No se pudo confirmar la apertura. Actualiza los datos y vuelve a intentar con conexión.')
        // La fecha del servidor es la referencia para sesiones y bonos.
        return offline.cosecha.iniciarSesion({ ...sesion,
          fecha_inicio: confirmado?.fecha_inicio ?? sesion.fecha_inicio }, dniOperador)
      }
    })
  })
}
