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
  const video = buscar('pda-video'),
    camara = buscar('pda-camara'),
    detener = buscar('pda-detener-camara')
  let token = null,
    etapa = 'qr',
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
    if (esQr) etapa = 'qr'
    titulo.textContent = esQr
      ? 'Vincular este PDA'
      : etapa === 'crear-pin'
        ? 'Crea tu PIN'
        : etapa === 'cuenta'
          ? 'Configurar acceso'
          : 'Sistema de Control de Cosecha'
    detalle.textContent = esQr
      ? 'Escanea el QR de la empresa con la cámara.'
      : etapa === 'cuenta'
        ? 'Valida tu cuenta una sola vez para crear o recuperar tu PIN.'
        : etapa === 'crear-pin'
          ? 'Crea un PIN de 4 dígitos. Después ingresarás con tu DNI y PIN.'
          : 'Ingresa con tu DNI y PIN para comenzar la jornada.'
    empresa.textContent = d
      ? `${d.empresa} · ${d.nombre}`
      : token
        ? 'QR de vinculación recibido.'
        : ''
    formQr.classList.toggle('oculto', !esQr)
    formCuenta.classList.toggle('oculto', etapa !== 'cuenta')
    buscar('pda-datos-equipo').classList.toggle('oculto', Boolean(d))
    buscar('pda-nombre').disabled = Boolean(d)
    buscar('pda-form-configurar-pin').classList.toggle('oculto', etapa !== 'crear-pin')
    buscar('pda-form-ingreso').classList.toggle('oculto', etapa !== 'ingreso')
    buscar('pda-configurar-acceso').classList.toggle('oculto', etapa !== 'ingreso')
    buscar('pda-volver-ingreso').classList.toggle('oculto', !d || etapa === 'ingreso')
    buscar('pda-cambiar-qr').classList.toggle(
      'oculto',
      Boolean(d) || !token || etapa !== 'cuenta'
    )
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
    buscar('pda-email').focus()
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
    etapa = servicio.vista() ? 'ingreso' : 'qr'
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
      etapa = 'crear-pin'
      render()
      buscar('pda-pin-nuevo').focus()
    })
  })
  buscar('pda-form-configurar-pin').addEventListener('submit', (event) => {
    event.preventDefault()
    const pin = buscar('pda-pin-nuevo').value,
      confirmacion = buscar('pda-pin-confirmacion').value
    buscar('pda-pin-nuevo').value = ''
    buscar('pda-pin-confirmacion').value = ''
    tarea(async () => {
      if (!/^[0-9]{4}$/.test(pin)) throw new Error('El PIN debe contener 4 dígitos.')
      if (pin !== confirmacion)
        throw new Error('Los PIN no coinciden. Vuelve a ingresarlos.')
      const { dni } = await servicio.configurarPin(pin)
      buscar('pda-dni').value = dni
      etapa = 'ingreso'
      render()
      await ingresar(await servicio.iniciarConPin({ dni, pin }))
    })
  })
  buscar('pda-form-ingreso').addEventListener('submit', (event) => {
    event.preventDefault()
    const dni = buscar('pda-dni').value.trim(),
      pin = buscar('pda-pin').value
    buscar('pda-pin').value = ''
    tarea(async () => {
      await ingresar(await servicio.iniciarConPin({ dni, pin }))
    })
  })
  buscar('pda-configurar-acceso').addEventListener('click', () => {
    if (ocupado || !servicio.vista()) return
    etapa = 'cuenta'
    mensaje.textContent = ''
    render()
    buscar('pda-email').focus()
  })
  buscar('pda-volver-ingreso').addEventListener('click', () => {
    if (ocupado) return
    etapa = 'ingreso'
    mensaje.textContent = ''
    buscar('pda-password').value = ''
    buscar('pda-pin-nuevo').value = ''
    buscar('pda-pin-confirmacion').value = ''
    render()
    buscar('pda-dni').focus()
  })
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
    enConfiguracion: () => ['cuenta', 'crear-pin'].includes(etapa),
    bloquear(error) {
      ocultarCamara()
      etapa = servicio.vista() ? 'ingreso' : 'qr'
      mostrar()
      mensaje.textContent = error.message
      render()
    },
    async restaurar() {
      if (!servicio.haySesionPin()) return
      await tarea(async () => {
        await ingresar(await servicio.continuar())
      })
    }
  })
}
