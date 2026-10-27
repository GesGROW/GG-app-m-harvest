import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// Las rutas de campo anteriores aún exigen el rol anónimo. No reciben el JWT
// de la cuenta; el arranque las limita al PDA, actor y campañas ya validados.
export const supabaseOperativo = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'gesgrow-campo-compatibilidad'
  }
})
