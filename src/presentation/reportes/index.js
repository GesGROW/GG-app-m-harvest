import { crearVistaResumenCampania } from './resumenCampania.js'
import { crearVistaRankingCosechadores } from './rankingCosechadores.js'
import { crearVistaProduccionDiaria } from './produccionDiaria.js'
import { crearVistaProduccionLotes } from './produccionLotes.js'

// El punto de entrada compone vistas; las consultas y la lectura local se
// inyectan desde main, sin dependencias de SDK ni almacenamiento concreto.
export function crearReportes({
  document,
  mostrarVista,
  mostrarMenu,
  consultas,
  obtenerLotes,
  estaEnLinea
}) {
  const dependencias = { document, mostrarVista, estaEnLinea }
  const resumen = crearVistaResumenCampania({
    ...dependencias,
    consultar: consultas.resumen
  })
  const ranking = crearVistaRankingCosechadores({
    ...dependencias,
    consultar: consultas.ranking
  })
  const diaria = crearVistaProduccionDiaria({
    ...dependencias,
    consultar: consultas.diaria
  })
  const lotes = crearVistaProduccionLotes({
    ...dependencias,
    consultar: consultas.lotes,
    obtenerLotes
  })
  const vistaReportes = document.querySelector('#vista-reportes')
  document.querySelector('#btn-volver-reportes').addEventListener('click', mostrarMenu)
  for (const [nombre, vista] of Object.entries({
    resumen,
    ranking,
    produccion: diaria,
    lotes
  })) {
    document
      .querySelector(`#btn-reporte-${nombre}`)
      .addEventListener('click', vista.abrir)
    document
      .querySelector(`#btn-volver-${nombre}`)
      .addEventListener('click', () => mostrarVista(vistaReportes))
  }

  return Object.freeze({
    reiniciar() {
      for (const vista of [resumen, ranking, diaria, lotes]) vista.reiniciar()
    }
  })
}
