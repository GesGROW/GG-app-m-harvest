import {
  obtenerResumenCampania,
  obtenerRankingCosechadores,
  obtenerProduccionDiaria,
  obtenerProduccionLotes
} from '@gesgrow/core/contexts/harvest/index.js'

// Coordina las consultas mediante el puerto recibido. No conserva una copia
// del operador: cada petición utiliza la campaña seleccionada en ese momento.
export function crearConsultasReportes({ obtenerOperador, consultas }) {
  async function consultarCampania(consultar, parametros) {
    const id = obtenerOperador()?.campania?.id
    if (!id) throw new Error('Ingrese para seleccionar su campaña de trabajo.')
    try {
      return await consultar({ ...parametros, campaniaId: id })
    } finally {
      if (obtenerOperador()?.campania?.id !== id)
        throw new Error('La campaña de trabajo cambió. Actualice la consulta.')
    }
  }

  function ejecutar(obtener, consultar, ...opciones) {
    return obtener(
      obtenerOperador()?.dni,
      (parametros) => consultarCampania(consultar, parametros),
      ...opciones
    )
  }

  return Object.freeze({
    resumen: () => ejecutar(obtenerResumenCampania, consultas.obtenerResumenCampania),
    ranking: (periodo) =>
      ejecutar(
        obtenerRankingCosechadores,
        consultas.obtenerRankingCosechadores,
        periodo
      ),
    diaria: () => ejecutar(obtenerProduccionDiaria, consultas.obtenerProduccionDiaria),
    lotes: () => ejecutar(obtenerProduccionLotes, consultas.obtenerProduccionLotes)
  })
}
