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

/** Shape returned by PostgREST / Supabase client on failed queries */
export type PostgrestLikeError = {
  message: string
  details?: string | null
  hint?: string | null
  code?: string
}

/**
 * Human-readable PostgREST error (use when `error` is non-null — avoid logging `{ error: null }` as if it were a failure).
 */
export function describePostgrestError(err: PostgrestLikeError | null | undefined): string {
  if (err == null) {
    return '(no error)'
  }
  const parts = [
    err.code && `code=${err.code}`,
    err.message && `message=${err.message}`,
    err.details && `details=${err.details}`,
    err.hint && `hint=${err.hint}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : String(err)
}

/**
 * One-line summary for logs. When `error` is null, PostgREST succeeded; `rowCount` may still be 0 (no matching rows).
 * A real failure is always `error !== null` — compare that to an empty result (`error === null`, rowCount 0).
 */
export function supabaseResultSummary(
  data: unknown[] | null | undefined,
  error: PostgrestLikeError | null
): string {
  if (error) {
    return `failed: ${describePostgrestError(error)}`
  }
  const n = Array.isArray(data) ? data.length : 0
  return `ok, ${n} row(s), error=null`
}

/**
 * Función para probar la conexión con Supabase (solo registra fallos salvo `logSuccess`)
 */
export async function testSupabaseConnection(options?: {
  logSuccess?: boolean
}): Promise<{ success: boolean; error?: string }> {
  const logSuccess = options?.logSuccess ?? false
  try {
    const { error } = await supabase
      .from('suspects')
      .select('id')
      .limit(1)

    if (error) {
      console.error(
        '[supabase] connection check failed:',
        describePostgrestError(error),
        { table: 'suspects', operation: 'select id limit 1' }
      )
      return { success: false, error: error.message }
    }

    if (logSuccess) {
      console.log('[supabase] connection ok')
    }
    return { success: true }
  } catch (error) {
    console.error('[supabase] connection check exception:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
  /** Request/case fields for correlating logs when queries fail */
  logContext?: Record<string, unknown>
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
  /** Request/case fields for correlating logs when queries fail */
  logContext?: Record<string, unknown>
}

/**
 * Room management interfaces for shared-room mode (multijugador)
 */

export interface Room {
  id: string
  created_at: string
  state: string | null
  current_turn_player_id: string | null
  timeline_index: number | null
  host_id: string | null
  max_players: number | null
  case_data?: any // Datos del caso generado (JSONB)
  discussion_data?: any // Datos de las rondas de discusión generadas (JSONB)
  is_generating_discussion?: boolean // Flag para indicar que se están generando las rondas
  accusations?: any // Acusaciones de los jugadores (JSONB)
}

export interface Player {
  id: string
  created_at: string
  room_id: string
  user_id: string | null
  name: string | null
  img_url?: string | null
  pixel_img_url?: string | null
  is_ready: boolean | null
  role_data: any | null
  joined_at: string | null
  gender: string | null
}

/**
 * Get players in a room
 */
export async function getRoomPlayers(roomId: string): Promise<{ success: boolean; error?: string; players?: Player[] }> {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true })

    if (error) {
      console.error('❌ Error fetching players:', error)
      return { success: false, error: error.message }
    }

    return { success: true, players: data || [] }
  } catch (error) {
    console.error('❌ Error fetching players:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Get case data from a room
 */
export async function getCaseFromRoom(
  roomId: string
): Promise<{ success: boolean; error?: string; caseData?: any }> {
  try {
    console.log(`🔍 Fetching case data from room ${roomId}...`)
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('rooms')
      .select('case_data')
      .eq('id', roomId)
      .single()

    if (error) {
      console.error('[supabase] getCaseFromRoom failed', {
        roomId,
        supabase: describePostgrestError(error),
      })
      return { success: false, error: error.message }
    }
    return { success: true, caseData: data?.case_data || null }
  } catch (error) {
    console.error('❌ Error getting case from room:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
