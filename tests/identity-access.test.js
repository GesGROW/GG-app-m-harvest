import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Usuario,
  MembresiaEmpresa,
  RolAplicacion,
  Permiso,
  TenantContext,
  crearAccesoAutenticado,
  ROLES_APLICACION
} from '@gesgrow/core/contexts/identity-access/index.js'
import { crearAccesoEmpresa } from '../src/application/accesoEmpresa.js'
import { crearIdentitySupabase } from '../src/infrastructure/supabase/identityAdapter.js'
import { crearAccesoSupabase } from '../src/infrastructure/supabase/accesoAdapter.js'

const contexto = (tenantId = 'A', permisos = ['harvest.view']) => ({
  usuarioId: 'U',
  membresiaId: 'M-' + tenantId,
  tenantId,
  empresa: tenantId,
  permisos
})
function preparar(tenants = ['A']) {
  let sesion = { sujeto: 'SUJETO' },
    permisos = ['harvest.view']
  const llamadas = []
  const identity = {
    iniciarSesion: async () => {
      sesion = { sujeto: 'SUJETO' }
    },
    obtenerSesion: async () => sesion,
    cerrarSesion: async () => {
      sesion = null
    }
  }
  const acceso = {
    obtenerIdentidad: async () => ({
      usuario: { id: 'U', nombre: 'Cuenta' },
      empresas: tenants.map((id) => ({ id, nombre: id })),
      membresias: tenants.map((tenantId) => ({
        id: 'M-' + tenantId,
        usuarioId: 'U',
        tenantId,
        activo: true
      }))
    }),
    resolverContexto: async (id) => {
      llamadas.push(['resolver', id])
      if (!id && tenants.length !== 1)
        throw new Error(tenants.length ? 'Seleccione empresa' : 'Sin membresía')
      id ??= tenants[0]
      if (!tenants.includes(id)) throw new Error('Empresa no autorizada')
      return contexto(id, permisos)
    },
    listarCampanias: async (id) => [{ id: 'C-' + id, tenant_id: id }],
    guardarTrabajador: async (id, datos) => {
      llamadas.push(['guardar', id, datos])
      return { id: 'W', tenant_id: id }
    },
    asignarLote: async (datos) => {
      llamadas.push(['asignar', datos])
      return { ok: true }
    }
  }
  return {
    identity,
    acceso,
    entitlements: { puedeUsarModulo: async () => true },
    llamadas,
    setPermisos: (p) => {
      permisos = p
    }
  }
}
test('Usuario y Membresía no necesitan Trabajador; vínculo opcional sin fusionar identidades', () => {
  const u = new Usuario({ id: 'U', nombre: 'Administradora' })
  assert.equal(u.dni, undefined)
  assert.equal(u.trabajadorId, undefined)
  assert.equal(
    new MembresiaEmpresa({ id: 'M', usuarioId: u.id, tenantId: 'A' }).trabajadorId,
    null
  )
  assert.equal(
    new MembresiaEmpresa({ id: 'M', usuarioId: u.id, tenantId: 'A', trabajadorId: 'W' })
      .trabajadorId,
    'W'
  )
})
test('roles aportan permisos efectivos; no se compara nombre de rol para autorizar', () => {
  assert.deepEqual(Object.keys(ROLES_APLICACION), [
    'ADMIN_EMPRESA',
    'SUPERVISOR_COSECHA',
    'GESTOR',
    'OPERADOR_CAMPO',
    'CONSULTA'
  ])
  assert.throws(() => new Permiso('JABERO'), /desconocido/)
  const m = new MembresiaEmpresa({ id: 'M', usuarioId: 'U', tenantId: 'A' })
  const rol = new RolAplicacion({
    id: 'R',
    tenantId: 'A',
    codigo: 'LECTOR_PERSONALIZADO',
    permisos: ['harvest.view', 'harvest.view', 'reports.view']
  })
  const permisos = m.permisosEfectivos([rol])
  const c = new TenantContext({ ...contexto(), permisos })
  assert.ok(c.permite('reports.view'))
  assert.throws(() => c.exigir('company.manage'), /No tiene permiso/)
  assert.throws(() => c.exigir('harvest.view', 'B'), /No tiene permiso/)
  assert.throws(
    () =>
      m.permisosEfectivos([
        new RolAplicacion({ id: 'R2', tenantId: 'B', codigo: 'CONSULTA' })
      ]),
    /otra empresa/
  )
  assert.throws(
    () => new MembresiaEmpresa({ ...m, activo: false }).permisosEfectivos([rol]),
    /inactiva/
  )
})
test('sin membresía la sesión no se convierte en TenantContext; con una se selecciona automáticamente', async () => {
  const sin = crearAccesoAutenticado(preparar([]))
  const resultado = await sin.iniciarSesion({
    email: 'a@example.test',
    password: 'secreto'
  })
  assert.equal(resultado.contexto, null)
  await assert.rejects(sin.obtener(), /Sin membresía/)
  const una = crearAccesoAutenticado(preparar())
  assert.equal((await una.iniciarSesion({})).contexto.tenantId, 'A')
  await assert.rejects(una.seleccionarEmpresa('INVENTADA'), /no autorizada/)
  assert.equal((await una.obtener()).tenantId, 'A')
})
test('varias membresías: selección validada en el puerto y revocación de permiso sin caché', async () => {
  const deps = preparar(['A', 'B']),
    servicio = crearAccesoAutenticado(deps)
  assert.equal((await servicio.iniciarSesion({})).contexto, null)
  await assert.rejects(servicio.obtener(), /Seleccione/)
  await servicio.seleccionarEmpresa('B')
  assert.equal((await servicio.obtener()).tenantId, 'B')
  deps.setPermisos([])
  await assert.rejects(servicio.autorizar('harvest.view'), /No tiene permiso/)
  await servicio.cerrarSesion()
  await assert.rejects(servicio.obtener(), /Inicie sesión/)
})
test('Application descarta Tenant de UI y contrasta campaña con TenantContext autorizado', async () => {
  const deps = preparar(['A', 'B']),
    servicio = crearAccesoEmpresa(deps)
  deps.setPermisos(['workforce.manage', 'harvest.operate', 'harvest.view'])
  await servicio.seleccionarEmpresa('A')
  const t = await servicio.guardarTrabajador({
    tenantId: 'B',
    dni: '12345678',
    nombres: 'Ana'
  })
  assert.equal(t.tenant_id, 'A')
  assert.equal(deps.llamadas.find((l) => l[0] === 'guardar')[1], 'A')
  await assert.rejects(
    servicio.asignarLote({ campaniaId: 'C-B' }),
    /empresa seleccionada/
  )
  assert.ok(!deps.llamadas.some((l) => l[0] === 'asignar'))
  assert.deepEqual(await servicio.asignarLote({ campaniaId: 'C-A' }), { ok: true })
})
test('adapter Identity verifica con getUser, no entrega JWT ni necesita DNI', async () => {
  const llamadas = []
  const cliente = {
    auth: {
      signInWithPassword: async (datos) => {
        llamadas.push(['login', datos])
        return { data: { session: { access_token: 'NO-EXPOSICION' } } }
      },
      getUser: async () => ({ data: { user: { id: 'SUJETO' } } }),
      signOut: async () => {
        llamadas.push(['logout'])
        return {}
      }
    }
  }
  const identity = crearIdentitySupabase(cliente)
  await identity.iniciarSesion({
    email: 'a@example.test',
    password: 'clave',
    dni: 'IGNORADO'
  })
  assert.deepEqual(await identity.obtenerSesion(), { sujeto: 'SUJETO' })
  assert.deepEqual(llamadas[0], [
    'login',
    { email: 'a@example.test', password: 'clave' }
  ])
  await identity.cerrarSesion()
  cliente.auth.getUser = async () => ({ error: { name: 'AuthSessionMissingError' } })
  assert.equal(await identity.obtenerSesion(), null)
  cliente.auth.getUser = async () => ({ error: { message: 'Sesión revocada' } })
  await assert.rejects(identity.obtenerSesion(), /revocada/)
})
test('adapter Acceso transmite selección como solicitud; no acepta actor ni permisos de UI', async () => {
  const llamadas = []
  const acceso = crearAccesoSupabase({
    rpc: async (n, p) => {
      llamadas.push([n, p])
      return { data: {} }
    }
  })
  await acceso.resolverContexto('A')
  assert.deepEqual(llamadas[0], ['iam_resolver_tenant_context', { p_tenant_id: 'A' }])
  await acceso.asignarLote({
    campaniaId: 'C',
    trabajadorId: 'W',
    codigo: 'T',
    operacionId: 'O',
    usuarioId: 'FALSO',
    permisos: ['company.manage'],
    dniOperador: 'IGNORADO'
  })
  assert.deepEqual(llamadas[1], [
    'iam_asignar_lote',
    { p_campania_id: 'C', p_trabajador_id: 'W', p_codigo: 'T', p_operacion_id: 'O' }
  ])
})
