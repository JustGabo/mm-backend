import {
  supabase,
  Suspect,
  SuspectSelectionOptions,
  testSupabaseConnection,
  describePostgrestError,
} from '../services/supabase.js'

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
    const { count, scene, style, preferredGenders, logContext } = options

    const baseLog: Record<string, unknown> = {
      ...logContext,
      count,
      scene: scene ?? null,
      style: style ?? null,
      genderFilter: preferredGenders?.length ? preferredGenders.join(',') : null,
    }

    console.log('[suspects] start', baseLog)

    const connectionTest = await testSupabaseConnection()
    if (!connectionTest.success) {
      throw new Error(`Error de conexión con Supabase: ${connectionTest.error}`)
    }

    // Determinar el tag de Supabase basado en el escenario
    const sceneTag = scene ? SCENARIO_TAG_MAP[scene] || scene : null
    
    // Calcular cuántos extras necesitamos
    const extrasCount = this.calculateExtrasCount(count)
    const sceneSpecificCount = count - extrasCount

    let result: Suspect[] = []

    if (preferredGenders && preferredGenders.length > 0) {
      return await this.getSuspectsByGenderPreferences({
        count,
        sceneTag,
        style,
        preferredGenders,
        logContext: baseLog,
      })
    }

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
          console.error('[suspects] scene query failed', {
            ...baseLog,
            sceneTag,
            query: { tagsContains: [sceneTag], style: style ?? null },
            supabase: describePostgrestError(sceneError),
          })
          throw new Error(`Error al obtener sospechosos del escenario: ${sceneError.message}`)
        }

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
            console.warn('[suspects] extras query failed (continuing without extras)', {
              ...baseLog,
              query: { tagsContains: ['extra'], style: style ?? null },
              supabase: describePostgrestError(extrasError),
            })
          } else {
            const shuffledExtras = (extrasData || []).sort(() => Math.random() - 0.5)

            const uniqueExtras = shuffledExtras.filter(s => !addedIds.has(s.id))
            const selectedExtras = uniqueExtras.slice(0, extrasCount)

            selectedExtras.forEach(s => addedIds.add(s.id))

            result.push(...selectedExtras)
          }
        }

      } else {
        const scenarioTags = ['mansion', 'hotel', 'office', 'boat', 'theater', 'museum']

        const suspectsPerTag = Math.ceil((count * 3) / scenarioTags.length)
        
        const allSuspects: Suspect[] = []
        const addedIds = new Set<string>()

        // Obtener sospechosos de cada tag de escenario
        for (const tag of scenarioTags) {
          try {
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
              console.warn('[suspects] random-mode tag query failed', {
                ...baseLog,
                tag,
                supabase: describePostgrestError(tagError),
              })
              continue
            }

            if (tagData && tagData.length > 0) {
              const uniqueSuspects = tagData.filter(s => !addedIds.has(s.id))
              uniqueSuspects.forEach(s => addedIds.add(s.id))
              allSuspects.push(...uniqueSuspects)
            }
          } catch (error) {
            console.warn('[suspects] random-mode tag exception', { ...baseLog, tag, error })
            continue
          }
        }

        let extraQuery = supabase
          .from('suspects')
          .select('*')
          .or('tags.cs.{random},tags.cs.{extra}')
          .limit(Math.max(suspectsPerTag * 2, count * 2))

        if (style) {
          extraQuery = extraQuery.eq('style', style)
        }

        const { data: extraData, error: extraError } = await extraQuery

        if (extraError) {
          console.warn('[suspects] random-mode extra/random query failed', {
            ...baseLog,
            supabase: describePostgrestError(extraError),
          })
        } else if (extraData && extraData.length > 0) {
          const uniqueExtras = extraData.filter(s => !addedIds.has(s.id))
          uniqueExtras.forEach(s => addedIds.add(s.id))
          allSuspects.push(...uniqueExtras)
        }

        const shuffled = allSuspects.sort(() => Math.random() - 0.5)
        result = shuffled.slice(0, count)
      }

    } catch (error) {
      console.error('[suspects] getSuspectsForScene failed', { ...baseLog, error })
      
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
      console.warn('[suspects] shortfall; filling from general pool', {
        ...baseLog,
        have: result.length,
        need: count,
      })
      
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

      const { data: fillData, error: fillError } = await fillQuery

      if (fillError) {
        console.error('[suspects] fill query failed', {
          ...baseLog,
          supabase: describePostgrestError(fillError),
        })
      } else if (fillData) {
        const shuffled = fillData.sort(() => Math.random() - 0.5)

        const uniqueFill = shuffled.filter(s => !addedIds.has(s.id))
        const needed = count - result.length
        const toAdd = uniqueFill.slice(0, needed)

        result.push(...toAdd)
      }
    }

    const uniqueResult = result.filter((suspect, index, self) =>
      index === self.findIndex(s => s.id === suspect.id)
    )

    if (uniqueResult.length < result.length) {
      console.warn('[suspects] deduplicated rows', {
        ...baseLog,
        before: result.length,
        after: uniqueResult.length,
      })
    }

    const extrasInResult = uniqueResult.filter(s => s.tags?.includes('extra')).length
    console.log('[suspects] ok', {
      ...baseLog,
      returned: uniqueResult.length,
      ids: uniqueResult.map(s => s.id),
      extras: extrasInResult,
    })

    return uniqueResult
  }

  /**
   * Obtiene sospechosos filtrando por género específico para cada posición
   */
  private static async getSuspectsByGenderPreferences(options: {
    count: number
    sceneTag: string | null
    style?: 'realistic' | 'pixel'
    preferredGenders: string[]
    logContext?: Record<string, unknown>
  }): Promise<Suspect[]> {
    const { count, sceneTag, style, preferredGenders, logContext } = options
    const baseLog = logContext ?? {}
    const result: Suspect[] = []
    const usedIds = new Set<string>()

    for (let i = 0; i < count && i < preferredGenders.length; i++) {
      const requiredGender = preferredGenders[i].toLowerCase()

      // Construir query base
      let query = supabase
        .from('suspects')
        .select('*')
        .eq('gender', requiredGender)
        .limit(20) // Obtener varios para poder elegir

      // Filtrar por escenario si hay uno
      if (sceneTag && sceneTag !== 'random') {
        query = query.contains('tags', [sceneTag])
      } else if (sceneTag === null) {
        // Modo aleatorio: buscar en todos los escenarios
        const scenarioTags = ['mansion', 'hotel', 'office', 'boat', 'theater', 'museum']
        query = query.or(scenarioTags.map(tag => `tags.cs.{${tag}}`).join(','))
      }

      // Filtrar por estilo si se especifica
      if (style) {
        query = query.eq('style', style)
      }

      const { data, error } = await query

      if (error) {
        console.error('[suspects] gender-slot query failed', {
          ...baseLog,
          sceneTag,
          position: i + 1,
          gender: requiredGender,
          supabase: describePostgrestError(error),
        })
        continue
      }

      // Filtrar los que ya usamos y mezclar
      const available = (data || [])
        .filter(s => !usedIds.has(s.id))
        .sort(() => Math.random() - 0.5)

      if (available.length === 0) {
        console.warn('[suspects] gender-slot empty; retrying without scene tag', {
          ...baseLog,
          position: i + 1,
          gender: requiredGender,
          sceneTag,
        })
        
        // Intentar sin filtro de escenario
        let fallbackQuery = supabase
          .from('suspects')
          .select('*')
          .eq('gender', requiredGender)
          .limit(20)

        if (style) {
          fallbackQuery = fallbackQuery.eq('style', style)
        }

        const { data: fallbackData, error: fallbackError } = await fallbackQuery

        if (fallbackError) {
          console.error('[suspects] gender fallback query failed', {
            ...baseLog,
            position: i + 1,
            gender: requiredGender,
            supabase: describePostgrestError(fallbackError),
          })
        } else if (fallbackData) {
          const fallbackAvailable = fallbackData
            .filter(s => !usedIds.has(s.id))
            .sort(() => Math.random() - 0.5)

          if (fallbackAvailable.length > 0) {
            const selected = fallbackAvailable[0]
            result.push(selected)
            usedIds.add(selected.id)
            continue
          }
        }

        console.error('[suspects] no suspects for gender slot', {
          ...baseLog,
          position: i + 1,
          gender: requiredGender,
        })
        // Si no hay del género requerido, no podemos continuar
        throw new Error(`No se encontraron suficientes sospechosos del género "${requiredGender}" para la posición ${i + 1}. Por favor, intenta con otro género o escenario.`)
      }

      const selected = available[0]
      result.push(selected)
      usedIds.add(selected.id)
    }

    if (result.length < count) {
      console.warn('[suspects] gender mode shortfall; topping up', {
        ...baseLog,
        have: result.length,
        need: count,
      })
      
      let extraQuery = supabase
        .from('suspects')
        .select('*')
        .limit((count - result.length) * 3)

      if (sceneTag && sceneTag !== 'random') {
        extraQuery = extraQuery.contains('tags', [sceneTag])
      }

      if (style) {
        extraQuery = extraQuery.eq('style', style)
      }

      const { data: extraData, error: extraError } = await extraQuery

      if (extraError) {
        console.error('[suspects] gender top-up query failed', {
          ...baseLog,
          supabase: describePostgrestError(extraError),
        })
      } else if (extraData) {
        const extraAvailable = extraData
          .filter(s => !usedIds.has(s.id))
          .sort(() => Math.random() - 0.5)
          .slice(0, count - result.length)

        result.push(...extraAvailable)
        extraAvailable.forEach(s => usedIds.add(s.id))
      }
    }

    const genderMismatches = result.filter(
      (s, idx) =>
        preferredGenders[idx] &&
        s.gender?.toLowerCase() !== preferredGenders[idx].toLowerCase()
    ).length

    console.log('[suspects] ok (gender-filtered)', {
      ...baseLog,
      returned: result.length,
      ids: result.map(s => s.id),
      genderMismatches,
    })

    return result
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

