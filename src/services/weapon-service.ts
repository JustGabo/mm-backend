import {
  supabase,
  Weapon,
  WeaponSelectionOptions,
  describePostgrestError,
  supabaseResultSummary,
} from '../services/supabase.js'

const SCENARIO_TAG_MAP: Record<string, string> = {
  mansion: 'mansion',
  hotel: 'hotel',
  oficina: 'office',
  barco: 'boat',
  teatro: 'theater',
  museo: 'museum',
  aleatorio: 'random',
}

type WeaponSource = 'scene' | 'random' | 'fallback'

export class WeaponService {
  static async selectWeapon(options: WeaponSelectionOptions): Promise<Weapon | null> {
    const { scene, style, preferSpecific = true, logContext } = options

    const baseLog = {
      ...logContext,
      scene: scene ?? null,
      style: style ?? null,
      preferSpecific,
    }

    try {
      const sceneTag = scene ? SCENARIO_TAG_MAP[scene] || scene : null

      let selectedWeapon: Weapon | null = null
      let source: WeaponSource | null = null

      const useSpecificChance = Math.random() < 0.5

      const steps: Record<string, string> = {
        sceneBranchAttempted: String(
          Boolean(sceneTag && sceneTag !== 'random' && preferSpecific && useSpecificChance)
        ),
        randomGate_useSpecificChance: String(useSpecificChance),
      }

      if (sceneTag && sceneTag !== 'random' && preferSpecific && useSpecificChance) {
        let query = supabase
          .from('weapons')
          .select('*')
          .contains('tags', [sceneTag])
          .limit(5)

        if (style) {
          query = query.eq('style', style)
        }

        const { data: sceneWeapons, error: sceneError } = await query

        steps.sceneQuery = supabaseResultSummary(sceneWeapons ?? [], sceneError)

        if (sceneError) {
          console.error('[weapon] scene-specific query failed', {
            ...baseLog,
            sceneTag,
            query: { tagsContains: [sceneTag], style: style ?? null },
            supabase: describePostgrestError(sceneError),
          })
        } else if (sceneWeapons && sceneWeapons.length > 0) {
          const randomIndex = Math.floor(Math.random() * sceneWeapons.length)
          selectedWeapon = sceneWeapons[randomIndex]
          source = 'scene'
        }
      } else {
        steps.sceneQuery = 'skipped (random gate or no scene tag)'
      }

      if (!selectedWeapon) {
        let query = supabase.from('weapons').select('*').limit(20)

        if (style) {
          query = query.eq('style', style)
        }

        const { data: randomWeapons, error: randomError } = await query

        steps.randomPoolQuery = supabaseResultSummary(randomWeapons ?? [], randomError)

        if (randomError) {
          console.error('[weapon] random pool query failed', {
            ...baseLog,
            sceneTag,
            query: { style: style ?? null, limit: 20 },
            supabase: describePostgrestError(randomError),
          })
        } else if (randomWeapons && randomWeapons.length > 0) {
          const randomIndex = Math.floor(Math.random() * randomWeapons.length)
          selectedWeapon = randomWeapons[randomIndex]
          source = 'random'
        }
      }

      if (!selectedWeapon) {
        const { data: fallbackWeapons, error: fallbackError } = await supabase
          .from('weapons')
          .select('*')
          .limit(10)

        steps.fallbackQuery = supabaseResultSummary(fallbackWeapons ?? [], fallbackError)

        if (fallbackError) {
          console.error('[weapon] fallback query failed', {
            ...baseLog,
            query: { limit: 10, noStyleFilter: true },
            supabase: describePostgrestError(fallbackError),
          })
        } else if (fallbackWeapons && fallbackWeapons.length > 0) {
          const randomIndex = Math.floor(Math.random() * fallbackWeapons.length)
          selectedWeapon = fallbackWeapons[randomIndex]
          source = 'fallback'
        }
      }

      if (!selectedWeapon) {
        console.error('[weapon] no weapon selected after all attempts', {
          ...baseLog,
          sceneTag,
        })
        return null
      }

      const nameEs = selectedWeapon.name?.es ?? '?'
      console.log('[weapon] ok', {
        ...baseLog,
        weaponId: selectedWeapon.id,
        name: nameEs,
        source,
        steps,
      })

      return selectedWeapon
    } catch (error) {
      console.error('[weapon] selectWeapon exception', { ...baseLog, error })
      throw error
    }
  }
}
