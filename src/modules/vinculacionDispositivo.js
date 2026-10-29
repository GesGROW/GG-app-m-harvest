import { tokenVinculacion } from '../application/vinculacionDispositivo.js'
import { crearLectorQrCamara } from './lectorQrCamara.js'
import { configurarTecladoManual } from './tecladoManual.js'
import { configurarEnvioScanner } from './scanner.js'

export async function configurarVinculacionDispositivo({
  servicio,
  alIngresar,
  origenesQR = [],
  doc = document,
  navegador = window
}) {
  const vista = doc.querySelector('#vista-vinculacion')
  const buscar = (id) => vista.querySelector('#' + id)
  const mensaje = buscar('pda-mensaje')
  const formQr = buscar('pda-form-qr'),
    formCuenta = buscar('pda-form-cuenta')
  const nombre = buscar('pda-nombre')
  const dniInput = buscar('pda-dni')
  const ocultarTeclado = configurarTecladoManual(
    dniInput,
    buscar('pda-teclado'),
    'numeric'
  )
  const empresa = buscar('pda-empresa'),
    titulo = buscar('pda-titulo'),
    detalle = buscar('pda-detalle')
  const video = buscar('pda-video'),
    camara = buscar('pda-camara'),
    detener = buscar('pda-detener-camara')
  let token = null,
    etapa = 'bienvenida',
    ocupado = false,
    flujoCamara = null,
    sesionCamara = 0
  function ocultarCamara() {
    sesionCamara++
    flujoCamara?.getTracks().forEach((t) => t.stop())
    flujoCamara = null
    video.srcObject = null
    video.classList.add('oculto')
    detener.classList.add('oculto')
  }
  function mostrar() {
    doc.querySelectorAll('.pantalla').forEach((n) => n.classList.add('oculto'))
    vista.classList.remove('oculto')
  }
  function render() {
    const d = servicio.vista()
    const esQr = !d && !token
    const esBienvenida = esQr && etapa === 'bienvenida'
    vista.setAttribute('data-etapa', etapa)
    titulo.textContent = esQr
      ? esBienvenida
        ? 'Hola'
        : 'Escanea el QR de la empresa'
      : etapa === 'cuenta'
        ? 'Completa tu vinculación'
        : 'Hola'
    detalle.innerHTML =
      esBienvenida || etapa === 'ingreso'
        ? 'Bienvenido a la app de <strong>Cosecha</strong>'
        : ''
    const esIngreso = etapa === 'ingreso'
    buscar('pda-card').classList.toggle('pda-card', !esIngreso)
    buscar('pda-symbol').classList.toggle('oculto', !esBienvenida)
    buscar('pda-saludo').classList.toggle('oculto', !esBienvenida && !esIngreso)
    buscar('pda-bienvenida').classList.toggle('oculto', !esBienvenida)
    buscar('pda-conexion').classList.toggle('oculto', !d || !esIngreso)
    empresa.textContent = d?.empresa ?? ''
    buscar('pda-equipo').textContent = d?.nombre ?? ''
    formQr.classList.toggle('oculto', !esQr || esBienvenida)
    formCuenta.classList.toggle('oculto', etapa !== 'cuenta')
    buscar('pda-datos-equipo').classList.toggle('oculto', Boolean(d))
    buscar('pda-nombre').disabled = Boolean(d)
    buscar('pda-form-ingreso').classList.toggle('oculto', etapa !== 'ingreso')
    buscar('pda-cambiar-qr').classList.toggle(
      'oculto',
      Boolean(d) || !token || etapa !== 'cuenta'
    )
    buscar('pda-otra-opcion').classList.toggle('oculto', etapa !== 'cuenta')
    camara.disabled = !navegador.navigator.mediaDevices?.getUserMedia
  }
  async function tarea(accion) {
    if (ocupado) return
    ocupado = true
    mensaje.textContent = ''
    vista.setAttribute('aria-busy', 'true')
    const botones = [...vista.querySelectorAll('button')]
    botones.forEach((b) => {
      b.disabled = true
    })
    try {
      await accion()
    } catch (e) {
      mensaje.textContent = e.message
      mostrar()
    } finally {
      ocupado = false
      botones.forEach((b) => {
        b.disabled = false
      })
      vista.setAttribute('aria-busy', 'false')
      render()
    }
  }
  function recibir(valor) {
    token = tokenVinculacion(valor, navegador.location.origin, origenesQR)
    ocultarCamara()
    etapa = 'cuenta'
    render()
    nombre.focus()
  }
  function extraerFragmento() {
    if (!navegador.location.hash.startsWith('#vincular=')) return null
    const enlace = navegador.location.href
    // Retirar el secreto inmediatamente del historial visible; no persistirlo.
    navegador.history.replaceState(
      null,
      '',
      navegador.location.pathname + navegador.location.search
    )
    return enlace
  }
  const recibirFragmento = (enlace = extraerFragmento()) => {
    if (!enlace) return
    if (servicio.vista()) {
      mensaje.textContent = 'Este PDA ya está vinculado; no necesitas otro QR.'
      return
    }
    try {
      recibir(enlace)
    } catch (e) {
      mensaje.textContent = e.message
    }
  }
  const enlaceInicial = extraerFragmento()
  mostrar()
  try {
    await servicio.restaurar()
    etapa = servicio.vista() ? 'ingreso' : 'bienvenida'
    recibirFragmento(enlaceInicial)
    render()
    if (etapa === 'ingreso') dniInput.focus()
  } catch {
    mensaje.textContent =
      'No se pudo abrir el almacenamiento del PDA. Habilita el almacenamiento del navegador y recarga.'
    return
  }
  navegador.addEventListener('hashchange', () => {
    mostrar()
    recibirFragmento()
    render()
  })
  async function ingresar(r) {
    if (!r.operador)
      throw new Error('Esta cuenta no tiene campañas activas de supervisor asignadas.')
    ocultarCamara()
    await alIngresar(r.operador)
  }
  formCuenta.addEventListener('submit', (event) => {
    event.preventDefault()
    const credenciales = {
      email: buscar('pda-email').value.trim(),
      password: buscar('pda-password').value
    }
    buscar('pda-password').value = ''
    tarea(async () => {
      if (!servicio.vista() && !token)
        throw new Error('Primero escanea el QR de la empresa.')
      await servicio.iniciarSesion(credenciales)
      if (!servicio.vista()) {
        await servicio.vincular(token, nombre.value)
        token = null
      }
      etapa = 'ingreso'
      render()
      buscar('pda-dni').focus()
    })
  })
  configurarEnvioScanner(buscar('pda-form-ingreso'), dniInput, (dni) =>
    tarea(async () => {
      const r = await servicio.iniciarConDni(dni)
      ocultarTeclado()
      await ingresar(r)
    })
  )
  buscar('pda-cambiar-qr').addEventListener('click', () => {
    if (ocupado) return
    token = null
    etapa = 'qr'
    mensaje.textContent = ''
    render()
    tarea(abrirCamara)
  })
  buscar('pda-comenzar').addEventListener('click', () => {
    if (ocupado) return
    etapa = 'qr'
    render()
    tarea(abrirCamara)
  })
  async function abrirCamara() {
    etapa = 'qr'
    render()
    ocultarCamara()
    const numero = sesionCamara
    let detector, stream
    try {
      detector = await crearLectorQrCamara({ navegador, doc })
      stream = await navegador.navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      })
    } catch {
      ocultarCamara()
      throw new Error(
        'No se pudo abrir la cámara. Permite su acceso y vuelve a intentarlo.'
      )
    }
    if (numero !== sesionCamara) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    flujoCamara = stream
    video.srcObject = stream
    video.classList.remove('oculto')
    detener.classList.remove('oculto')
    try {
      await video.play()
    } catch {
      ocultarCamara()
      throw new Error(
        'No se pudo iniciar la cámara. Revisa sus permisos y vuelve a intentarlo.'
      )
    }
    async function leer() {
      if (numero !== sesionCamara) return
      try {
        const codigos = await detector.detect(video)
        if (numero !== sesionCamara) return
        if (codigos.length) {
          recibir(codigos[0].rawValue)
          return
        }
      } catch (e) {
        mensaje.textContent =
          'No se pudo leer el QR. Apunta la cámara al código de vinculación y vuelve a intentarlo.'
        ocultarCamara()
        return
      }
      navegador.setTimeout(leer, 200)
    }
    leer()
  }
  camara.addEventListener('click', () => tarea(abrirCamara))
  detener.addEventListener('click', ocultarCamara)
  navegador.addEventListener('pagehide', ocultarCamara)
  doc.addEventListener?.('visibilitychange', () => {
    if (doc.hidden) ocultarCamara()
  })
  return Object.freeze({
    enConfiguracion: () => etapa === 'cuenta',
    bloquear(error) {
      ocultarCamara()
      etapa = servicio.vista() ? 'ingreso' : 'qr'
      mostrar()
      mensaje.textContent = error.message
      render()
      if (etapa === 'ingreso') dniInput.focus()
    },
    async restaurar() {
      if (!servicio.haySesionDni()) return
      await tarea(async () => {
        await ingresar(await servicio.continuar())
      })
    }
  })
}
