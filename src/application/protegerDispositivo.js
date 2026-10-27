export function protegerBackendDispositivo(campo, dispositivo) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(campo).map(([nombre, ejecutar]) => [
        nombre,
        (...args) => {
          const dato = args[0]
          const solicitud =
            typeof dato === 'object' && dato !== null
              ? { dni: dato.dniOperador, campaniaId: dato.campaniaId }
              : {
                  dni: typeof dato === 'string' ? dato : undefined,
                  campaniaId: args[1]
                }
          return dispositivo.ejecutarSolicitud(solicitud, () =>
            nombre === 'validarOperador'
              ? dispositivo.operador(args[0])
              : ejecutar(...args)
          )
        }
      ])
    )
  )
}

export function protegerCasosDispositivo(casos, dispositivo) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(casos).map(([nombre, ejecutar]) => [
        nombre,
        (...args) => {
          const dato = args[0]
          if (nombre === 'validarOperador') return dispositivo.operador(dato)
          return dispositivo.ejecutarSolicitud(
            {
              dni: dato?.operador?.dni,
              campaniaId: dato?.operador?.campania?.id ?? dato?.campania?.id
            },
            () => ejecutar(...args)
          )
        }
      ])
    )
  )
}
