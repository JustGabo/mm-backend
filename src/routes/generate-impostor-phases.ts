import { Request, Response } from 'express'
import { SuspectService } from '../services/suspect-service.js'
import { WeaponService } from '../services/weapon-service.js'
import { getRoomPlayers, Player, Suspect } from '../services/supabase.js'
import OpenAI from 'openai'
import {
  ImpostorPhasesGenerationRequest,
  ImpostorPhasesResponse,
} from '../types/multiplayer.js'

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

export async function generateImpostorPhases(req: Request, res: Response) {
  try {
    console.log('API Route: generate-impostor-phases called')
    
    const body: ImpostorPhasesGenerationRequest = req.body
    console.log('Request body:', body)
    
    // Validate required fields
    if (!body.roomId || !body.caseType || !body.suspects || !body.clues || !body.scenario || !body.difficulty) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const { language = 'es' } = body

    // Obtener jugadores de la sala desde Supabase
    console.log(`🔍 Fetching players from room ${body.roomId}...`)
    const playersResult = await getRoomPlayers(body.roomId)
    
    if (!playersResult.success || !playersResult.players || playersResult.players.length === 0) {
      return res.status(400).json({ error: 'No players found in room or error fetching players' })
    }

    const roomPlayers = playersResult.players
    console.log(`✅ Found ${roomPlayers.length} players in room`)

    // Extraer nombres y géneros de los jugadores
    const playerNames = roomPlayers.map((p: Player) => p.name || `Jugador ${p.id.slice(0, 8)}`)
    const playerGenders = roomPlayers.map((p: Player) => p.gender || 'unknown')
    const playerIds = roomPlayers.map((p: Player) => p.id)

    // Obtener sospechosos reales desde Supabase
    console.log(`🔍 Fetching ${body.suspects} suspects from Supabase...`)
    
    const preferredGenders = playerGenders.filter((g: string) => g !== 'unknown')
    
    const selectedSuspects = await SuspectService.getSuspectsForScene({
      count: body.suspects,
      scene: body.scenario,
      style: body.style,
      preferredGenders: preferredGenders.length > 0 ? preferredGenders : undefined,
    })
    
    if (!selectedSuspects || selectedSuspects.length === 0) {
      return res.status(500).json({ error: 'No suspects available in database' })
    }
    
    console.log(`✅ Found ${selectedSuspects.length} suspects from Supabase`)

    // Seleccionar arma (solo para asesinato)
    let selectedWeapon = null
    if (body.caseType === 'asesinato') {
      console.log(`🔫 Selecting murder weapon...`)
      selectedWeapon = await WeaponService.selectWeapon({
        scene: body.scenario,
        style: body.style,
        preferSpecific: true
      })
      const weaponName = language === 'es' ? selectedWeapon?.name?.es : selectedWeapon?.name?.en
      console.log(`✅ Selected weapon: ${weaponName}`)
    }

    // Seleccionar asesino aleatorio
    const randomKillerIndex = Math.floor(Math.random() * body.suspects)
    const killerPlayerId = playerIds[randomKillerIndex]

    // Seleccionar quién descubrió el cuerpo (no puede ser el asesino)
    let discoveredByPlayerIndex = randomKillerIndex
    while (discoveredByPlayerIndex === randomKillerIndex) {
      discoveredByPlayerIndex = Math.floor(Math.random() * body.suspects)
    }

    console.log(`🎲 Killer selected: Player ${randomKillerIndex + 1} (${killerPlayerId})`)
    console.log(`🔍 Body discovered by: Player ${discoveredByPlayerIndex + 1}`)

    // Crear prompt para generar el caso con fases
    const prompt = createImpostorPhasesPrompt(
      body,
      selectedSuspects,
      selectedWeapon,
      language,
      randomKillerIndex,
      playerNames,
      playerGenders,
      playerIds,
      discoveredByPlayerIndex
    )

    console.log('📝 Generating case with phases...')
    
    // System message con soporte de idioma
    const systemMessage = language === 'en' 
      ? 'You are an expert in creating interactive mystery cases for multiplayer games. Language: ENGLISH. You generate detailed and structured information by phases for each player.'
      : 'Eres un experto en crear casos de misterio interactivos para juegos multijugador. Idioma: ESPAÑOL. Generas información detallada y estructurada por fases para cada jugador.'
    
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemMessage
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.9,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    })

    const responseText = completion.choices[0]?.message?.content
    if (!responseText) {
      throw new Error('No response from OpenAI')
    }

    console.log('📦 Parsing response...')
    let parsedCase: ImpostorPhasesResponse
    
    try {
      const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsedCase = JSON.parse(cleanedResponse)
    } catch (parseError) {
      console.error('❌ Error parsing JSON:', parseError)
      console.error('Response text:', responseText)
      throw new Error('Failed to parse AI response as JSON')
    }

    // Validar estructura básica
    if (!parsedCase.players || !Array.isArray(parsedCase.players)) {
      throw new Error('Invalid response structure: missing players array')
    }

    // Asignar playerIds a cada jugador generado
    const nameToIdMap = new Map<string, string>()
    roomPlayers.forEach((p: Player, idx: number) => {
      const name = p.name || `Jugador ${p.id.slice(0, 8)}`
      nameToIdMap.set(name.toLowerCase().trim(), playerIds[idx])
    })

    parsedCase.players = parsedCase.players.map((player, index) => {
      const generatedName = player.phase1?.name?.toLowerCase().trim() || ''
      const matchedId = nameToIdMap.get(generatedName)
      
      if (matchedId) {
        console.log(`✅ Matched player "${player.phase1?.name}" → ${matchedId}`)
        return {
          ...player,
          playerId: matchedId
        }
      } else {
        const fallbackId = playerIds[index] || `player-${index}`
        console.warn(`⚠️ Could not match player "${player.phase1?.name}" by name, using index ${index} → ${fallbackId}`)
        return {
          ...player,
          playerId: fallbackId
        }
      }
    })

    // Asignar fotos de sospechosos reales
    if (selectedSuspects.length > 0) {
      const usedIds = new Set<string>()
      
      const scoreMatch = (gen: any, orig: any) => {
        let score = 0
        const genRole = gen.phase1?.occupation?.toLowerCase() || ''
        const origRole = language === 'es' 
          ? (orig.occupation?.es || '').toLowerCase()
          : (orig.occupation?.en || '').toLowerCase()
        if (genRole.includes(origRole) || origRole.includes(genRole)) score += 10
        if (gen.phase1?.gender === orig.gender) score += 5
        return score
      }

      parsedCase.players = parsedCase.players.map((gen) => {
        let best = null as Suspect | null
        let bestScore = -1
        const remaining = selectedSuspects.filter((s: Suspect) => !usedIds.has(s.id))
        
        remaining.forEach((orig: Suspect) => {
          if (usedIds.has(orig.id)) return
          const s = scoreMatch(gen, orig)
          if (s > bestScore) {
            best = orig
            bestScore = s
          }
        })

        if (!best) {
          best = remaining.find((o: Suspect) => !usedIds.has(o.id)) || null
        }

        if (best?.id) usedIds.add(best.id)

        if (best?.image_url) {
          const occupationName = language === 'es' ? best.occupation?.es : best.occupation?.en
          console.log(`✅ Matched "${gen.phase1?.name}" → ${occupationName}`)
          return { ...gen, photo: best.image_url }
        }
        return { ...gen, photo: undefined }
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

    // Actualizar killerId con el playerId real
    parsedCase.hiddenContext.killerId = killerPlayerId

    console.log('✅ Impostor phases generated successfully')
    console.log(`   Killer: ${killerPlayerId}`)
    console.log(`   Players: ${parsedCase.players.length}`)

    return res.json(parsedCase)
    
  } catch (error) {
    console.error('Error in generate-impostor-phases API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return res.status(500).json({ 
      error: 'Failed to generate impostor phases',
      details: errorMessage,
    })
  }
}

