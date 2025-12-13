import { Router, Request, Response } from 'express'
import { SuspectService } from '../services/suspect-service.js'
import { WeaponService } from '../services/weapon-service.js'
import OpenAI from 'openai'

// Lazy initialization - solo crea el cliente cuando se necesite
let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (openaiClient) {
    return openaiClient
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not defined')
  }

  openaiClient = new OpenAI({
    apiKey: apiKey,
  })
  
  return openaiClient
}

export const generateInitialCaseRouter = Router()

export interface InitialCaseGenerationRequest {
  caseType: string
  suspects: number
  clues: number
  scenario: string
  difficulty: string
  style?: 'realistic' | 'pixel'
  language?: string
  playerNames?: string[]
  playerGenders?: string[]
}

export interface InitialCaseResponse {
  caseTitle: string
  caseDescription: string
  victim: {
    name: string
    age: number
    role: string
    description: string
    causeOfDeath?: string
    timeOfDeath?: string
    timeOfDiscovery?: string
    discoveredBy?: string
    location?: string
    bodyPosition?: string
    visibleInjuries?: string
    objectsAtScene?: string
    signsOfStruggle?: string
  }
  suspects: Array<{
    id: string
    name: string
    age: number
    role: string
    description: string
    motive: string
    alibi: string
    timeGap?: string
    suspicious: boolean
    photo: string
    traits: string[]
    lastSeen: string
    gender?: string
  }>
  weapon?: {
    id: string
    name: string
    description: string
    location: string
    photo: string
    importance: 'high'
  }
  // Información oculta del caso (no se envía al cliente en producción)
  hiddenContext: {
    guiltyId: string // ID del culpable
    guiltyReason: string // Razón detallada de por qué es culpable
    keyClues: string[] // Pistas clave que apuntan al culpable
    guiltyTraits: string[] // Traits del culpable que conectan con el crimen
  }
  supabaseSuspects?: any[]
  config: {
    caseType: string
    totalClues: number
    scenario: string
    difficulty: string
  }
}

