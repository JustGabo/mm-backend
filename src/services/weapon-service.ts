import { supabase, Weapon, WeaponSelectionOptions } from '../services/supabase'

const SCENARIO_TAG_MAP: Record<string, string> = {
  'mansion': 'mansion',
  'hotel': 'hotel',
  'oficina': 'office',
  'barco': 'boat',
  'teatro': 'theater',
  'museo': 'museum',
  'aleatorio': 'random',
}

export class WeaponService {
  static async selectWeapon(options: WeaponSelectionOptions): Promise<Weapon | null> {
    const { scene, style, preferSpecific = true } = options

      console.log('🔫 WEAPON SERVICE: Selecting weapon for scene:', scene || 'random', 'with style:', style || 'any')
      console.log('🔫 WEAPON SERVICE: Options received:', options)

    try {
      const sceneTag = scene ? SCENARIO_TAG_MAP[scene] || scene : null
      console.log('🔫 WEAPON SERVICE: Scene tag mapped to:', sceneTag)

      let selectedWeapon: Weapon | null = null

      // Selección aleatoria: 50% chance para específico del escenario, 50% para cualquier arma
      const useSpecificChance = Math.random() < 0.5
      console.log('🔫 WEAPON SERVICE: Random chance for specific weapon:', useSpecificChance ? 'YES' : 'NO')

      if (sceneTag && sceneTag !== 'random' && preferSpecific && useSpecificChance) {
        // 1. Intentar obtener un arma específica del escenario
        console.log(`🎯 Looking for scene-specific weapon for: ${sceneTag}`)
        let query = supabase
          .from('weapons')
          .select('*')
          .contains('tags', [sceneTag])
          .limit(5) // Obtener varias para selección aleatoria

        if (style) {
          query = query.eq('style', style)
        }

        const { data: sceneWeapons, error: sceneError } = await query
        console.log('🔫 WEAPON SERVICE: Scene weapons query result:', { data: sceneWeapons, error: sceneError })

        if (sceneError) {
          console.warn('⚠️ Error fetching scene-specific weapons:', sceneError)
        } else if (sceneWeapons && sceneWeapons.length > 0) {
          const randomIndex = Math.floor(Math.random() * sceneWeapons.length)
          selectedWeapon = sceneWeapons[randomIndex]
          console.log(`✅ Selected scene-specific weapon: ${selectedWeapon?.name.es}`)
        }
      }

      // Si no se seleccionó un arma específica, obtener cualquier arma aleatoria
      if (!selectedWeapon) {
        console.log('🔄 Looking for any random weapon...')
        let query = supabase
          .from('weapons')
          .select('*')
          .limit(20) // Obtener más armas para mayor variedad

        if (style) {
          query = query.eq('style', style)
        }

        const { data: randomWeapons, error: randomError } = await query
        console.log('🔫 WEAPON SERVICE: Random weapons query result:', { data: randomWeapons, error: randomError })

        if (randomError) {
          console.warn('⚠️ Error fetching random weapons:', randomError)
        } else if (randomWeapons && randomWeapons.length > 0) {
          const randomIndex = Math.floor(Math.random() * randomWeapons.length)
          selectedWeapon = randomWeapons[randomIndex]
          console.log(`✅ Selected random weapon: ${selectedWeapon?.name.es}`)
        }
      }

      if (!selectedWeapon) {
        console.warn('⚠️ No weapon found, trying fallback without style filter...')
        const { data: fallbackWeapons, error: fallbackError } = await supabase
          .from('weapons')
          .select('*')
          .limit(10)

        console.log('🔫 WEAPON SERVICE: Fallback weapons query result:', { data: fallbackWeapons, error: fallbackError })

        if (fallbackError) {
          console.error('❌ Error fetching fallback weapons:', fallbackError)
        } else if (fallbackWeapons && fallbackWeapons.length > 0) {
          const randomIndex = Math.floor(Math.random() * fallbackWeapons.length)
          selectedWeapon = fallbackWeapons[randomIndex]
          console.log(`✅ Selected fallback weapon: ${selectedWeapon?.name.es}`)
        }
      }

      if (!selectedWeapon) {
        console.error('❌ No weapon could be selected after all attempts.')
      }

      return selectedWeapon

    } catch (error) {
      console.error('❌ Error in selectWeapon:', error)
      throw error
    }
  }
}