// Esta función es muy larga, así que cópiala completa desde app/api/generate-impostor-phases/route.ts
// (líneas 338-574)
function createImpostorPhasesPrompt(
  request: ImpostorPhasesGenerationRequest,
  selectedSuspects: any[],
  selectedWeapon: any,
  language: string,
  randomKillerIndex: number,
  playerNames: string[],
  playerGenders: string[],
  playerIds: string[],
  discoveredByPlayerIndex: number
): string {
  // ... COPIAR TODO EL CONTENIDO DE LA FUNCIÓN DESDE app/api/generate-impostor-phases/route.ts ...
  // (Es la misma función, solo cambia el contexto de Next.js a Express)
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
        return `- Player ${i + 1} (ID: ${playerIds[i]}): ${name} (${gender === 'male' ? 'hombre' : gender === 'female' ? 'mujer' : 'desconocido'})`
      }).join('\n')}\n\nUsa estos nombres EXACTOS para los jugadores en el orden proporcionado.`
    : '\n**NOMBRES:** Genera nombres apropiados para todos los jugadores basándote en el género y ocupación de cada uno.\n'
  
  const gendersInfo = playerGenders.length > 0
    ? `\n**GÉNEROS DE JUGADORES:**\n${playerGenders.map((gender, i) => {
        return `- Player ${i + 1}: ${gender === 'male' ? 'hombre' : gender === 'female' ? 'mujer' : 'desconocido'}`
      }).join('\n')}\n\nUsa estos géneros para los jugadores en el orden proporcionado.\n`
    : ''

  const caseTypeText = caseType === 'asesinato' 
    ? 'asesinato' 
    : caseType === 'secuestro' 
    ? 'secuestro' 
    : 'robo'

  const difficultyText = difficulty === 'easy' 
    ? 'FÁCIL' 
    : difficulty === 'normal' 
    ? 'NORMAL' 
    : 'DIFÍCIL'

  return `Eres un experto en crear casos de misterio interactivos para juegos multijugador estilo "Among Us" pero narrativo.