generateInitialCaseRouter.post('/', async (req: Request, res: Response) => {
  try {
    console.log('API Route: generate-initial-case called')
    
    const body: InitialCaseGenerationRequest = req.body
    console.log('Request body:', body)
    
    // Validate required fields
    if (!body.caseType || !body.suspects || !body.clues || !body.scenario || !body.difficulty) {
      return res.status(400).json(
        { error: 'Missing required fields' }
      )
    }

    const { language = 'es', playerNames: rawPlayerNames = [], playerGenders: rawPlayerGenders = [] } = body

    // Normalizar playerNames: puede venir como array de strings o array de objetos { name, gender }
    const playerNames: string[] = rawPlayerNames.map((item: any) => {
      if (typeof item === 'string') {
        return item
      } else if (item && typeof item === 'object' && item.name) {
        return item.name
      }
      return String(item || '')
    })

    // Normalizar playerGenders: puede venir como array de strings o extraerse de los objetos
    const playerGenders: string[] = rawPlayerGenders.length > 0 
      ? rawPlayerGenders.map((item: any) => typeof item === 'string' ? item : String(item || ''))
      : rawPlayerNames.map((item: any) => {
          if (item && typeof item === 'object' && item.gender) {
            return item.gender
          }
          return ''
        }).filter(g => g)


    // Obtener sospechosos reales desde Supabase
    console.log(`🔍 Fetching ${body.suspects} suspects from Supabase...`)
    console.log(`👥 Player genders provided: ${playerGenders.join(', ')}`)
    const selectedSuspects = await SuspectService.getSuspectsForScene({
      count: body.suspects,
      scene: body.scenario,
      style: body.style,
      preferredGenders: playerGenders.length > 0 ? playerGenders : undefined,
    })
    
    console.log(`✅ Found ${selectedSuspects.length} suspects from Supabase`)

    // Seleccionar arma para casos de asesinato
    let selectedWeapon = null
    if (body.caseType === 'asesinato') {
      console.log(`🔫 Selecting murder weapon...`)
      selectedWeapon = await WeaponService.selectWeapon({
        scene: body.scenario,
        style: body.style,
        preferSpecific: true
      })
      console.log(`✅ Selected weapon: ${selectedWeapon?.name?.es}`)
    }

    // Generar número aleatorio para forzar variación en el culpable
    const randomGuiltyIndex = Math.floor(Math.random() * body.suspects) + 1
    console.log(`🎲 Random guilty suggestion: suspect-${randomGuiltyIndex}`)

    // Crear prompt para OpenAI
    const prompt = createInitialCasePrompt(body, selectedSuspects, selectedWeapon, language, randomGuiltyIndex, playerNames, playerGenders)

    console.log('🤖 Calling OpenAI for initial case generation...')
    
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Crea casos de misterio. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. El culpable es FIJO (suspect-X indicado). NO cambies el culpable. Genera traits que apunten sutilmente al culpable. Todos parecen culpables, pero las pistas apuntan al verdadero. Responde SOLO JSON válido.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 3000,
      response_format: { type: "json_object" },
    })

    const response = completion.choices[0]?.message?.content
    if (!response) {
      throw new Error('No response from OpenAI')
    }

    console.log('✅ OpenAI response received')

    // Parsear respuesta (ya viene como JSON válido con response_format)
    let parsedCase: InitialCaseResponse
    try {
      parsedCase = JSON.parse(response)
    } catch (parseError) {
      // Fallback: limpiar si viene con markdown
      const cleanedResponse = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim()
      parsedCase = JSON.parse(cleanedResponse)
    }
    
    // PRIMERO: Si hay nombres proporcionados, sobrescribirlos ANTES de hacer el matching
    if (parsedCase.suspects && playerNames && playerNames.length > 0) {
      console.log('🔧 Applying provided player names to suspects...')
      parsedCase.suspects = parsedCase.suspects.map((suspect: any, index: number) => {
        // Asegurar que name sea un string válido
        let name: string = suspect.name
        if (typeof name === 'object' && name !== null) {
          name = (name as any).toString() || String(name)
          console.warn(`⚠️ Suspect ${index + 1} name was an object, converted to: "${name}"`)
        } else if (typeof name !== 'string') {
          name = String(name || '')
        }
        
        // Si hay un nombre proporcionado para este índice, usarlo
        if (playerNames[index]) {
          name = playerNames[index]
          console.log(`✅ Applied provided name for suspect-${index + 1}: "${name}"`)
        }
        
        return { ...suspect, name: name }
      })
    }

    // Asignar URLs reales de Supabase a los sospechosos
    if (parsedCase.suspects && selectedSuspects) {
      console.log('🔧 Matching suspects to Supabase photos...')
      
      const remaining = [...selectedSuspects]
      const usedIds = new Set<string>()

      function scoreMatch(gen: any, orig: any): number {
        let score = 0
        const genRole = (gen.role || '').toString().toLowerCase().trim()
        const origOccEs = (orig.occupation?.es || orig.occupation || '').toString().toLowerCase().trim()
        const origOccEn = (orig.occupation?.en || '').toString().toLowerCase().trim()
        
        if (genRole && (genRole === origOccEs || genRole === origOccEn)) score += 5
        else if (genRole && (origOccEs.includes(genRole) || genRole.includes(origOccEs))) score += 3

        if (gen.gender && orig.gender && gen.gender === orig.gender) score += 2

        if (typeof gen.age === 'number' && typeof orig.approx_age === 'number') {
          const diff = Math.abs(gen.age - orig.approx_age)
          if (diff <= 1) score += 2
          else if (diff <= 3) score += 1
        }

        return score
      }

      parsedCase.suspects = parsedCase.suspects.map((gen) => {
        // Asegurar que name sea un string (ya lo aplicamos antes, pero por si acaso)
        let name: string = gen.name
        if (typeof name === 'object' && name !== null) {
          name = (name as any).toString() || String(name)
        } else if (typeof name !== 'string') {
          name = String(name || '')
        }
        
        let best = null as any
        let bestScore = -1
        
        remaining.forEach((orig) => {
          if (usedIds.has(orig.id)) return
          const s = scoreMatch(gen, orig)
          if (s > bestScore) {
            best = orig
            bestScore = s
          }
        })

        if (!best) {
          best = remaining.find((o) => !usedIds.has(o.id))
        }

        if (best?.id) usedIds.add(best.id)

        const updatedSuspect = { 
          ...gen, 
          name: name, // Asegurar que name sea siempre un string
          photo: best?.image_url || gen.photo 
        }

        if (best?.image_url) {
          console.log(`✅ Matched "${name}" → ${best.occupation?.es}`)
        }
        
        return updatedSuspect
      })
    } else if (parsedCase.suspects) {
      // Aunque no haya selectedSuspects, asegurar que los nombres sean strings
      parsedCase.suspects = parsedCase.suspects.map((gen: any, index: number) => {
        let name: string = gen.name
        if (typeof name === 'object' && name !== null) {
          name = (name as any).toString() || String(name)
          console.warn(`⚠️ Suspect ${index + 1} name was an object, converted to: "${name}"`)
        } else if (typeof name !== 'string') {
          name = String(name || '')
        }
        
        // Si hay nombres proporcionados por el usuario, usar esos
        if (playerNames && playerNames.length > index && playerNames[index]) {
          name = playerNames[index]
          console.log(`✅ Applied provided name for suspect-${index + 1}: "${name}"`)
        }
        
        return { ...gen, name: name }
      })
    }

    // Preservar URL del arma
    if (selectedWeapon && parsedCase.weapon) {
      console.log(`✅ Assigning weapon photo: ${selectedWeapon.image_url}`)
      parsedCase.weapon.photo = selectedWeapon.image_url
    }

    // Agregar información de configuración
    parsedCase.config = {
      caseType: body.caseType,
      totalClues: body.clues,
      scenario: body.scenario,
      difficulty: body.difficulty,
    }

    // NO incluir supabaseSuspects en la respuesta (optimización de tamaño)
    // parsedCase.supabaseSuspects = selectedSuspects

    console.log('✅ Initial case generated successfully')
    console.log(`   Guilty: ${parsedCase.hiddenContext.guiltyId}`)
    console.log(`   Suspects: ${parsedCase.suspects.length}`)

    // NO generamos la ronda 1 aquí - se generará mientras el usuario lee el intro
    
    return res.json(parsedCase)
    
  } catch (error) {
    console.error('Error in generate-initial-case API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return res.status(500).json(
      { 
        error: 'Failed to generate initial case',
        details: errorMessage,
      }
    )
  }
})

