import { supabase, Suspect, SuspectSelectionOptions, testSupabaseConnection } from '../services/supabase'

// Mapeo de escenarios del frontend a tags de Supabase
const SCENARIO_TAG_MAP: Record<string, string> = {
  'mansion': 'mansion',
  'hotel': 'hotel',
  'oficina': 'office',
  'barco': 'boat',
  'teatro': 'theater',
  'museo': 'museum',
  'aleatorio': 'random', // Para el caso aleatorio
}

export class SuspectService {
  /**
   * Calcula cuántos extras incluir según el número total de sospechosos
   */
  private static calculateExtrasCount(totalCount: number): number {
    if (totalCount <= 3) return 0      // 0 extras para 1-3 sospechosos
    if (totalCount <= 5) return 1      // 1 extra para 4-5 sospechosos
    if (totalCount <= 7) return 2      // 2 extras para 6-7 sospechosos
    return Math.floor(totalCount * 0.3) // 30% extras para 8+ sospechosos
  }

  /**
   * Obtiene sospechosos inteligentemente: del escenario + extras
   */
  static async getSuspectsForScene(options: SuspectSelectionOptions): Promise<Suspect[]> {
    const { count, scene, style } = options

    console.log('🔍 SUSPECT SERVICE: Getting', count, 'suspects for scene:', scene || 'random', 'with style:', style || 'any')

    // Probar la conexión primero
    const connectionTest = await testSupabaseConnection()
    if (!connectionTest.success) {
      throw new Error(`Error de conexión con Supabase: ${connectionTest.error}`)
    }

    // Determinar el tag de Supabase basado en el escenario
    const sceneTag = scene ? SCENARIO_TAG_MAP[scene] || scene : null
    
    // Calcular cuántos extras necesitamos
    const extrasCount = this.calculateExtrasCount(count)
    const sceneSpecificCount = count - extrasCount

    console.log(`📊 Distribution: ${sceneSpecificCount} from scene, ${extrasCount} extras`)

    let result: Suspect[] = []

    try {
      // Si hay un escenario específico, obtener sospechosos del escenario + extras
      if (sceneTag && sceneTag !== 'random') {
        // 1. Obtener sospechosos del escenario específico
        let query = supabase
          .from('suspects')
          .select('*')
          .contains('tags', [sceneTag])
          .limit(sceneSpecificCount * 3) // Obtener más para poder mezclar

        // Filtrar por estilo si se especifica
        if (style) {
          query = query.eq('style', style)
        }

        const { data: sceneData, error: sceneError } = await query

        if (sceneError) {
          console.error('❌ Error fetching scene suspects:', sceneError)
          throw new Error(`Error al obtener sospechosos del escenario: ${sceneError.message}`)
        }

        console.log(`✅ Found ${sceneData?.length || 0} suspects for scene '${sceneTag}'`)

        // Mezclar y seleccionar
        const shuffledScene = (sceneData || []).sort(() => Math.random() - 0.5)
        const selectedScene = shuffledScene.slice(0, sceneSpecificCount)
        result.push(...selectedScene)
        
        // Track de IDs agregados para evitar duplicados
        const addedIds = new Set(selectedScene.map(s => s.id))

        // 2. Si necesitamos extras, obtenerlos
        if (extrasCount > 0) {
          let extrasQuery = supabase
            .from('suspects')
            .select('*')
            .contains('tags', ['extra'])
            .limit(extrasCount * 3)

          // Filtrar por estilo si se especifica
          if (style) {
            extrasQuery = extrasQuery.eq('style', style)
          }

          const { data: extrasData, error: extrasError } = await extrasQuery

          if (extrasError) {
            console.warn('⚠️ Error fetching extras, continuing without them:', extrasError)
          } else {
            console.log(`✅ Found ${extrasData?.length || 0} extra suspects`)
            const shuffledExtras = (extrasData || []).sort(() => Math.random() - 0.5)
            
            // Filtrar extras para evitar duplicados
            const uniqueExtras = shuffledExtras.filter(s => !addedIds.has(s.id))
            const selectedExtras = uniqueExtras.slice(0, extrasCount)
            
            // Actualizar IDs agregados
            selectedExtras.forEach(s => addedIds.add(s.id))
            
            result.push(...selectedExtras)
            
            console.log(`🎭 Added ${selectedExtras.length} extras (filtered for duplicates):`)
            selectedExtras.forEach((extra, i) => {
              console.log(`  Extra ${i + 1}: ${extra.occupation?.es || extra.occupation}`)
            })
          }
        }

      } else {
        // Modo aleatorio: DISTRIBUIR EQUITATIVAMENTE entre diferentes escenarios
        console.log('🎲 Random mode: Getting suspects with EQUITABLE DISTRIBUTION across scenarios')
        console.log(`🎲 Query parameters: count=${count}, style=${style || 'any'}`)
        
        // Lista de todos los tags de escenario disponibles
        const scenarioTags = ['mansion', 'hotel', 'office', 'boat', 'theater', 'museum']
        
        // Calcular cuántos sospechosos obtener de cada tag para distribución equitativa
        const suspectsPerTag = Math.ceil((count * 3) / scenarioTags.length) // Obtener más para luego seleccionar
        console.log(`🎲 Will fetch ~${suspectsPerTag} suspects from EACH scenario tag, then randomly select ${count}`)
        
        const allSuspects: Suspect[] = []
        const addedIds = new Set<string>()

        // Obtener sospechosos de cada tag de escenario
        for (const tag of scenarioTags) {
          try {
            console.log(`🎲 Fetching suspects with tag: ${tag}`)
            let tagQuery = supabase
              .from('suspects')
              .select('*')
              .contains('tags', [tag])
              .limit(suspectsPerTag)

            // Filtrar por estilo si se especifica
            if (style) {
              tagQuery = tagQuery.eq('style', style)
            }

            const { data: tagData, error: tagError } = await tagQuery

            if (tagError) {
              console.warn(`⚠️ Error fetching suspects with tag '${tag}':`, tagError)
              continue
            }

            if (tagData && tagData.length > 0) {
              console.log(`   ✅ Found ${tagData.length} suspects with tag '${tag}'`)
              
              // Filtrar duplicados y agregar
              const uniqueSuspects = tagData.filter(s => !addedIds.has(s.id))
              uniqueSuspects.forEach(s => addedIds.add(s.id))
              allSuspects.push(...uniqueSuspects)
            } else {
              console.log(`   ⚠️ No suspects found with tag '${tag}'`)
            }
          } catch (error) {
            console.warn(`⚠️ Error processing tag '${tag}':`, error)
            continue
          }
        }

        // SIEMPRE obtener sospechosos con tag "extra" (y "random" si hay) para modo aleatorio
        console.log('🎲 Fetching suspects with tag "extra" (always included in random mode)')
        let extraQuery = supabase
          .from('suspects')
          .select('*')
          .or('tags.cs.{random},tags.cs.{extra}')
          .limit(Math.max(suspectsPerTag * 2, count * 2))

        if (style) {
          extraQuery = extraQuery.eq('style', style)
        }

        const { data: extraData, error: extraError } = await extraQuery

        if (!extraError && extraData && extraData.length > 0) {
          console.log(`   ✅ Found ${extraData.length} suspects with "extra" or "random" tags`)
          const uniqueExtras = extraData.filter(s => !addedIds.has(s.id))
          uniqueExtras.forEach(s => addedIds.add(s.id))
          allSuspects.push(...uniqueExtras)
          console.log(`   ✅ Added ${uniqueExtras.length} unique suspects from "extra"/"random" tags to pool`)
        } else {
          console.log(`   ⚠️ No suspects found with "extra" or "random" tags`)
        }

        console.log(`🎲 Total suspects collected from all tags: ${allSuspects.length}`)
        
        // Mostrar distribución por tag
        const tagDistribution: Record<string, number> = {}
        allSuspects.forEach(s => {
          if (s.tags && Array.isArray(s.tags)) {
            s.tags.forEach(tag => {
              // Incluir tags de escenario, "extra", y "random"
              if (scenarioTags.includes(tag) || tag === 'extra' || tag === 'random') {
                tagDistribution[tag] = (tagDistribution[tag] || 0) + 1
              }
            })
          }
        })
        console.log('🎲 Distribution by tag (scenarios + extra/random):')
        Object.entries(tagDistribution)
          .sort((a, b) => b[1] - a[1])
          .forEach(([tag, count]) => {
            console.log(`   - ${tag}: ${count} suspects`)
          })
        
        // Shuffle y seleccionar
        const shuffled = allSuspects.sort(() => Math.random() - 0.5)
        console.log('🎲 Shuffled all suspects, selecting first', count)
        result = shuffled.slice(0, count)
        
        // Mostrar los seleccionados después del shuffle
        console.log('🎲 Selected suspects AFTER shuffle:')
        const finalTagDistribution: Record<string, number> = {}
        result.forEach((s, i) => {
          console.log(`   ${i + 1}. ID: ${s.id} - ${s.occupation?.es || 'NO_OCCUPATION'} - Tags: ${s.tags?.join(', ') || 'NO_TAGS'}`)
          if (s.tags && Array.isArray(s.tags)) {
            s.tags.forEach(tag => {
              // Incluir tags de escenario, "extra", y "random"
              if (scenarioTags.includes(tag) || tag === 'extra' || tag === 'random') {
                finalTagDistribution[tag] = (finalTagDistribution[tag] || 0) + 1
              }
            })
          }
        })
        console.log('🎲 Final distribution in selected suspects (scenarios + extra/random):')
        Object.entries(finalTagDistribution)
          .sort((a, b) => b[1] - a[1])
          .forEach(([tag, count]) => {
            console.log(`   - ${tag}: ${count} (${((count / result.length) * 100).toFixed(1)}%)`)
          })
      }

    } catch (error) {
      console.error('❌ Error in getSuspectsForScene:', error)
      
      // Proporcionar mensajes de error más específicos
      if (error instanceof Error) {
        if (error.message.includes('fetch failed')) {
          throw new Error('Error de conexión con Supabase. Verifica tu conexión a internet y las variables de entorno.')
        } else if (error.message.includes('Invalid API key')) {
          throw new Error('Clave de API de Supabase inválida. Verifica NEXT_PUBLIC_SUPABASE_ANON_KEY.')
        } else if (error.message.includes('Invalid URL')) {
          throw new Error('URL de Supabase inválida. Verifica NEXT_PUBLIC_SUPABASE_URL.')
        } else {
          throw new Error(`Error al obtener sospechosos: ${error.message}`)
        }
      }
      
      throw new Error('Error desconocido al obtener sospechosos')
    }

    // Si no obtuvimos suficientes sospechosos, intentar llenar con cualquiera
    if (result.length < count) {
      console.log(`⚠️ Only got ${result.length}/${count} suspects, filling with random ones...`)
      
      // Track de IDs agregados para evitar duplicados al rellenar
      const addedIds = new Set(result.map(s => s.id))
      
      let fillQuery = supabase
        .from('suspects')
        .select('*')
        .limit((count - result.length) * 3) // Obtener más para poder filtrar duplicados

      // Filtrar por estilo si se especifica
      if (style) {
        fillQuery = fillQuery.eq('style', style)
      }

      const { data: fillData } = await fillQuery

      if (fillData) {
        const shuffled = fillData.sort(() => Math.random() - 0.5)
        
        // Filtrar para evitar duplicados
        const uniqueFill = shuffled.filter(s => !addedIds.has(s.id))
        const needed = count - result.length
        const toAdd = uniqueFill.slice(0, needed)
        
        result.push(...toAdd)
        
        console.log(`✅ Added ${toAdd.length} unique suspects to fill (avoided ${shuffled.length - uniqueFill.length} duplicates)`)
      }
    }

    // ULTIMA VERIFICACIÓN: eliminar duplicados por ID por si acaso
    const uniqueResult = result.filter((suspect, index, self) => 
      index === self.findIndex((s) => s.id === suspect.id)
    )
    
    if (uniqueResult.length < result.length) {
      console.log(`⚠️ Removed ${result.length - uniqueResult.length} duplicate suspects`)
    }

    console.log(`🎯 FINAL RESULT: Returning ${uniqueResult.length} unique suspects:`)
    uniqueResult.forEach((suspect, index) => {
      const tags = suspect.tags?.join(', ') || 'no-tags'
      const isExtra = suspect.tags?.includes('extra') ? '⭐ EXTRA' : ''
      console.log(`  ${index + 1}. ${suspect.id || 'NO_ID'} - ${suspect.gender || 'NO_GENDER'} - ${suspect.approx_age || 'NO_AGE'} - ${suspect.occupation?.es || suspect.occupation || 'NO_OCCUPATION'} - [${tags}] ${isExtra}`)
    })

    return uniqueResult
  }

