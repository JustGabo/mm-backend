import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy initialization - solo crea el cliente cuando se necesite
let supabaseClient: SupabaseClient | null = null

function initializeSupabase(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Verificar que las variables de entorno estén configuradas
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not defined')
  }

  if (!supabaseKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined')
  }

  console.log('🔗 Supabase URL:', supabaseUrl)
  console.log('🔑 Supabase Key configured:', supabaseKey ? 'Yes' : 'No')

  supabaseClient = createClient(supabaseUrl, supabaseKey)
  return supabaseClient
}

// Exportar getter que inicializa lazy
export function getSupabase(): SupabaseClient {
  return initializeSupabase()
}

// Para compatibilidad con código existente que usa supabase directamente
// Usamos un proxy que inicializa lazy
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = initializeSupabase()
    const value = (client as any)[prop]
    // Si es una función, mantener el contexto 'this'
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  }
})

/**
 * Función para probar la conexión con Supabase
 */
export async function testSupabaseConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('🔍 Testing Supabase connection...')
    
    // Intentar hacer una consulta simple
    const { data, error } = await supabase
      .from('suspects')
      .select('id')
      .limit(1)
    
    if (error) {
      console.error('❌ Supabase connection test failed:', error)
      return { success: false, error: error.message }
    }
    
    console.log('✅ Supabase connection successful')
    return { success: true }
  } catch (error) {
    console.error('❌ Supabase connection test error:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

export interface Suspect {
  id: string
  image_url: string
  gender: 'male' | 'female' | 'other'
  approx_age: number
  occupation: {
    en: string
    es: string
  }
  tags: string[]
  style?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface SuspectSelectionOptions {
  scene?: string
  count: number
  style?: 'realistic' | 'pixel'
  genderPreference?: 'male' | 'female' | 'mixed'
  preferredGenders?: string[];
  occupationFilter?: string[]
  ageRange?: { min: number; max: number }
}

export interface Weapon {
  id: string
  image_url: string
  name: {
    en: string
    es: string
  }
  tags: string[]
  style?: 'realistic' | 'pixel'
  created_at: string
  updated_at: string
}

export interface WeaponSelectionOptions {
  scene?: string
  style?: 'realistic' | 'pixel'
  preferSpecific?: boolean // true = prefer scene-specific, false = prefer universal
}
