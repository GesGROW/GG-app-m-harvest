import { tokenVinculacion } from '../application/vinculacionDispositivo.js'
import { crearLectorQrCamara } from './lectorQrCamara.js'

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
  const empresa = buscar('pda-empresa'),
    titulo = buscar('pda-titulo'),
    detalle = buscar('pda-detalle')
  const continuar = buscar('pda-continuar'),
    cambiar = buscar('pda-cambiar-cuenta')
  const video = buscar('pda-video'),
    camara = buscar('pda-camara'),
    detener = buscar('pda-detener-camara')
  let token = null,
    conectado = false,
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
    titulo.textContent = d ? 'PDA vinculado' : 'Vincular este PDA'
    detalle.textContent = d
      ? 'Inicia sesión como supervisor para comenzar la jornada.'
      : 'Escanea el QR de la empresa con la cámara.'
    empresa.textContent = d
      ? `${d.empresa} · ${d.nombre}`
      : token
        ? 'QR recibido. Inicia sesión para confirmar la vinculación.'
        : ''
    formQr.classList.toggle('oculto', Boolean(d) || Boolean(token))
    formCuenta.classList.toggle('oculto', conectado || (!d && !token))
    buscar('pda-cambiar-qr').classList.toggle('oculto', Boolean(d) || !token)
    continuar.classList.toggle('oculto', !conectado)
    continuar.textContent = d ? 'Ingresar a Cosecha' : 'Vincular PDA'
    cambiar.classList.toggle('oculto', !conectado)
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
    render()
    if (!conectado) buscar('pda-email').focus()
    else continuar.focus()
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
    recibirFragmento(enlaceInicial)
    render()
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
  formCuenta.addEventListener('submit', (event) => {
    event.preventDefault()
    const credenciales = {
      email: buscar('pda-email').value.trim(),
      password: buscar('pda-password').value
    }
    buscar('pda-password').value = ''
    tarea(async () => {
      await servicio.iniciarSesion(credenciales)
      conectado = true
      render()
      continuar.focus()
    })
  })
  continuar.addEventListener('click', () =>
    tarea(async () => {
      if (!servicio.vista()) {
        if (!token) throw new Error('Primero escanea el QR de la empresa.')
        await servicio.vincular(token, nombre.value)
        token = null
        mensaje.textContent = 'PDA vinculado correctamente.'
      }
      const r = await servicio.continuar()
      if (!r.operador)
        throw new Error(
          'El PDA está vinculado. Esta cuenta todavía no tiene campañas activas de supervisor asignadas.'
        )
      ocultarCamara()
      await alIngresar(r.operador)
    })
  )
  cambiar.addEventListener('click', () =>
    tarea(async () => {
      await servicio.salir()
      conectado = false
      render()
      buscar('pda-email').focus()
    })
  )
  buscar('pda-cambiar-qr').addEventListener('click', () => {
    if (ocupado) return
    token = null
    mensaje.textContent = ''
    render()
    camara.focus()
  })
  if (!servicio.vista() && !token && !navegador.navigator.mediaDevices?.getUserMedia)
    mensaje.textContent =
      'Abre la aplicación en un dispositivo con cámara y permite su acceso para escanear el QR.'
  camara.addEventListener('click', () =>
    tarea(async () => {
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
    })
  )
  detener.addEventListener('click', ocultarCamara)
  navegador.addEventListener('pagehide', ocultarCamara)
  doc.addEventListener?.('visibilitychange', () => {
    if (doc.hidden) ocultarCamara()
  })
  return Object.freeze({
    bloquear(error) {
      ocultarCamara()
      conectado = false
      mostrar()
      mensaje.textContent = error.message
      render()
    },
    async restaurar() {
      if (!servicio.vista()) return
      await tarea(async () => {
        const r = await servicio.continuar()
        conectado = true
        if (r.operador) await alIngresar(r.operador)
        else
          throw new Error(
            'Esta cuenta no tiene campañas activas asignadas en la empresa vinculada.'
          )
      })
    }
  })
}