**CONTEXTO:**
Estás creando un caso de ${caseTypeText} para ${suspects} jugadores en un escenario de ${scenario}.
Dificultad: ${difficultyText}
${namesInfo}
${gendersInfo}

**SOSPECHOSOS DISPONIBLES:**
${suspectsInfo}
${weaponInfo}

**IMPORTANTE:**
- El jugador en la posición ${randomKillerIndex + 1} (${playerNames[randomKillerIndex]}) es el ASESINO/CULPABLE
- El jugador en la posición ${discoveredByPlayerIndex + 1} (${playerNames[discoveredByPlayerIndex]}) descubrió el cuerpo (NO puede ser el asesino)
- Cada jugador debe tener información diferente y única por fases
- El asesino también recibe información (para poder mentir mejor)

**ESTRUCTURA DE FASES:**

**FASE 1 - INFORMACIÓN PRIVADA (ANTES DEL CRIMEN):**
Cada jugador ve:
- Su nombre
- Su ocupación/rol (chef, empresario, etc.)
- Relación con la víctima (amigo, colega, familiar, etc.)
- Descripción breve del personaje
- NO se revela si es inocente o asesino aún
- NO se menciona motivo de sospecha (aún no hay crimen)

**FASE 2 - CONTEXTO PREVIO AL CRIMEN:**
Cada jugador recibe 2-3 observaciones ambientales:
- Ejemplos: "Viste a [nombre] discutiendo con la víctima", "Notaste que [nombre] estaba apresurado", "Escuchaste una conversación entre [nombre1] y [nombre2] lo que te quieras inventar que pueda dar mas juego en las investigaciones y hacer sospechosos a varios"
- **🚨 CRÍTICO - NO AUTO-MENCIONARSE:** NUNCA hagas que un jugador se mencione a sí mismo. Si el jugador es "Lola", NO puede decir "Vi a Lola" o "Noté que Lola estaba...". Solo puede mencionar a OTROS jugadores que NO sean él/ella mismo.
- **CRÍTICO - CONSISTENCIA EN NOMBRES:** SIEMPRE usa el NOMBRE del personaje, NUNCA mezcles nombres con ocupaciones. Si mencionas a un personaje por su nombre (ej: "Papito"), NO lo vuelvas a mencionar por su ocupación (ej: "el chef") en la misma observación o en otras observaciones del mismo jugador. Usa SIEMPRE el mismo nombre para el mismo personaje.
- El asesino también recibe información (para mentir mejor)
- Estas observaciones deben sembrar sospecha sin acusar aún

