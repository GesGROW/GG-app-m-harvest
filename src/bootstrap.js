import { crearCasosDeUso } from './application/crearCasosDeUso.js'
import { configurarCasosDeUso } from './application/casosDeUso.js'
import { crearAdaptadoresOffline } from './infrastructure/offline/crearAdaptadoresOffline.js'
import { backend, configurarBackend } from '@gesgrow/core/backend/backend.js'
import { crearSupabaseBackend } from './infrastructure/supabase/backendAdapter.js'
import { supabase } from './infrastructure/supabase/client.js'
import { crearIdentitySupabase } from './infrastructure/supabase/identityAdapter.js'
import { crearAccesoSupabase } from './infrastructure/supabase/accesoAdapter.js'
import { crearAccesoEmpresa } from './application/accesoEmpresa.js'
import { crearEntitlementsSupabase } from './infrastructure/supabase/platformEntitlementsAdapter.js'
import { crearComercialSupabase } from './infrastructure/supabase/platformComercialAdapter.js'
import { crearAdministracionComercial } from '@gesgrow/core/contexts/platform/index.js'
import { configurarVistaAccesoEmpresa } from './modules/accesoEmpresa.js'

const accesoCuenta = crearAccesoEmpresa({
  identity: crearIdentitySupabase(supabase),
  acceso: crearAccesoSupabase(supabase),
  entitlements: crearEntitlementsSupabase(supabase)
})
const administracionComercial = crearAdministracionComercial({
  tenantContext: accesoCuenta.tenantContext,
  comercial: crearComercialSupabase(supabase)
})

configurarBackend(crearSupabaseBackend(supabase))
configurarCasosDeUso(
  crearCasosDeUso({
    backend,
    offline: crearAdaptadoresOffline(),
    estaEnLinea: () => navigator.onLine,
    generarId: () => crypto.randomUUID(),
    ahora: () => new Date().toISOString(),
    registrarError: (...args) => console.error(...args)
  })
)
// Cargar la aplicación después de configurar el puerto, incluida la restauración
// de sesión y sincronización automática que se ejecutan al importar main.
import('./main.js').then(() =>
  configurarVistaAccesoEmpresa({
    acceso: accesoCuenta,
    comercial: administracionComercial
  })
)
