import { crearEstadoConexion } from './estadoConexion.js'
import { crearTarjetaOperacion } from './tarjetaOperacion.js'

export function crearSincronizacion({
  document,
  obtenerOperador,
  verificarVigenciaOperador,
  estaEnLinea,
  cola,
  sincronizar,
  actualizarTotalesLectura,
  mostrarVista,
  mostrarMenu,
  registrarError = (...args) => console.error(...args)
}) {
  const vista = document.querySelector('#vista-sync')
  const resumen = document.querySelector('#resumen-sync')
  const errores = document.querySelector('#operaciones-error')
  const estado = crearEstadoConexion({
    document,
    obtenerOperador,
    estaEnLinea,
    cola,
    actualizarTotalesLectura,
    registrarError
  })
  let revision = 0
  document.querySelector('#estado-conexion').addEventListener('click', async () => {
    if (!verificarVigenciaOperador()) return
    mostrarVista(vista)
    if (!vista.classList.contains('oculto')) await actualizarVista()
  })
  document.querySelector('#btn-volver-sync').addEventListener('click', mostrarMenu)

  async function actualizarVista() {
    const version = ++revision
    const operador = obtenerOperador()
    const campaniaId = operador?.campania?.id
    const vigente = () =>
      version === revision &&
      obtenerOperador() === operador &&
      obtenerOperador()?.campania?.id === campaniaId &&
      !vista.classList.contains('oculto')
    if (!campaniaId) return
    const operaciones = (await cola.obtenerOperaciones())
      .filter((op) => op.payload.campaniaId === campaniaId)
      .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
    if (!vigente()) return
    const pendientes = operaciones.filter((item) => item.estado === 'PENDIENTE')
    const fallidas = operaciones.filter((item) => item.estado === 'ERROR')
    const resueltas = fallidas.filter((op) => op.resueltaHarvest).length
    resumen.textContent = `${pendientes.length} pendientes · ${fallidas.length - resueltas} errores${resueltas ? ` · ${resueltas} conciliadas` : ''}`
    errores.replaceChildren()
    if (!fallidas.length) {
      errores.textContent = 'No hay operaciones con error.'
      return
    }
    for (const operacion of fallidas) {
      const autorizada = () => vigente() && verificarVigenciaOperador()
      const card = crearTarjetaOperacion({
        document,
        operacion,
        vigente: autorizada,
        descarte: cola.evaluarDescarte(operacion, operaciones),
        async reintentar(id) {
          await cola.reintentar(id)
          if (estaEnLinea()) await sincronizar()
          if (vigente()) await actualizarVista()
          await estado.actualizar()
        },
        async descartar(id) {
          if (await cola.descartar(id)) {
            if (vigente()) await actualizarVista()
            await estado.actualizar()
          }
        }
      })
      errores.append(card)
    }
  }

  return Object.freeze({
    actualizarEstado: estado.actualizar,
    alCambiarVista(destino) {
      if (destino === vista) return
      revision++
      resumen.textContent = ''
      errores.replaceChildren()
    }
  })
}