**FASE 3 - LÍNEA TEMPORAL DEL EVENTO:**
Cada jugador ve una timeline completa con 3-4 momentos clave:
- Para cada momento: "A las [hora] estabas en [lugar] haciendo [acción] (puede repetirse la accion si es que paso mucho tiempo en un lugar haciendo determinada accion)"
- Observaciones: "Viste a [nombre] en [lugar]" o lo que quieras inventar que quede mejor, tienes libertad creativa
- **🚨 CRÍTICO - NO AUTO-MENCIONARSE:** NUNCA hagas que un jugador se mencione a sí mismo. Si el jugador es "Lola", NO puede decir "Vi a Lola" o "Noté que Lola estaba...". Solo puede mencionar a OTROS jugadores que NO sean él/ella mismo.
- **CRÍTICO - CONSISTENCIA EN NOMBRES:** SIEMPRE usa el NOMBRE del personaje en todas las observaciones de la timeline. NUNCA mezcles nombres con ocupaciones. Si mencionas a un personaje por su nombre (ej: "Papito"), NO lo vuelvas a mencionar por su ocupación (ej: "el chef") en ninguna observación. Usa SIEMPRE el mismo nombre para el mismo personaje a lo largo de toda la timeline del mismo jugador.
- El asesino ve su timeline real (para mentir mejor)

**FASE 4 - REVELACIÓN DEL CRIMEN + MOTIVO DE SOSPECHA:**
Después de que se revela el crimen, cada jugador ve:
- Si es inocente o asesino (solo el asesino sabe que es el asesino)
- Su motivo de sospecha (por qué la policía lo investiga) - debe ser REAL, CREDIBLE y ESPECÍFICO
- Comportamiento sospechoso (si aplica)

**REGLAS CRÍTICAS:**

1. **FASE 1 (Información privada):**
   - Nombre: usar el nombre proporcionado o generar uno apropiado
   - Ocupación: debe coincidir con el sospechoso asignado de la lista
   - Relación con víctima: debe ser creíble y variada
   - Descripción: breve pero característica del personaje EN PRIMERA PERSONA (ej: "Soy una ama de llaves del hotel, responsable de mantener las habitaciones limpias. Siempre tengo una respuesta rápida y soy muy observadora.")

