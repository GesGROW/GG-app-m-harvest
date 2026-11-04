export function crearNavegacionPrincipal({
  document,
  obtenerOperador,
  autorizarVista,
  verificarVigenciaOperador,
  desactivarTecladoManual,
  mostrarIngresoDispositivo,
  alCambiarVista,
  alMostrarMenu,
  registrarError = (...args) => console.error(...args)
}) {
  const vistas = [
    'login',
    'cultivos',
    'menu',
    'asignacion',
    'jaberos',
    'lectura',
    'sync',
    'consulta',
    'reportes',
    'resumen-campania',
    'ranking-cosechadores',
    'produccion-diaria',
    'produccion-lotes'
  ].map((nombre) => document.querySelector(`#vista-${nombre}`))
  const vistaLogin = document.querySelector('#vista-login')
  const vistaMenu = document.querySelector('#vista-menu')
  function mostrarVista(destino) {
    const vista = autorizarVista(destino)
    desactivarTecladoManual()
    alCambiarVista(vista)
    for (const item of vistas) item.classList.add('oculto')
    if (vista === vistaLogin && mostrarIngresoDispositivo()) return
    vista.classList.remove('oculto')
  }
  function mostrarMenu() {
    if (!verificarVigenciaOperador()) return
    mostrarVista(vistaMenu)
    document.querySelector('#menu-operador').textContent = obtenerOperador().nombre
    Promise.resolve(alMostrarMenu()).catch(registrarError)
  }
  document
    .querySelector('#btn-menu-reportes')
    .addEventListener('click', () =>
      mostrarVista(document.querySelector('#vista-reportes'))
    )
  return Object.freeze({ mostrarVista, mostrarMenu })
}