  /**
   * Obtiene todos los sospechosos disponibles para un escenario específico
   */
  static async getAllSuspectsForScene(scene: string): Promise<Suspect[]> {
    const { data, error } = await supabase
      .from('suspects')
      .select('*')
      .or(`tags.cs.{${scene}},tags.cs.{random}`)
      .order('occupation', { ascending: true })

    if (error) {
      console.error('Error fetching all suspects:', error)
      throw new Error(`Error al obtener todos los sospechosos: ${error.message}`)
    }

    return data || []
  }

  /**
   * Obtiene ocupaciones únicas disponibles para un escenario
   */
  static async getOccupationsForScene(scene: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('suspects')
      .select('occupation')
      .or(`tags.cs.{${scene}},tags.cs.{random}`)

    if (error) {
      console.error('Error fetching occupations:', error)
      return []
    }

    // Extraer ocupaciones únicas del campo es (español)
    const occupations = [...new Set(data?.map(item => item.occupation?.es) || [])]
    return occupations.filter(Boolean).sort()
  }

  /**
   * Obtiene un sospechoso específico por ID
   */
  static async getSuspectById(id: string): Promise<Suspect | null> {
    const { data, error } = await supabase
      .from('suspects')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Error fetching suspect by ID:', error)
      return null
    }

    return data
  }
}