2. **FASE 2 (Contexto previo):**
   - 2-3 observaciones por jugador
   - Deben involucrar a OTROS jugadores (usar nombres, no roles)
   - **🚨 CRÍTICO - NO AUTO-MENCIONARSE:** NUNCA hagas que un jugador se mencione a sí mismo. Si el jugador se llama "Lola", NO puede decir "Vi a Lola" o "Noté que Lola". Solo puede mencionar a OTROS jugadores que NO sean él/ella mismo.
   - **CRÍTICO - CONSISTENCIA EN NOMBRES:** SIEMPRE usa el NOMBRE del personaje en todas las observaciones. NUNCA mezcles nombres con ocupaciones. Si mencionas a un personaje por su nombre (ej: "Papito"), NO lo vuelvas a mencionar por su ocupación (ej: "el chef") en ninguna observación. Usa SIEMPRE el mismo nombre para el mismo personaje a lo largo de todas las observaciones del mismo jugador.
   - Variar las observaciones: no todos ven lo mismo
   - El asesino también tiene observaciones (para poder mentir)
   - Las observaciones deben sembrar sospecha sutilmente: discusiones, comportamientos extraños, conversaciones
   - Ejemplos CORRECTOS (asumiendo que el jugador NO es ninguno de los mencionados): "Viste a [nombre] discutiendo acaloradamente con la víctima", "Notaste que [nombre] estaba muy nervioso", "Escuchaste una conversación entre [nombre1] y [nombre2] sobre [tema sospechoso]"
   - Ejemplos INCORRECTOS: Si el jugador es "Lola", NO digas "Vi a Lola" o "Noté que Lola estaba..."

3. **FASE 3 (Timeline):**
   - 3-4 momentos clave (ej: 8:30 PM, 9:00 PM, 9:15 PM (estas horas pueden variar, pon las horas que quieras, esto es solo un ejemplo) - crimen, las horas pueden ser en la mañana, tarde o noche)
   - Cada momento debe tener: hora, ubicación, actividad
   - Incluir observaciones de OTROS jugadores en cada momento (usar nombres, no roles)
   - **🚨 CRÍTICO - NO AUTO-MENCIONARSE:** NUNCA hagas que un jugador se mencione a sí mismo en las observaciones. Si el jugador se llama "Lola", NO puede decir "Vi a Lola" o "Noté que Lola estaba...". Solo puede mencionar a OTROS jugadores que NO sean él/ella mismo.
   - El asesino tiene su timeline real (dónde realmente estaba antes y despues del crimen, y detalles del crimen tambien)
   - Las horas pueden ser en la tarde, mañana o noche según el escenario
   - Las observaciones deben crear conexiones entre jugadores: "Viste a [nombre] en [lugar]", "Escuchaste [nombre] decir [algo] sobre [nombre]", "Notaste que [nombre] estaba [comportamiento]", si en las observaciones de un jugador sale que vio a dos personas conversando, en las fichas de las dos personas mencionadas debe estar esta conversacion y de lo que hablaban
   - Variar las observaciones: no todos ven lo mismo en cada momento, pero algunos pueden coincidir con lo que vieron si estaban juntos

4. **FASE 4 (Crimen + Motivo):**
   - Motivo de sospecha: REAL, CREDIBLE, ESPECÍFICO EN PRIMERA PERSONA. DEBE incluir un ALTERCADO, DISCUSIÓN o CONFLICTO PASADO con la víctima que justifique la sospecha. Ejemplos:
     * "Tuve una discusión acalorada con la víctima sobre [tema específico] hace [tiempo], y me encontraron cerca de su habitación cuando se descubrió el crimen"
     * "La víctima y yo tuvimos un conflicto por [razón específica], y fui visto saliendo de su habitación justo antes de que desapareciera"
     * "Tuvimos un altercado público sobre [tema] y me encontraron en el pasillo cerca de su habitación cuando se descubrió el crimen"
   - El motivo NO debe ser solo "fui encontrado cerca del lugar" sin contexto. DEBE haber un conflicto previo que justifique la sospecha.
   - Para el CULPABLE: coartada falsa pero creíble, debe saber dónde realmente estaba. El motivo de sospecha debe ser EN PRIMERA PERSONA e incluir un conflicto previo (ej: "Tuve una discusión con la víctima sobre [tema] y me vieron cerca del lugar del crimen en el momento exacto")
   - Comportamiento sospechoso: opcional pero recomendado, EN PRIMERA PERSONA (ej: "Estaba especialmente nervioso y evité mirar a los demás después de que se descubrió el cuerpo")
   - IMPORTANTE: Usar "culpable" en lugar de "asesino" para ser más inclusivo