function createInitialCasePrompt(
  request: InitialCaseGenerationRequest,
  selectedSuspects: any[],
  selectedWeapon: any,
  language: string,
  randomGuiltyIndex: number,
  playerNames: string[],
  playerGenders: string[]
): string {
  const { caseType, suspects, clues, scenario, difficulty } = request

  const suspectsInfo = selectedSuspects.map(s => `
- Género: ${s.gender}
- Edad aproximada: ${s.approx_age}
- Ocupación: ${language === 'es' ? s.occupation?.es : s.occupation?.en || s.occupation}
- Tags: ${s.tags?.join(', ') || 'sin tags'}
- URL de imagen: ${s.image_url}
`).join('\n')

  const weaponInfo = selectedWeapon ? `
**ARMA HOMICIDA:**
- Nombre: ${language === 'es' ? selectedWeapon.name.es : selectedWeapon.name.en}
- Tags: ${selectedWeapon.tags?.join(', ') || 'sin tags'}
- URL de imagen: ${selectedWeapon.image_url}
` : ''

  const namesInfo = playerNames.length > 0 
    ? `\n**NOMBRES DE JUGADORES PROPORCIONADOS:**\n${playerNames.map((name, i) => {
        const gender = playerGenders[i] || 'unknown'
        return `- Suspect ${i + 1}: ${name} (${gender === 'male' ? 'hombre' : gender === 'female' ? 'mujer' : 'desconocido'})`
      }).join('\n')}\n\nUsa estos nombres EXACTOS para los sospechosos en el orden proporcionado. Si hay más sospechosos que nombres, genera nombres apropiados para los restantes basándote en el género y ocupación de cada uno.`
    : '\n**NOMBRES:** Genera nombres apropiados para todos los sospechosos basándote en el género y ocupación de cada uno.\n'
  
  const gendersInfo = playerGenders.length > 0
    ? `\n**GÉNEROS DE JUGADORES PROPORCIONADOS:**\n${playerGenders.map((gender, i) => `- Suspect ${i + 1}: ${gender}`).join('\n')}\n\nUsa estos géneros EXACTOS para los sospechosos en el orden proporcionado. Si hay más sospechosos que géneros, asigna géneros apropiados basándote en la ocupación y otros factores.\n`
    : '\n**GÉNEROS:** Asigna géneros apropiados a todos los sospechosos basándote en la ocupación y otros factores.\n'

  return `
Genera la introducción de un caso de misterio con la siguiente configuración:

**CONFIGURACIÓN:**
- Tipo de caso: ${caseType}
- Número de sospechosos: ${suspects}
- Número total de pistas (se generarán dinámicamente): ${clues}
- Escenario: ${scenario}
- Dificultad: ${difficulty}

**SOSPECHOSOS DE SUPABASE:**
${suspectsInfo}
${namesInfo}
${gendersInfo}

**REGLAS PARA SOSPECHOSOS:**
1. Usa EXACTAMENTE los géneros, edades y ocupaciones proporcionados
2. ${playerNames.length > 0 ? 'Usa los nombres proporcionados cuando estén disponibles, genera nombres apropiados para los restantes' : 'Genera nombres que coincidan con el género'}
3. Usa EXACTAMENTE las URLs de imagen proporcionadas como campo "photo"
4. Agrega descripción de personalidad, motivo para el crimen, coartada con huecos
5. **IMPORTANTE:** Todos deben tener "suspicious": true
6. **CRÍTICO - MOTIVOS:**
   - ⚠️ **LONGITUD EQUILIBRADA:** Todos los motivos deben tener aproximadamente la MISMA LONGITUD (mismo número de palabras/oraciones). NO hagas el motivo del culpable más largo que los demás.
   - El sospechoso suspect-${randomGuiltyIndex} (el culpable) DEBE tener el motivo MÁS FUERTE en términos de CONTENIDO/CONVICCIÓN, no de longitud.
   - Los demás deben tener motivos fuertes pero MENOS CONVINCENTES que el del culpable (misma longitud, menos fuerza en el contenido).
   - El motivo del culpable debe ser tan convincente (por su contenido) que, incluso si hay pistas que sugieren otra cosa (como que es alguien del personal), el motivo debe ser lo suficientemente fuerte para que el jugador pueda descartar esas pistas como menos relevantes.
   - Ejemplo: Si los demás motivos son 1-2 oraciones, el del culpable también debe ser 1-2 oraciones, pero más convincente.

${weaponInfo}

**VÍCTIMA - DETALLES COMPLETOS OBLIGATORIOS:**
Crea una víctima con TODOS estos campos (NO OMITIR NINGUNO):
- Nombre, edad, rol/profesión
- Descripción BREVE de su personalidad (1-2 oraciones máximo)
${caseType === 'asesinato' ? `- **causeOfDeath**: Causa de muerte específica y detallada (relacionada con el arma: ${language === 'es' ? selectedWeapon?.name.es : selectedWeapon?.name.en || 'arma genérica'})` : ''}
- **timeOfDeath**: Hora de muerte estimada (ej: "Entre las 9:45pm y 10:15pm según la temperatura corporal")
- **discoveredBy**: Quién encontró el cuerpo CON LA HORA (ej: "[Nombre del sospechoso que descubrió el cuerpo], [rol/profesión] a las [hora]" o "[rol/profesión] [nombre del sospechoso que descubrió el cuerpo] a las [hora]", esto puede variar, cualquier persona pudo haber encontrado a la victima, esto es solo un ejemplo, sea el culpable o cualquier otro sospechoso")
- **location**: Ubicación exacta y detallada (ej: "En su oficina privada del segundo piso, tirado junto al escritorio")
- **bodyPosition**: Descripción detallada de la posición del cuerpo (ej: "Boca arriba, brazos extendidos, señales de lucha")
- **visibleInjuries**: Heridas visibles específicas (ej: "Tres heridas de arma blanca en el pecho, sangre seca alrededor")
- **objectsAtScene**: Objetos específicos encontrados en la escena (ej: "Un cuchillo ensangrentado a 2 metros, copa volcada, documentos esparcidos")
- **signsOfStruggle**: Señales de lucha detalladas (ej: "Silla volcada, lámpara rota, papeles desordenados")

**CRÍTICO - VÍCTIMA:**
- TODOS los campos deben estar completos
- NO dejar campos vacíos o con "N/A"
- Cada detalle debe ser específico y coherente con el culpable

${caseType === 'asesinato' && selectedWeapon ? `
**ARMA (SOLO PARA ASESINATO):**
Incluye el arma con:
- Nombre: "${language === 'es' ? selectedWeapon.name.es : selectedWeapon.name.en}"
- Descripción detallada del arma
- Ubicación donde se encontró
- Importancia: "high"
- Photo: "${selectedWeapon.image_url}"
` : ''}

**CULPABLE FIJO - OBLIGATORIO:**
🎲 **EL CULPABLE DEBE SER: suspect-${randomGuiltyIndex}**

⚠️ **ESTO NO ES UNA SUGERENCIA - ES OBLIGATORIO:**
- El culpable para este caso ES: suspect-${randomGuiltyIndex}
- NO elijas otro sospechoso diferente
- NO cambies el culpable basándose en las decisiones del jugador
- El culpable queda FIJO desde esta primera generación
- NO sigas patrones (siempre suspect-1, siempre el último, etc.)

**REGLAS SOBRE EL CULPABLE (suspect-${randomGuiltyIndex}):**
- ⚠️ **CRÍTICO: Debe tener el MOTIVO MÁS FUERTE de TODOS los sospechosos**
- ⚠️ **IMPORTANTE: El motivo debe tener LONGITUD SIMILAR a los demás (NO más largo)**
- El motivo del culpable debe ser más poderoso en CONTENIDO/CONVICCIÓN, no en longitud
- Debe tener conexión lógica y profunda con la víctima
- El motivo debe ser tan fuerte que, incluso si hay pistas que sugieren otra cosa (como que es alguien del personal), el motivo del culpable debe ser lo suficientemente convincente para que el jugador pueda descartar esas pistas como falsas o menos relevantes
- Debe tener acceso al arma o escena del crimen
- Sus traits deben conectar sutilmente con el método del crimen
- Las pistas que apunten a él deben ser SUTILES pero DESCUBRIBLES
- El motivo debe incluir elementos personales, profesionales o emocionales que lo hagan el más convincente, pero expresados de forma concisa (igual longitud que los demás)

**REGLAS SOBRE LOS OTROS SOSPECHOSOS:**
- TODOS los demás sospechosos deben TAMBIÉN parecer culpables
- Dales motivos creíbles y fuertes, con LONGITUD SIMILAR al del culpable
- ⚠️ **CRÍTICO: Todos los motivos deben tener aproximadamente la misma longitud (mismo número de palabras/oraciones)**
- El motivo del culpable debe ser más convincente por su CONTENIDO, no por ser más largo
- Dales coartadas con huecos sospechosos
- Haz que sus traits también conecten con el crimen
- La diferencia está en las PISTAS SUTILES que solo apuntan al culpable real (suspect-${randomGuiltyIndex}) Y EN EL MOTIVO MÁS FUERTE (por contenido, no por longitud)
- El jugador debe poder DEDUCIR quién es el culpable conectando todas las pistas Y comparando la fuerza de los motivos (no la longitud)

**CONTEXTO OCULTO (hiddenContext):**
En el objeto "hiddenContext" incluye:
- "guiltyId": ID del sospechoso culpable (usa el mismo ID que en el array de suspects)
- "guiltyReason": Razón detallada de por qué es culpable (2-3 oraciones)
- "keyClues": Array de 3-5 pistas clave que apuntan al culpable
- "guiltyTraits": Array de traits del culpable que conectan con el crimen

**FORMATO JSON ESPERADO:**
{
  "caseTitle": "Título del caso",
  "caseDescription": "Descripción breve",
  "victim": {
    "name": "Nombre",
    "age": 45,
    "role": "Profesión",
    "description": "Descripción breve de personalidad (1-2 oraciones)",
    "causeOfDeath": "Causa específica",
    "timeOfDeath": "Entre 9:45pm y 10:15pm",
    "discoveredBy": "Sofía, la sumeller a las 11:00pm",
    "location": "Ubicación exacta",
    "bodyPosition": "Descripción de la posición",
    "visibleInjuries": "Heridas visibles",
    "objectsAtScene": "Objetos encontrados",
    "signsOfStruggle": "Señales de lucha"
  },
  "suspects": [
    {
      "id": "suspect-1",
      "name": "${playerNames[0] || 'Nombre generado apropiado'}",
      "age": 35,
      "role": "Ocupación exacta de Supabase",
      "description": "Descripción de personalidad",
      "motive": "Motivo para el crimen",
      "alibi": "Coartada con posibles huecos",
      "timeGap": "Hueco en la coartada",
      "suspicious": true,
      "photo": "URL de Supabase",
      "traits": ["trait1", "trait2", "trait3"],
      "lastSeen": "Última vez visto",
      "gender": "${playerGenders[0] || 'male/female'}"
    }${playerNames[1] ? `,
    {
      "id": "suspect-2",
      "name": "${playerNames[1]}",
      "gender": "${playerGenders[1] || 'male/female'}"
    }` : ''}${playerNames[2] ? `,
    {
      "id": "suspect-3",
      "name": "${playerNames[2]}",
      "gender": "${playerGenders[2] || 'male/female'}"
    }` : ''}${playerNames[3] ? `,
    {
      "id": "suspect-4",
      "name": "${playerNames[3]}",
      "gender": "${playerGenders[3] || 'male/female'}"
    }` : ''}
  ],
  ${caseType === 'asesinato' ? `"weapon": {
    "id": "weapon-1",
    "name": "${language === 'es' ? selectedWeapon?.name.es : selectedWeapon?.name.en || 'arma'}",
    "description": "Descripción detallada",
    "location": "Donde se encontró",
    "photo": "${selectedWeapon?.image_url || ''}",
    "importance": "high"
  },` : ''}
  "hiddenContext": {
    "guiltyId": "suspect-${randomGuiltyIndex}",
    "guiltyReason": "Razón detallada de por qué suspect-${randomGuiltyIndex} es el culpable (2-3 oraciones)",
    "keyClues": ["pista1 que conecta con suspect-${randomGuiltyIndex}", "pista2 que conecta con suspect-${randomGuiltyIndex}", "pista3 sutil"],
    "guiltyTraits": ["trait que conecta con el crimen", "trait que da una pista sutil"]
  }
}

**CRÍTICO - LEER ATENTAMENTE:**
- ⚠️ **EL CULPABLE OBLIGATORIAMENTE ES: suspect-${randomGuiltyIndex}**
- ⚠️ **NO cambies este ID bajo ninguna circunstancia**
${playerNames.length > 0 ? `- 🚨 **NOMBRES OBLIGATORIOS - DEBES USAR EXACTAMENTE ESTOS NOMBRES:**
  ${playerNames.map((name, i) => `  - suspect-${i + 1} → "${name}"`).join('\n  ')}
  - NO inventes nombres diferentes. NO uses variaciones. NO cambies estos nombres bajo ninguna circunstancia.
  - Si hay más sospechosos que nombres, genera nombres apropiados SOLO para los sospechosos sin nombre asignado.
  - Usa estos nombres EXACTOS en el orden proporcionado.` : ''}
${playerGenders.length > 0 ? `- 🚨 **GÉNEROS OBLIGATORIOS - DEBES USAR EXACTAMENTE ESTOS GÉNEROS:**
  ${playerGenders.map((gender, i) => `  - suspect-${i + 1} → "${gender}"`).join('\n  ')}
  - NO cambies estos géneros bajo ninguna circunstancia.
  - Si hay más sospechosos que géneros, asigna géneros apropiados SOLO para los sospechosos sin género asignado.` : ''}
- El culpable (suspect-${randomGuiltyIndex}) queda FIJO desde ahora y NO cambiará durante el juego
- TODOS los sospechosos deben parecer culpables con motivos fuertes
- Las pistas sutiles que solo apuntan a suspect-${randomGuiltyIndex} son las que revelarán al culpable
- El jugador debe conectar las pistas para deducir que es suspect-${randomGuiltyIndex}
- El JSON debe ser válido, sin errores
- Todos los strings en una sola línea
- **RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`
}
