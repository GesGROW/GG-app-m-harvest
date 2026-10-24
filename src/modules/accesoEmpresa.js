// Presentación de acceso por cuenta. Recibe Application; no conoce el proveedor.
import { configurarAdministracionComercial } from './administracionComercial.js'

export function configurarVistaAccesoEmpresa({ acceso, comercial }) {
  const vista = document.querySelector('#vista-acceso-empresa')
  const login = document.querySelector('#vista-login')
  const form = vista.querySelector('#form-cuenta')
  const mensaje = vista.querySelector('#cuenta-mensaje')
  const empresas = vista.querySelector('#cuenta-empresas')
  const panel = vista.querySelector('#cuenta-panel')
  const contenido = vista.querySelector('#cuenta-contenido')
  const campanias = vista.querySelector('#cuenta-campania')
  const comercialUI = comercial
    ? configurarAdministracionComercial({ vista, comercial })
    : null
  let perfil

  const estado = (texto) => {
    mensaje.textContent = texto
  }
  const mostrar = () => {
    document.querySelectorAll('.pantalla').forEach((v) => v.classList.add('oculto'))
    vista.classList.remove('oculto')
  }
  const tarea = async (accion) => {
    estado('')
    try {
      await accion()
    } catch (error) {
      estado(error.message)
    }
  }
  const texto = (tag, valor) => {
    const nodo = document.createElement(tag)
    nodo.textContent = valor
    return nodo
  }
  function tabla(filas, columnas) {
    const tabla = document.createElement('table')
    const head = document.createElement('thead'),
      body = document.createElement('tbody')
    const cabecera = document.createElement('tr')
    for (const [nombre] of columnas) cabecera.append(texto('th', nombre))
    head.append(cabecera)
    for (const fila of filas) {
      const tr = document.createElement('tr')
      for (const [, campo] of columnas) tr.append(texto('td', fila[campo] ?? '—'))
      body.append(tr)
    }
    tabla.append(head, body)
    contenido.replaceChildren(tabla)
    if (!filas.length) contenido.append(texto('p', 'No hay datos disponibles.'))
  }
  async function activar(contexto) {
    const modulos = await acceso.modulosHabilitados()
    panel.classList.remove('oculto')
    form.classList.add('oculto')
    vista.querySelector('#cuenta-empresa-activa').textContent = contexto.empresa
    vista.querySelector('#cuenta-usuario').textContent =
      perfil.usuario.email ?? perfil.usuario.nombre
    for (const boton of panel.querySelectorAll('[data-permiso]')) {
      const habilitado = !boton.dataset.modulo || modulos.includes(boton.dataset.modulo)
      boton.classList.toggle(
        'oculto',
        !contexto.permite(boton.dataset.permiso) || !habilitado
      )
    }
    vista.querySelector('#cuenta-modulos').textContent = modulos.length
      ? `Módulos habilitados: ${modulos.join(', ')}`
      : 'Esta empresa todavía no tiene módulos habilitados.'
    contenido.replaceChildren()
    campanias.replaceChildren()
    if (
      modulos.includes('HARVEST') &&
      (contexto.permite('harvest.view') || contexto.permite('reports.view'))
    ) {
      for (const c of await acceso.listarCampanias()) {
        const opcion = texto('option', `${c.codigo} · ${c.nombre}`)
        opcion.value = c.id
        campanias.append(opcion)
      }
    }
    if (comercialUI) await comercialUI.activar()
  }
  async function elegir(tenantId) {
    await activar(await acceso.seleccionarEmpresa(tenantId))
  }
  function listarEmpresas() {
    empresas.replaceChildren()
    for (const empresa of perfil.empresas) {
      const boton = texto('button', empresa.nombre)
      boton.type = 'button'
      boton.className = 'btn-secondary'
      boton.addEventListener('click', () => tarea(() => elegir(empresa.id)))
      empresas.append(boton)
    }
    if (!perfil.empresas.length)
      estado('Su cuenta todavía no tiene una empresa asignada.')
    else if (perfil.empresas.length > 1)
      estado('Seleccione la empresa con la que quiere trabajar.')
  }
  document.querySelector('#btn-ingreso-cuenta').addEventListener('click', () => {
    mostrar()
    vista.querySelector('#cuenta-email').focus()
    tarea(async () => {
      perfil = await acceso.obtenerIdentidad()
      form.classList.add('oculto')
      listarEmpresas()
      if (perfil.membresias.length === 1) await elegir(perfil.membresias[0].tenantId)
    })
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const email = vista.querySelector('#cuenta-email').value.trim()
    const password = vista.querySelector('#cuenta-password').value
    vista.querySelector('#cuenta-password').value = ''
    tarea(async () => {
      perfil = await acceso.iniciarSesion({ email, password })
      form.classList.add('oculto')
      listarEmpresas()
      if (perfil.contexto) await activar(perfil.contexto)
    })
  })
  vista.querySelector('#btn-cuenta-salir').addEventListener('click', () =>
    tarea(async () => {
      await acceso.cerrarSesion()
      comercialUI?.ocultar()
      perfil = null
      contenido.replaceChildren()
      empresas.replaceChildren()
      panel.classList.add('oculto')
      form.classList.remove('oculto')
      vista.classList.add('oculto')
      login.classList.remove('oculto')
      estado('')
    })
  )
  vista.querySelector('#btn-cuenta-campanias').addEventListener('click', () =>
    tarea(async () => {
      tabla(await acceso.listarCampanias(), [
        ['Código', 'codigo'],
        ['Campaña', 'nombre'],
        ['Estado', 'estado']
      ])
    })
  )
  vista.querySelector('#btn-cuenta-trabajadores').addEventListener('click', () =>
    tarea(async () => {
      tabla(await acceso.listarTrabajadores(), [
        ['DNI', 'dni'],
        ['Nombres', 'nombres'],
        ['Apellidos', 'apellidos'],
        ['Activo', 'activo']
      ])
    })
  )
  vista.querySelector('#btn-cuenta-equipo').addEventListener('click', () =>
    tarea(async () => {
      tabla((await acceso.listarEquipo()).miembros, [
        ['Cuenta', 'nombre'],
        ['Correo', 'email'],
        ['Membresía activa', 'activo']
      ])
    })
  )
  vista.querySelector('#btn-cuenta-reporte').addEventListener('click', () =>
    tarea(async () => {
      if (!campanias.value) throw new Error('Seleccione una campaña.')
      const reporte = await acceso.obtenerReporte(campanias.value, 'RESUMEN')
      const r = reporte.resumen
      tabla(
        [
          {
            jabas: r.total_jabas,
            cosechadores: r.total_cosechadores,
            sesiones: r.total_sesiones
          }
        ],
        [
          ['Jabas', 'jabas'],
          ['Cosechadores', 'cosechadores'],
          ['Sesiones', 'sesiones']
        ]
      )
    })
  )
}