**FORMATO JSON ESPERADO:**
{
  "caseTitle": "Título del caso",
  "caseDescription": "Descripción breve del caso",
  "victim": {
    "name": "Nombre de la víctima",
    "age": 45,
    "role": "Ocupación",
    "description": "Descripción de la víctima",
    "causeOfDeath": "Causa de muerte (solo asesinato)",
    "timeOfDeath": "Hora aproximada del crimen",
    "timeOfDiscovery": "Hora en que se descubrió",
    "discoveredBy": "Quién descubrió el cuerpo",
    "location": "Ubicación del crimen",
    "bodyPosition": "Posición del cuerpo",
    "visibleInjuries": "Heridas visibles",
    "objectsAtScene": "Objetos en la escena",
    "signsOfStruggle": "Signos de lucha"
  },
  "weapon": {
    "id": "weapon-id",
    "name": "Nombre del arma",
    "description": "Descripción del arma",
    "location": "Dónde se encontró",
    "photo": "URL de imagen",
    "importance": "high"
  },
  "players": [
    {
      "playerId": "${playerIds[0]}",
      "phase1": {
        "name": "${playerNames[0]}",
        "occupation": "Ocupación del jugador",
        "relationshipWithVictim": "Relación con la víctima",
        "description": "Descripción breve del personaje",
        "gender": "${playerGenders[0]}"
      },
      "phase2": {
        "observations": [
          "Observación 1 sobre otros jugadores",
          "Observación 2 sobre otros jugadores",
          "Observación 3 (opcional)"
        ]
      },
      "phase3": {
        "timeline": [
          {
            "time": "8:40 PM",
            "location": "Ubicación",
            "activity": "Qué estaba haciendo",
            "observations": ["Viste a [nombre del jugador] en [lugar]", "Escuchaste [nombre del jugador] decir [algo]"]
          },
          {
            "time": "9:05 PM",
            "location": "Ubicación",
            "activity": "Qué estaba haciendo",
            "observations": ["Viste a [nombre del jugador] en [lugar]", "Notaste que [nombre del jugador] estaba [comportamiento]"]
          },
          {
            "time": "9:20 PM",
            "location": "Ubicación (momento del crimen)",
            "activity": "Qué estaba haciendo",
            "observations": ["Viste a [nombre del jugador] en [lugar]", "Escuchaste [algo sospechoso]"]
          }
        ]
      },
      "phase4": {
        "isKiller": false,
        "whySuspicious": "Motivo REAL, CREDIBLE y ESPECÍFICO EN PRIMERA PERSONA que incluya un ALTERCADO o DISCUSIÓN previa con la víctima. Ejemplo: 'Tuve una discusión acalorada con la víctima sobre [tema] y me encontraron cerca de su habitación cuando se descubrió el crimen'",
        "suspiciousBehavior": "Comportamiento sospechoso EN PRIMERA PERSONA (opcional)"
      }
    }
    // ... repetir para cada jugador
  ],
  "hiddenContext": {
    "killerId": "${playerIds[randomKillerIndex]}",
    "killerReason": "Razón por la que el asesino cometió el crimen",
    "keyClues": ["Pista clave 1", "Pista clave 2"],
    "killerTraits": ["Rasgo 1", "Rasgo 2"]
  }
}

**CRÍTICO:**
- El array "players" debe tener EXACTAMENTE ${suspects} elementos
- Cada jugador debe tener su playerId correspondiente: ${playerIds.join(', ')}
- El jugador en la posición ${randomKillerIndex + 1} (playerId: ${playerIds[randomKillerIndex]}) debe tener "isKiller": true
- Todos los demás deben tener "isKiller": false
- Las observaciones en fase 2 y 3 deben usar NOMBRES de jugadores, no roles
- El motivo de sospecha (whySuspicious) debe ser ESPECÍFICO y CREÍBLE para todos, incluso inocentes

Genera el caso completo con todas las fases para cada jugador.`
}