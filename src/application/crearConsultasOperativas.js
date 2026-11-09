import {
  agruparLecturasPorCosechador,
  enriquecerSesionLectura
} from '@gesgrow/core/contexts/harvest/index.js'
import { nombreCosechadorVisible } from '@gesgrow/core/contexts/workforce/index.js'
import { resumirRecipientes } from './resumenRecipientes.js'

export function crearConsultasOperativas({
  obtenerOperador,
  obtenerSesionLectura,
  lecturas,
  actualizarCache
}) {
  async function enCampania(consultar) {
    const operador = obtenerOperador()
    if (!operador?.campania?.id)
      throw new Error('Ingrese para seleccionar su campaña de trabajo.')
    const campaniaId = operador.campania.id
    const dni = operador.dni
    const resultado = await consultar(operador)
    const actual = obtenerOperador()
    if (actual?.campania?.id !== campaniaId || actual?.dni !== dni)
      throw new Error('La campaña de trabajo cambió. Actualice la consulta.')
    return resultado
  }

  return Object.freeze({
    asignaciones: () => enCampania(() => lecturas.obtenerAsignacionesTickets()),
    jaberos: () => enCampania(() => lecturas.obtenerTrabajadores()),
    cosechadores: () =>
      enCampania(async () => {
        const sesionId = obtenerSesionLectura()?.sesion_id
        if (!sesionId) return []
        const [registros, trabajadores] = await Promise.all([
          lecturas.obtenerLecturasSesion(sesionId),
          lecturas.obtenerTrabajadores()
        ])
        return agruparLecturasPorCosechador(registros, trabajadores).map((persona) => {
          const filas = registros.filter((l) => l.cosechador_dni === persona.dni)
          if (!filas.some((l) => l.tipoRecipiente)) return persona
          const recipientes = resumirRecipientes(filas)
          return { ...persona, jabas: recipientes.jabas, recipientes }
        })
      }),
    sesiones: () =>
      enCampania(async (operador) => {
        const [sesiones, trabajadores, lotes] = await Promise.all([
          lecturas.obtenerSesionesOperador(operador.dni),
          lecturas.obtenerTrabajadores(),
          lecturas.obtenerLotes()
        ])
        const nombresPorDni = new Map(trabajadores.map((t) => [t.dni, t.nombre]))
        const nombresLotes = new Map(lotes.map((lote) => [lote.lote_id, lote.nombre]))
        return Promise.all(
          sesiones.map(async (sesion) => {
            const sesionId = sesion.id ?? sesion.sesion_id
            const registros = sesionId
              ? await lecturas.obtenerLecturasSesion(sesionId)
              : []
            return {
              ...enriquecerSesionLectura(
                {
                  ...sesion,
                  lote_nombre:
                    nombresLotes.get(sesion.lote_id)?.trim() ||
                    sesion.lote_nombre?.trim() ||
                    'Lote sin nombre',
                  jabero: nombreCosechadorVisible(
                    nombresPorDni.get(sesion.dni_jabero) || sesion.jabero,
                    sesion.dni_jabero
                  )
                },
                registros
              ),
              ...(registros.some((l) => l.tipoRecipiente)
                ? { recipientes: resumirRecipientes(registros) }
                : {})
            }
          })
        )
      }),
    actualizar: () =>
      enCampania((operador) => actualizarCache(operador.dni, operador.campania.id))
  })
}
