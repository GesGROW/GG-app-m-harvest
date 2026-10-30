import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// El transporte de campo lleva la credencial del PDA por petición. Se mantiene
// separado del JWT de la cuenta que autoriza la vinculación inicial.
export const supabaseOperativo = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'gesgrow-campo-compatibilidad'
  }
})
