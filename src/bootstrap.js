import { crearCasosDeUso } from './application/crearCasosDeUso.js'
import { configurarCasosDeUso } from './application/casosDeUso.js'
import { crearAdaptadoresOffline } from './infrastructure/offline/crearAdaptadoresOffline.js'
import { backend, configurarBackend } from '@gesgrow/core/backend/backend.js'
import { crearSupabaseBackend } from './infrastructure/supabase/backendAdapter.js'
import { supabase, supabaseOperativo } from './infrastructure/supabase/client.js'
import { crearIdentitySupabase } from './infrastructure/supabase/identityAdapter.js'
import { crearAccesoSupabase } from './infrastructure/supabase/accesoAdapter.js'
import { crearAccesoEmpresa } from './application/accesoEmpresa.js'
import { crearEntitlementsSupabase } from './infrastructure/supabase/platformEntitlementsAdapter.js'
import { crearComercialSupabase } from './infrastructure/supabase/platformComercialAdapter.js'
import { crearAdministracionComercial } from '@gesgrow/core/contexts/platform/index.js'
import { configurarVistaAccesoEmpresa } from './modules/accesoEmpresa.js'
import { crearVinculacionDispositivo } from './application/vinculacionDispositivo.js'
import { crearDispositivoIndexedDB } from './infrastructure/indexeddb/dispositivoAdapter.js'
import { crearDispositivoSupabase } from './infrastructure/supabase/dispositivoAdapter.js'
import { comprobarTrabajoDispositivo } from './offline/db.js'
import { configurarVinculacionDispositivo } from './modules/vinculacionDispositivo.js'
import { configurarSalidaDispositivo } from './modules/sesionDispositivo.js'
import './style.css'
import './vinculacion.css'
import {
  protegerBackendDispositivo,
  protegerCasosDispositivo
} from './application/protegerDispositivo.js'

const accesoCuenta = crearAccesoEmpresa({
  identity: crearIdentitySupabase(supabase),
  acceso: crearAccesoSupabase(supabase),
  entitlements: crearEntitlementsSupabase(supabase)
})
const administracionComercial = crearAdministracionComercial({
  tenantContext: accesoCuenta.tenantContext,
  comercial: crearComercialSupabase(supabase)
})

let pantallaPda,
  cargado = false
const dispositivo = crearVinculacionDispositivo({
  remoto: crearDispositivoSupabase(supabase),
  almacen: crearDispositivoIndexedDB(),
  enLinea: () => navigator.onLine,
  comprobarDatos: comprobarTrabajoDispositivo,
  alBloquear: (error) => pantallaPda?.bloquear(error)
})
const campo = crearSupabaseBackend(supabaseOperativo)
// Componer los contratos existentes sin reenviar comandos de otra cuenta.
configurarBackend(protegerBackendDispositivo(campo, dispositivo))
const casos = crearCasosDeUso({
  backend,
  offline: crearAdaptadoresOffline(),
  estaEnLinea: () => navigator.onLine,
  generarId: () => crypto.randomUUID(),
  ahora: () => new Date().toISOString(),
  registrarError: (...args) => console.error(...args)
})
configurarCasosDeUso(protegerCasosDispositivo(casos, dispositivo))
configurarSalidaDispositivo(async () => {
  await dispositivo.salir()
  location.reload()
})
pantallaPda = await configurarVinculacionDispositivo({
  servicio: dispositivo,
  origenesQR: ['https://gg-app-m-harvest.vercel.app'],
  alIngresar: async (operador) => {
    sessionStorage.setItem('operador_dni', operador.dni)
    document.querySelector('#vista-vinculacion').classList.add('oculto')
    if (cargado) {
      location.reload()
      return
    }
    cargado = true
    await import('./main.js')
    configurarVistaAccesoEmpresa({
      acceso: accesoCuenta,
      comercial: administracionComercial
    })
  }
})
await pantallaPda?.restaurar()
const revisar = () => {
  if (cargado) dispositivo.validar({ forzar: true }).catch(() => {})
}
window.addEventListener('online', revisar)
window.addEventListener('focus', revisar)
setInterval(revisar, 30000)
