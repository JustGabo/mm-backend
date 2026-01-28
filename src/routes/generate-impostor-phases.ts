import { Request, Response } from 'express'
import { SuspectService } from '../services/suspect-service.js'
import { WeaponService } from '../services/weapon-service.js'
import { getRoomPlayers, Player, Suspect } from '../services/supabase.js'
import OpenAI from 'openai'
import {
  ImpostorPhasesGenerationRequest,
  ImpostorPhasesResponse,
} from '../types/multiplayer.js'
import { CustomScenario, buildCustomScenarioText } from './generate-initial-case.js'

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

/**
 * Intenta reparar strings no terminados en JSON
 */
function fixUnterminatedStrings(jsonString: string): string {
  let result = jsonString
  let inString = false
  let escapeNext = false
  let stringStart = -1
  const stack: number[] = []
  
  for (let i = 0; i < result.length; i++) {
    const char = result[i]
    
    if (escapeNext) {
      escapeNext = false
      continue
    }
    
    if (char === '\\') {
      escapeNext = true
      continue
    }
    
    if (char === '"') {
      if (inString) {
        inString = false
        if (stack.length > 0) {
          stack.pop()
        }
      } else {
        inString = true
        stringStart = i
        stack.push(i)
      }
    }
  }
  
  if (inString && stringStart >= 0) {
    const lastBrace = result.lastIndexOf('}')
    const lastBracket = result.lastIndexOf(']')
    const lastValidPos = Math.max(lastBrace, lastBracket, 0)
    
    if (stringStart < lastValidPos) {
      let insertPos = stringStart + 1
      let foundInsertPos = false
      
      while (insertPos < result.length && insertPos <= lastValidPos) {
        const char = result[insertPos]
        if (char === ',' || char === '}' || char === ']') {
          let isEscaped = false
          let checkPos = insertPos - 1
          let backslashCount = 0
          while (checkPos >= stringStart && result[checkPos] === '\\') {
            backslashCount++
            checkPos--
          }
          isEscaped = backslashCount % 2 === 1
          
          if (!isEscaped) {
            result = result.slice(0, insertPos) + '"' + result.slice(insertPos)
            foundInsertPos = true
            break
          }
        }
        insertPos++
      }
      
      if (!foundInsertPos && lastValidPos > stringStart) {
        result = result.slice(0, lastValidPos) + '"' + result.slice(lastValidPos)
      }
    } else {
      result = result + '"'
    }
  }
  
  return result
}

/**
 * Reparar y parsear JSON con validación
 */
function parseAndRepairJSON(response: string): any {
  let trimmed = response.trim()
  
  if (!trimmed.endsWith('}')) {
    console.warn('⚠️  JSON no termina con }, intentando reparar...')
    
    const lastBrace = trimmed.lastIndexOf('}')
    if (lastBrace > 0) {
      const beforeLastBrace = trimmed.substring(0, lastBrace + 1)
      const quoteCount = (beforeLastBrace.match(/"/g) || []).length
      if (quoteCount % 2 === 0) {
        trimmed = beforeLastBrace
        console.log('✅ Reparado: usando hasta el último } válido')
      } else {
        const fixed = fixUnterminatedStrings(beforeLastBrace)
        trimmed = fixed
        console.log('✅ Reparado: strings balanceados y JSON cerrado')
      }
    } else {
      let openBraces = 0
      let openBrackets = 0
      let lastValidPos = trimmed.length
      
      for (let i = trimmed.length - 1; i >= 0; i--) {
        const char = trimmed[i]
        if (char === '}') openBraces++
        else if (char === '{') openBraces--
        else if (char === ']') openBrackets++
        else if (char === '[') openBrackets--
        
        if (openBraces < 0 || openBrackets < 0) {
          lastValidPos = i + 1
          break
        }
      }
      
      let closing = ''
      if (openBraces > 0) closing += '}'.repeat(openBraces)
      if (openBrackets > 0) closing += ']'.repeat(openBrackets)
      
      trimmed = trimmed.substring(0, lastValidPos) + closing
      console.log(`✅ Reparado: agregado ${closing.length} caracteres de cierre`)
    }
    
    if (!trimmed.endsWith('}')) {
      throw new Error('Model returned incomplete JSON (not closed, could not repair)')
    }
  }
  
  const quoteCount = (trimmed.match(/"/g) || []).length
  if (quoteCount % 2 !== 0) {
    console.warn('⚠️  Unbalanced quotes detected, attempting to fix...')
    const fixed = fixUnterminatedStrings(trimmed)
    const fixedQuoteCount = (fixed.match(/"/g) || []).length
    if (fixedQuoteCount % 2 === 0) {
      console.log('✅ Fixed unbalanced quotes')
      trimmed = fixed
    } else {
      throw new Error('Model returned malformed JSON (unbalanced quotes, could not fix)')
    }
  }
  
  try {
    return JSON.parse(trimmed)
  } catch (err) {
    console.error('❌ JSON.parse failed, attempting to fix...')
    try {
      const fixed = fixUnterminatedStrings(trimmed)
      return JSON.parse(fixed)
    } catch (fixErr) {
      console.error(`   Response length: ${trimmed.length} characters`)
      console.error(`   Last 500 chars: ${trimmed.slice(-500)}`)
      throw new Error(
        `Model returned invalid JSON that could not be repaired. ` +
        `Original: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}

/**
 * PASO 1: Generar core del caso (caseTitle, caseDescription, victim, weapon)
 */
async function generatePhasesCaseCore(
  request: ImpostorPhasesGenerationRequest,
  selectedSuspects: any[],
  selectedWeapon: any,
  language: string,
  discoveredByPlayerIndex: number,
  playerNames: string[]
): Promise<{ caseTitle: string; caseDescription: string; victim: any; weapon?: any }> {
  const openai = getOpenAIClient()
  
  const languageInstruction = language === 'es' 
    ? '**IDIOMA OBLIGATORIO: ESPAÑOL** - TODO el contenido generado (títulos, descripciones, nombres, etc.) DEBE estar en ESPAÑOL.'
    : '**MANDATORY LANGUAGE: ENGLISH** - ALL generated content (titles, descriptions, names, etc.) MUST be in ENGLISH.'
  
  // Determinar el escenario a usar
  const scenarioText = request.customScenario 
    ? `Escenario personalizado: ${buildCustomScenarioText(request.customScenario)}`
    : `Escenario: ${request.scenario || 'aleatorio'}`

  const customScenarioDetails = request.customScenario
    ? `\n**CONTEXTO DEL ESCENARIO PERSONALIZADO:**
- Lugar: ${request.customScenario.place}
${request.customScenario.themeOrSituation ? `- Tema/Situación: ${request.customScenario.themeOrSituation}` : ''}

Debes crear un caso que se ajuste perfectamente a este escenario personalizado. Usa tu creatividad para adaptar todos los elementos (víctima, ubicación, detalles) a este contexto específico.`
    : ''

  const prompt = language === 'es' ? `
Genera SOLO el core de un caso de misterio interactivo para juegos multijugador estilo "Among Us" pero narrativo.

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
${languageInstruction}
- Quien descubrió el cuerpo: ${playerNames[discoveredByPlayerIndex]} (Player ${discoveredByPlayerIndex + 1})
${customScenarioDetails}

${selectedWeapon ? `**ARMA HOMICIDA:**
- Nombre: ${selectedWeapon.name.es}
- URL de imagen: ${selectedWeapon.image_url}
` : ''}

**VÍCTIMA - DETALLES COMPLETOS OBLIGATORIOS:**
Crea una víctima con TODOS estos campos (NO OMITIR NINGUNO):
- Nombre, edad, rol/profesión
- Descripción de la víctima
${request.caseType === 'asesinato' ? `- **causeOfDeath**: Causa de muerte específica y detallada (relacionada con el arma: ${selectedWeapon?.name.es || 'arma genérica'})` : ''}
- **timeOfDeath**: Hora aproximada del crimen
- **timeOfDiscovery**: Hora en que se descubrió
- **discoveredBy**: ${playerNames[discoveredByPlayerIndex]} (Player ${discoveredByPlayerIndex + 1})
- **location**: Ubicación del crimen
- **bodyPosition**: Posición del cuerpo
- **visibleInjuries**: Heridas visibles
- **objectsAtScene**: Objetos en la escena
- **signsOfStruggle**: Signos de lucha

**FORMATO JSON ESPERADO:**
{
  "caseTitle": "Título del caso",
  "caseDescription": "Descripción breve del caso",
  "victim": {
    "name": "Nombre de la víctima",
    "age": 45,
    "role": "Ocupación",
    "description": "Descripción de la víctima",
    ${request.caseType === 'asesinato' ? `"causeOfDeath": "Causa específica",` : ''}
    "timeOfDeath": "Hora aproximada del crimen",
    "timeOfDiscovery": "Hora en que se descubrió",
    "discoveredBy": "${playerNames[discoveredByPlayerIndex]}",
    "location": "Ubicación del crimen",
    "bodyPosition": "Posición del cuerpo",
    "visibleInjuries": "Heridas visibles",
    "objectsAtScene": "Objetos en la escena",
    "signsOfStruggle": "Signos de lucha"
  }${selectedWeapon ? `,
  "weapon": {
    "id": "weapon-id",
    "name": "${selectedWeapon.name.es}",
    "description": "Descripción del arma",
    "location": "Dónde se encontró",
    "photo": "${selectedWeapon.image_url}",
    "importance": "high"
  }` : ''}
}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
` : `
Generate ONLY the core of an interactive mystery case for multiplayer games like "Among Us" but narrative.

**CONFIGURATION:**
- Case type: ${request.caseType}
- Scenario: ${request.scenario}
- Difficulty: ${request.difficulty}
${languageInstruction}
- Who discovered the body: ${playerNames[discoveredByPlayerIndex]} (Player ${discoveredByPlayerIndex + 1})

${selectedWeapon ? `**MURDER WEAPON:**
- Name: ${selectedWeapon.name.en}
- Image URL: ${selectedWeapon.image_url}
` : ''}

**VICTIM - COMPLETE MANDATORY DETAILS:**
Create a victim with ALL these fields (DO NOT OMIT ANY):
- Name, age, role/profession
- Victim description
${request.caseType === 'asesinato' ? `- **causeOfDeath**: Specific and detailed cause of death (related to the weapon: ${selectedWeapon?.name.en || 'generic weapon'})` : ''}
- **timeOfDeath**: Approximate time of crime
- **timeOfDiscovery**: Time when discovered
- **discoveredBy**: ${playerNames[discoveredByPlayerIndex]} (Player ${discoveredByPlayerIndex + 1})
- **location**: Crime location
- **bodyPosition**: Body position
- **visibleInjuries**: Visible injuries
- **objectsAtScene**: Objects at scene
- **signsOfStruggle**: Signs of struggle

**EXPECTED JSON FORMAT:**
{
  "caseTitle": "Case title",
  "caseDescription": "Brief case description",
  "victim": {
    "name": "Victim name",
    "age": 45,
    "role": "Occupation",
    "description": "Victim description",
    ${request.caseType === 'asesinato' ? `"causeOfDeath": "Specific cause",` : ''}
    "timeOfDeath": "Approximate time of crime",
    "timeOfDiscovery": "Time when discovered",
    "discoveredBy": "${playerNames[discoveredByPlayerIndex]}",
    "location": "Crime location",
    "bodyPosition": "Body position",
    "visibleInjuries": "Visible injuries",
    "objectsAtScene": "Objects at scene",
    "signsOfStruggle": "Signs of struggle"
  }${selectedWeapon ? `,
  "weapon": {
    "id": "weapon-id",
    "name": "${selectedWeapon.name.en}",
    "description": "Weapon description",
    "location": "Where it was found",
    "photo": "${selectedWeapon.image_url}",
    "importance": "high"
  }` : ''}
}

**RESPOND WITH A VALID JSON OBJECT following the format above.**
`

  console.log('🤖 Paso 1: Generando core del caso con fases...')
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: language === 'en' 
          ? 'You are an expert in creating interactive mystery cases for multiplayer games. Language: ENGLISH. Responde SOLO JSON válido.'
          : 'Eres un experto en crear casos de misterio interactivos para juegos multijugador. Idioma: ESPAÑOL. Responde SOLO JSON válido.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.9,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  console.log('✅ Core generado, parseando...')
  return parseAndRepairJSON(response)
}

/**
 * PASO 2: Generar jugadores con fases en batches
 */
async function generatePlayersPhasesBatch(
  request: ImpostorPhasesGenerationRequest,
  selectedSuspects: any[],
  language: string,
  randomKillerIndex: number,
  playerNames: string[],
  playerGenders: string[],
  playerIds: string[],
  discoveredByPlayerIndex: number,
  existingPlayers: any[],
  batchStart: number,
  batchSize: number
): Promise<any[]> {
  const openai = getOpenAIClient()
  
  const batchEnd = Math.min(batchStart + batchSize, request.suspects)
  const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i)
  
  console.log(`🤖 Paso 2: Generando jugadores con fases ${batchStart + 1}-${batchEnd} de ${request.suspects}...`)
  
  const batchSupabaseSuspects = selectedSuspects.slice(batchStart, batchEnd)
  
  const suspectsInfo = batchSupabaseSuspects.map((s, i) => `
- Player ${batchStart + i + 1} (ID: ${playerIds[batchStart + i]}):
  - Género: ${s.gender}
  - Edad aproximada: ${s.approx_age}
  - Ocupación: ${language === 'es' ? s.occupation?.es : s.occupation?.en || s.occupation}
  - Tags: ${s.tags?.join(', ') || 'sin tags'}
  - URL de imagen: ${s.image_url}
`).join('\n')

  const namesInfo = playerNames.length > 0 && batchStart < playerNames.length
    ? `\n**NOMBRES DE JUGADORES PROPORCIONADOS PARA ESTE BATCH:**
${batchIndices.map((idx, i) => {
      const nameIdx = batchStart + i
      const name = playerNames[nameIdx]
      const gender = playerGenders[nameIdx] || 'unknown'
      return `- Player ${idx + 1} (ID: ${playerIds[nameIdx]}): ${name} (${gender === 'male' ? 'hombre' : gender === 'female' ? 'mujer' : 'desconocido'})`
    }).join('\n')}\n\nUsa estos nombres EXACTOS para los jugadores en el orden proporcionado.`
    : '\n**NOMBRES:** Genera nombres apropiados para todos los jugadores basándote en el género y ocupación de cada uno.\n'

  const previousPlayersContext = existingPlayers.length > 0
    ? `\n**JUGADORES YA GENERADOS (CONTEXTO):**
${existingPlayers.map(p => `- ${p.phase1?.name || 'Sin nombre'} (${p.phase1?.occupation || 'Sin ocupación'}): ${p.phase1?.description || 'Sin descripción'}`).join('\n')}
\n**IMPORTANTE:** Los nuevos jugadores deben tener conocimiento de estos jugadores anteriores y sus relaciones con ellos. Las observaciones deben incluir referencias a estos jugadores anteriores cuando sea apropiado.`
    : ''

  // Crear el prompt completo para este batch
  const prompt = createPlayersPhasesBatchPrompt(
    request,
    suspectsInfo,
    namesInfo,
    language,
    randomKillerIndex,
    playerNames,
    playerGenders,
    playerIds,
    discoveredByPlayerIndex,
    batchIndices,
    batchStart,
    batchSize,
    previousPlayersContext
  )

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: language === 'en' 
          ? 'You are an expert in creating interactive mystery cases for multiplayer games. Language: ENGLISH. You generate detailed and structured information by phases for each player. Responde SOLO JSON válido.'
          : 'Eres un experto en crear casos de misterio interactivos para juegos multijugador. Idioma: ESPAÑOL. Generas información detallada y estructurada por fases para cada jugador. Responde SOLO JSON válido.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.9,
    max_tokens: Math.min(4000, 1000 + (batchSize * 600)), // ~600 tokens por jugador (4 fases)
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  console.log(`✅ Batch ${batchStart + 1}-${batchEnd} generado, parseando...`)
  const parsed = parseAndRepairJSON(response)
  
  if (!parsed.players || !Array.isArray(parsed.players)) {
    throw new Error('Invalid response structure: missing players array')
  }
  
  if (parsed.players.length !== batchSize) {
    throw new Error(`AI generated ${parsed.players.length} players but ${batchSize} were requested for this batch`)
  }
  
  return parsed.players
}

/**
 * Crear prompt para batch de jugadores con fases
 */
function createPlayersPhasesBatchPrompt(
  request: ImpostorPhasesGenerationRequest,
  suspectsInfo: string,
  namesInfo: string,
  language: string,
  randomKillerIndex: number,
  playerNames: string[],
  playerGenders: string[],
  playerIds: string[],
  discoveredByPlayerIndex: number,
  batchIndices: number[],
  batchStart: number,
  batchSize: number,
  previousPlayersContext: string
): string {
  const caseTypeText = request.caseType === 'asesinato' 
    ? 'asesinato' 
    : request.caseType === 'secuestro' 
    ? 'secuestro' 
    : 'robo'

  const difficultyText = request.difficulty === 'easy' 
    ? 'FÁCIL' 
    : request.difficulty === 'normal' 
    ? 'NORMAL' 
    : 'DIFÍCIL'

  const batchEnd = Math.min(batchStart + batchSize, request.suspects)
  
  const languageInstruction = language === 'es' 
    ? '**IDIOMA OBLIGATORIO: ESPAÑOL** - TODO el contenido generado DEBE estar en ESPAÑOL. Nombres, descripciones, observaciones, timelines, alibis, TODO.'
    : '**MANDATORY LANGUAGE: ENGLISH** - ALL generated content MUST be in ENGLISH. Names, descriptions, observations, timelines, alibis, EVERYTHING.'

  return `You are an expert in creating interactive mystery cases for multiplayer games like "Among Us" but narrative.

**CONTEXT:**
You are creating a ${caseTypeText} case for ${request.suspects} players in a ${request.scenario} scenario.
Difficulty: ${difficultyText}
${languageInstruction}
${language === 'es' ? `Jugadores a generar en este batch: ${batchStart + 1} a ${batchEnd} (${batchIndices.map(i => `Player ${i + 1}`).join(', ')})

**SOSPECHOSOS DISPONIBLES PARA ESTE BATCH:**` : `Players to generate in this batch: ${batchStart + 1} to ${batchEnd} (${batchIndices.map(i => `Player ${i + 1}`).join(', ')})

**SUSPECTS AVAILABLE FOR THIS BATCH:**`}
${suspectsInfo}
${namesInfo}
${previousPlayersContext}

${language === 'es' ? `**IMPORTANTE:**
- El jugador en la posición ${randomKillerIndex + 1} (${playerNames[randomKillerIndex]}) es el ASESINO/CULPABLE
${batchIndices.includes(randomKillerIndex) ? `- ⚠️ **EL ASESINO ESTÁ EN ESTE BATCH (Player ${randomKillerIndex + 1})**` : '- ⚠️ **El asesino NO está en este batch, todos deben tener isKiller: false**'}
- El jugador en la posición ${discoveredByPlayerIndex + 1} (${playerNames[discoveredByPlayerIndex]}) descubrió el cuerpo (NO puede ser el asesino)
${batchIndices.includes(discoveredByPlayerIndex) ? `- ⚠️ **QUIEN DESCUBRIÓ EL CUERPO ESTÁ EN ESTE BATCH (Player ${discoveredByPlayerIndex + 1})**` : ''}
- Cada jugador debe tener información diferente y única por fases
- El asesino también recibe información (para poder mentir mejor)

**CRÍTICO - LEER ATENTAMENTE:**
- 🚨 **NÚMERO DE JUGADORES - OBLIGATORIO: DEBES generar EXACTAMENTE ${batchSize} jugadores en el array "players".**
- 🚨 **LISTA OBLIGATORIA DE IDs DE JUGADORES QUE DEBES GENERAR:**
${batchIndices.map((idx, i) => `  ${idx + 1}. Player ${idx + 1} (ID: ${playerIds[batchStart + i]})`).join('\n')}
- 🚨 **El array "players" DEBE contener EXACTAMENTE estos ${batchSize} elementos con estos IDs. NO omitas ninguno.**` : `**IMPORTANT:**
- The player at position ${randomKillerIndex + 1} (${playerNames[randomKillerIndex]}) is the KILLER/GUILTY
${batchIndices.includes(randomKillerIndex) ? `- ⚠️ **THE KILLER IS IN THIS BATCH (Player ${randomKillerIndex + 1})**` : '- ⚠️ **The killer is NOT in this batch, all must have isKiller: false**'}
- The player at position ${discoveredByPlayerIndex + 1} (${playerNames[discoveredByPlayerIndex]}) discovered the body (CANNOT be the killer)
${batchIndices.includes(discoveredByPlayerIndex) ? `- ⚠️ **WHO DISCOVERED THE BODY IS IN THIS BATCH (Player ${discoveredByPlayerIndex + 1})**` : ''}
- Each player must have different and unique information by phases
- The killer also receives information (to be able to lie better)

**CRITICAL - READ CAREFULLY:**
- 🚨 **NUMBER OF PLAYERS - MANDATORY: YOU MUST generate EXACTLY ${batchSize} players in the "players" array.**
- 🚨 **MANDATORY LIST OF PLAYER IDs YOU MUST GENERATE:**
${batchIndices.map((idx, i) => `  ${idx + 1}. Player ${idx + 1} (ID: ${playerIds[batchStart + i]})`).join('\n')}
- 🚨 **The "players" array MUST contain EXACTLY these ${batchSize} elements with these IDs. DO NOT omit any.**`}

**ESTRUCTURA DE FASES (OBLIGATORIA PARA CADA JUGADOR):**

**FASE 1 - INFORMACIÓN PRIVADA (ANTES DEL CRIMEN):**
- Nombre: usar el nombre proporcionado o generar uno apropiado
- Ocupación: debe coincidir con el sospechoso asignado de la lista
- Relación con víctima: debe ser creíble y variada
- Descripción: breve pero característica del personaje EN PRIMERA PERSONA
- Gender: usar el género proporcionado

**FASE 2 - CONTEXTO PREVIO AL CRIMEN:**
- 2-3 observaciones por jugador
- Deben involucrar a OTROS jugadores (usar nombres, no roles)
- **🚨 CRÍTICO - NO AUTO-MENCIONARSE:** NUNCA hagas que un jugador se mencione a sí mismo
- **CRÍTICO - CONSISTENCIA EN NOMBRES:** SIEMPRE usa el NOMBRE del personaje, NUNCA mezcles nombres con ocupaciones
- Variar las observaciones: no todos ven lo mismo
- El asesino también tiene observaciones (para poder mentir)

**FASE 3 - LÍNEA TEMPORAL DEL EVENTO:**
- 3-4 momentos clave con hora, ubicación, actividad
- Incluir observaciones de OTROS jugadores en cada momento (usar nombres, no roles)
- **🚨 CRÍTICO - NO AUTO-MENCIONARSE:** NUNCA hagas que un jugador se mencione a sí mismo en las observaciones
- **CRÍTICO - CONSISTENCIA EN NOMBRES:** SIEMPRE usa el NOMBRE del personaje en todas las observaciones
- El asesino tiene su timeline real (dónde realmente estaba antes y después del crimen)

**FASE 4 - REVELACIÓN DEL CRIMEN + MOTIVO DE SOSPECHA:**
- isKiller: true para UNO SOLO si está en este batch y es Player ${randomKillerIndex + 1}, false para todos los demás
- whySuspicious: REAL, CREDIBLE, ESPECÍFICO EN PRIMERA PERSONA. DEBE incluir un ALTERCADO, DISCUSIÓN o CONFLICTO PASADO con la víctima
- alibi: Coartada COMPLETA EN PRIMERA PERSONA que incluye TODO: dónde estaba, qué estaba haciendo, con quién (si aplica), y HORAS ESPECÍFICAS. Si es el asesino, debe ser FALSA pero creíble. Si es inocente, debe ser VERDADERA.
- suspiciousBehavior: opcional pero recomendado, EN PRIMERA PERSONA

${language === 'es' ? `**FORMATO JSON ESPERADO:**
{
  "players": [
    ${batchIndices.map((idx, i) => `{
      "playerId": "${playerIds[batchStart + i]}",
      "phase1": {
        "name": "${playerNames[batchStart + i] || 'Nombre generado'}",
        "occupation": "Ocupación exacta de Supabase",
        "relationshipWithVictim": "Relación con la víctima",
        "description": "Descripción breve EN PRIMERA PERSONA",
        "gender": "${playerGenders[batchStart + i] || 'unknown'}"
      },
      "phase2": {
        "observations": [
          "Observación 1 sobre otros jugadores (usar nombres)",
          "Observación 2 sobre otros jugadores (usar nombres)",
          "Observación 3 (opcional)"
        ]
      },
      "phase3": {
        "timeline": [
          {
            "time": "8:40 PM",
            "location": "Ubicación",
            "activity": "Qué estaba haciendo",
            "observations": ["Viste a [nombre] en [lugar]", "Escuchaste [nombre] decir [algo]"]
          },
          {
            "time": "9:05 PM",
            "location": "Ubicación",
            "activity": "Qué estaba haciendo",
            "observations": ["Viste a [nombre] en [lugar]", "Notaste que [nombre] estaba [comportamiento]"]
          },
          {
            "time": "9:20 PM",
            "location": "Ubicación (momento del crimen)",
            "activity": "Qué estaba haciendo",
            "observations": ["Viste a [nombre] en [lugar]", "Escuchaste [algo sospechoso]"]
          }
        ]
      },
      "phase4": {
        "isKiller": ${idx === randomKillerIndex ? 'true' : 'false'},
        "whySuspicious": "Motivo REAL, CREDIBLE y ESPECÍFICO EN PRIMERA PERSONA que incluya un ALTERCADO o DISCUSIÓN previa con la víctima",
        "alibi": "Coartada COMPLETA EN PRIMERA PERSONA con HORAS ESPECÍFICAS (FALSA si es asesino, VERDADERA si es inocente)",
        "suspiciousBehavior": "Comportamiento sospechoso EN PRIMERA PERSONA (opcional)"
      }
    }`).join(',\n    ')}
  ]
}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**` : `**EXPECTED JSON FORMAT:**
{
  "players": [
    ${batchIndices.map((idx, i) => `{
      "playerId": "${playerIds[batchStart + i]}",
      "phase1": {
        "name": "${playerNames[batchStart + i] || 'Generated name'}",
        "occupation": "Exact occupation from Supabase",
        "relationshipWithVictim": "Relationship with victim",
        "description": "Brief description IN FIRST PERSON",
        "gender": "${playerGenders[batchStart + i] || 'unknown'}"
      },
      "phase2": {
        "observations": [
          "Observation 1 about other players (use names)",
          "Observation 2 about other players (use names)",
          "Observation 3 (optional)"
        ]
      },
      "phase3": {
        "timeline": [
          {
            "time": "8:40 PM",
            "location": "Location",
            "activity": "What they were doing",
            "observations": ["You saw [name] at [place]", "You heard [name] say [something]"]
          },
          {
            "time": "9:05 PM",
            "location": "Location",
            "activity": "What they were doing",
            "observations": ["You saw [name] at [place]", "You noticed that [name] was [behavior]"]
          },
          {
            "time": "9:20 PM",
            "location": "Location (time of crime)",
            "activity": "What they were doing",
            "observations": ["You saw [name] at [place]", "You heard [something suspicious]"]
          }
        ]
      },
      "phase4": {
        "isKiller": ${idx === randomKillerIndex ? 'true' : 'false'},
        "whySuspicious": "REAL, CREDIBLE and SPECIFIC reason IN FIRST PERSON that includes an ALTERCATION or DISCUSSION with the victim",
        "alibi": "COMPLETE alibi IN FIRST PERSON with SPECIFIC TIMES (FALSE if killer, TRUE if innocent)",
        "suspiciousBehavior": "Suspicious behavior IN FIRST PERSON (optional)"
      }
    }`).join(',\n    ')}
  ]
}

**RESPOND WITH A VALID JSON OBJECT following the format above.**`}
`
}

/**
 * PASO 3: Generar hiddenContext
 */
async function generatePhasesHiddenContext(
  request: ImpostorPhasesGenerationRequest,
  language: string,
  randomKillerIndex: number,
  killerPlayerId: string,
  allPlayers: any[]
): Promise<any> {
  const openai = getOpenAIClient()
  
  // Buscar el killer por playerId o por isKiller si no se encuentra por ID
  let killerPlayer = allPlayers.find(p => p.playerId === killerPlayerId)
  if (!killerPlayer) {
    // Si no se encuentra por ID, buscar por isKiller
    killerPlayer = allPlayers.find(p => p.phase4?.isKiller === true)
    if (killerPlayer && (!killerPlayer.playerId || killerPlayer.playerId === 'undefined')) {
      killerPlayer.playerId = killerPlayerId
      console.log(`✅ Assigned killerPlayerId in hiddenContext function: ${killerPlayerId}`)
    }
  }
  
  if (!killerPlayer) {
    throw new Error(`Could not find killer player. killerPlayerId: ${killerPlayerId}, allPlayers: ${allPlayers.length}`)
  }
  
  const languageInstruction = language === 'es' 
    ? '**IDIOMA OBLIGATORIO: ESPAÑOL** - TODO el contenido generado DEBE estar en ESPAÑOL.'
    : '**MANDATORY LANGUAGE: ENGLISH** - ALL generated content MUST be in ENGLISH.'
  
  // Determinar el escenario a usar
  const scenarioText = request.customScenario 
    ? `Escenario personalizado: ${buildCustomScenarioText(request.customScenario)}`
    : `Escenario: ${request.scenario || 'aleatorio'}`

  const customScenarioDetails = request.customScenario
    ? `\n**CONTEXTO DEL ESCENARIO PERSONALIZADO:**
- Lugar: ${request.customScenario.place}
${request.customScenario.themeOrSituation ? `- Tema/Situación: ${request.customScenario.themeOrSituation}` : ''}

Las pistas clave y razones del asesino deben estar relacionadas con este escenario personalizado.`
    : ''

  const prompt = language === 'es' ? `
Genera el contexto oculto (hiddenContext) para un caso de misterio interactivo.

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
${languageInstruction}
- Asesino: Player ${randomKillerIndex + 1} (ID: ${killerPlayerId}, Nombre: ${killerPlayer?.phase1?.name || 'Nombre del asesino'})
${customScenarioDetails}

**JUGADORES:**
${allPlayers.map(p => `- ${p.phase1?.name || 'Sin nombre'} (${p.playerId}): ${p.phase1?.occupation || 'Sin ocupación'} - ${p.phase4?.isKiller ? 'ASESINO' : 'INOCENTE'}`).join('\n')}

**FORMATO JSON ESPERADO:**
{
  "hiddenContext": {
    "killerId": "${killerPlayerId}",
    "killerReason": "Razón por la que el asesino cometió el crimen (2-3 oraciones)",
    "keyClues": ["Pista clave 1", "Pista clave 2", "Pista clave 3"],
    "killerTraits": ["Rasgo 1", "Rasgo 2"]
  }
}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
` : `
Generate the hidden context (hiddenContext) for an interactive mystery case.

**CONFIGURATION:**
- Case type: ${request.caseType}
- Scenario: ${request.scenario}
- Difficulty: ${request.difficulty}
${languageInstruction}
- Killer: Player ${randomKillerIndex + 1} (ID: ${killerPlayerId}, Name: ${killerPlayer?.phase1?.name || 'Killer name'})

**PLAYERS:**
${allPlayers.map(p => `- ${p.phase1?.name || 'No name'} (${p.playerId}): ${p.phase1?.occupation || 'No occupation'} - ${p.phase4?.isKiller ? 'KILLER' : 'INNOCENT'}`).join('\n')}

**EXPECTED JSON FORMAT:**
{
  "hiddenContext": {
    "killerId": "${killerPlayerId}",
    "killerReason": "Reason why the killer committed the crime (2-3 sentences)",
    "keyClues": ["Key clue 1", "Key clue 2", "Key clue 3"],
    "killerTraits": ["Trait 1", "Trait 2"]
  }
}

**RESPOND WITH A VALID JSON OBJECT following the format above.**
`

  console.log('🤖 Paso 3: Generando hiddenContext...')
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: language === 'en' 
          ? 'You are an expert in creating interactive mystery cases. Language: ENGLISH. Responde SOLO JSON válido.'
          : 'Eres un experto en crear casos de misterio interactivos. Idioma: ESPAÑOL. Responde SOLO JSON válido.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.9,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  console.log('✅ HiddenContext generado, parseando...')
  const parsed = parseAndRepairJSON(response)
  return parsed.hiddenContext
}

export async function generateImpostorPhases(req: Request, res: Response) {
  try {
    console.log('API Route: generate-impostor-phases called (MULTI-STEP)')
    
    const body: ImpostorPhasesGenerationRequest = req.body
    console.log('Request body:', body)
    
    // Validate required fields
    if (!body.roomId || !body.caseType || !body.suspects || !body.clues || !body.difficulty) {
      return res.status(400).json({ error: 'Missing required fields: roomId, caseType, suspects, clues, difficulty' })
    }

    // Validar que solo haya scenario o customScenario, no ambos
    if (body.scenario && body.customScenario) {
      return res.status(400).json({ error: 'Cannot provide both scenario and customScenario. Provide only one.' })
    }

    if (!body.scenario && !body.customScenario) {
      return res.status(400).json({ error: 'Must provide either scenario or customScenario' })
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
    // Si hay customScenario, no pasar scene (obtendrá aleatorios)
    const sceneForService = body.customScenario ? undefined : body.scenario;
    
    console.log(`🔍 Fetching ${body.suspects} suspects from Supabase...`)
    if (body.customScenario) {
      console.log(`🎨 Custom scenario detected: "${buildCustomScenarioText(body.customScenario)}" - fetching random suspects`);
      console.log(`   Place: ${body.customScenario.place}`);
      if (body.customScenario.themeOrSituation) {
        console.log(`   Theme/Situation: ${body.customScenario.themeOrSituation}`);
      }
    } else {
      console.log(`📍 Fixed scenario: ${body.scenario}`);
    }
    
    const preferredGenders = playerGenders.filter((g: string) => g !== 'unknown')
    
    const selectedSuspects = await SuspectService.getSuspectsForScene({
      count: body.suspects,
      scene: sceneForService,
      style: body.style,
      preferredGenders: preferredGenders.length > 0 ? preferredGenders : undefined,
    })
    
    if (!selectedSuspects || selectedSuspects.length === 0) {
      return res.status(500).json({ error: 'No suspects available in database' })
    }
    
    console.log(`✅ Found ${selectedSuspects.length} suspects from Supabase`)

    // Seleccionar arma (solo para asesinato)
    // Si hay customScenario, no pasar scene (obtendrá aleatoria)
    let selectedWeapon = null
    if (body.caseType === 'asesinato') {
      console.log(`🔫 Selecting murder weapon...`)
      selectedWeapon = await WeaponService.selectWeapon({
        scene: sceneForService,
        style: body.style,
        preferSpecific: !body.customScenario, // No preferir específica si es custom
      })
      const weaponName = language === 'es' ? selectedWeapon?.name?.es : selectedWeapon?.name?.en
      console.log(`✅ Selected weapon: ${weaponName}`)
    }

    // Seleccionar asesino aleatorio
    const randomKillerIndex = Math.floor(Math.random() * body.suspects)
    
    // Generar playerIds, nombres y géneros para todos los jugadores (reales + generados)
    // Si hay más jugadores solicitados que reales, generar valores para los adicionales
    const allPlayerIds: string[] = []
    const allPlayerNames: string[] = []
    const allPlayerGenders: string[] = []
    
    for (let i = 0; i < body.suspects; i++) {
      if (i < playerIds.length) {
        // Usar valores reales de la sala
        allPlayerIds.push(playerIds[i])
        allPlayerNames.push(playerNames[i])
        allPlayerGenders.push(playerGenders[i])
      } else {
        // Generar valores para jugador adicional
        allPlayerIds.push(`generated-player-${i}`)
        allPlayerNames.push(`Jugador ${i + 1}`) // Nombre genérico que será reemplazado por la IA
        allPlayerGenders.push('unknown')
      }
    }
    
    const killerPlayerId = allPlayerIds[randomKillerIndex]

    // Seleccionar quién descubrió el cuerpo (no puede ser el asesino)
    let discoveredByPlayerIndex = randomKillerIndex
    while (discoveredByPlayerIndex === randomKillerIndex) {
      discoveredByPlayerIndex = Math.floor(Math.random() * body.suspects)
    }

    console.log(`🎲 Killer selected: Player ${randomKillerIndex + 1} (${killerPlayerId})`)
    console.log(`🔍 Body discovered by: Player ${discoveredByPlayerIndex + 1}`)

    // ============================================
    // PASO 1: Generar core del caso
    // ============================================
    const caseCore = await generatePhasesCaseCore(
      body,
      selectedSuspects,
      selectedWeapon,
      language,
      discoveredByPlayerIndex,
      allPlayerNames // Usar allPlayerNames en lugar de playerNames
    )
    console.log('✅ Paso 1 completado: Core del caso generado')

    // ============================================
    // PASO 2: Generar jugadores con fases en batches
    // ============================================
    const BATCH_SIZE = 3 // Generar 3 jugadores a la vez
    const allPlayers: any[] = []
    
    for (let batchStart = 0; batchStart < body.suspects; batchStart += BATCH_SIZE) {
      const batch = await generatePlayersPhasesBatch(
        body,
        selectedSuspects,
        language,
        randomKillerIndex,
        allPlayerNames, // Usar allPlayerNames en lugar de playerNames
        allPlayerGenders, // Usar allPlayerGenders en lugar de playerGenders
        allPlayerIds, // Usar allPlayerIds en lugar de playerIds
        discoveredByPlayerIndex,
        allPlayers, // Pasar jugadores anteriores como contexto
        batchStart,
        Math.min(BATCH_SIZE, body.suspects - batchStart)
      )
      allPlayers.push(...batch)
      console.log(`✅ Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} completado: ${batch.length} jugadores generados`)
    }
    
    console.log(`✅ Paso 2 completado: ${allPlayers.length} jugadores generados`)

    // Validar número de jugadores
    if (allPlayers.length !== body.suspects) {
      throw new Error(`AI generated ${allPlayers.length} players instead of ${body.suspects}`)
    }

    // Asignar playerIds a cada jugador generado
    // Usar allPlayerIds que ya tiene IDs para todos (reales + generados)
    const nameToIdMap = new Map<string, string>()
    roomPlayers.forEach((p: Player, idx: number) => {
      const name = p.name || `Jugador ${p.id.slice(0, 8)}`
      if (idx < allPlayerIds.length) {
        nameToIdMap.set(name.toLowerCase().trim(), allPlayerIds[idx])
      }
    })

    // Primero intentar matching por nombre para los jugadores reales
    const usedPlayerIds = new Set<string>()
    allPlayers.forEach((player, index) => {
      const generatedName = player.phase1?.name?.toLowerCase().trim() || ''
      const matchedId = nameToIdMap.get(generatedName)
      
      if (matchedId && !usedPlayerIds.has(matchedId)) {
        player.playerId = matchedId
        usedPlayerIds.add(matchedId)
        console.log(`✅ Matched player "${player.phase1?.name}" → ${matchedId}`)
      }
    })

    // Luego asignar IDs a los jugadores que no tienen (por orden de índice)
    allPlayers.forEach((player, index) => {
      if (!player.playerId || player.playerId === 'undefined') {
        // Usar el ID correspondiente a su índice en allPlayerIds
        if (index < allPlayerIds.length) {
          const assignedId = allPlayerIds[index]
          if (!usedPlayerIds.has(assignedId)) {
            player.playerId = assignedId
            usedPlayerIds.add(assignedId)
            console.log(`✅ Assigned playerId to "${player.phase1?.name}" (index ${index}): ${assignedId}`)
          } else {
            // Si ya está usado, buscar el siguiente disponible
            let found = false
            for (let i = 0; i < allPlayerIds.length; i++) {
              if (!usedPlayerIds.has(allPlayerIds[i])) {
                player.playerId = allPlayerIds[i]
                usedPlayerIds.add(allPlayerIds[i])
                console.log(`✅ Assigned available playerId to "${player.phase1?.name}" (index ${index}): ${allPlayerIds[i]}`)
                found = true
                break
              }
            }
            if (!found) {
              // Si no hay más disponibles, usar el de su índice de todas formas
              player.playerId = allPlayerIds[index]
              console.warn(`⚠️ PlayerId ${allPlayerIds[index]} was already used, but assigning it anyway to "${player.phase1?.name}"`)
            }
        }
      } else {
          // Si hay más jugadores que IDs, generar uno
          const fallbackId = `generated-player-${index}`
          player.playerId = fallbackId
          console.warn(`⚠️ No more playerIds available, using generated ID for "${player.phase1?.name}": ${fallbackId}`)
        }
      }
    })
    
    // Verificar que todos tengan playerId
    const playersWithoutId = allPlayers.filter((p: any) => !p.playerId || p.playerId === 'undefined')
    if (playersWithoutId.length > 0) {
      console.error(`❌ Error: ${playersWithoutId.length} players still without playerId`)
      playersWithoutId.forEach((p: any, idx: number) => {
        const fallbackId = `fallback-${idx}`
        p.playerId = fallbackId
        console.error(`   Assigned fallback ID to player: ${p.phase1?.name || 'Unknown'} → ${fallbackId}`)
      })
    }

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
        return score
      }

      allPlayers.forEach((gen) => {
        const playerGender = gen.phase1?.gender
        const remaining = selectedSuspects.filter(s => !usedIds.has(s.id))
        
        // 🚨 CRÍTICO: PRIMERO filtrar por género - solo considerar sospechosos con el mismo género
        let genderFiltered = remaining
        if (playerGender && playerGender !== 'unknown') {
          genderFiltered = remaining.filter(s => s.gender === playerGender)
          console.log(`🔍 Filtering suspects for "${gen.phase1?.name}" (gender: ${playerGender}): ${genderFiltered.length} matches out of ${remaining.length}`)
        }
        
        // Si no hay coincidencias de género, usar todos los disponibles (fallback)
        const candidates = genderFiltered.length > 0 ? genderFiltered : remaining
        
        let best = null as any
        let bestScore = -1
        
        candidates.forEach((orig) => {
          if (usedIds.has(orig.id)) return
          const s = scoreMatch(gen, orig)
          if (s > bestScore) {
            best = orig
            bestScore = s
          }
        })

        // Si aún no hay match, tomar el primero disponible del género correcto
        if (!best && genderFiltered.length > 0) {
          best = genderFiltered.find(o => !usedIds.has(o.id)) || null
        }
        
        // Último fallback: cualquier sospechoso disponible
        if (!best) {
          best = remaining.find(o => !usedIds.has(o.id)) || null
        }

        if (best?.id) usedIds.add(best.id)

        if (best?.image_url) {
          const occupationName = language === 'es' ? best.occupation?.es : best.occupation?.en
          const genderMatch = best.gender === playerGender ? '✅' : '⚠️'
          console.log(`${genderMatch} Matched "${gen.phase1?.name}" (${playerGender}) → ${occupationName} (${best.gender})`)
          
          // 🚨 ADVERTENCIA si el género no coincide
          if (playerGender && playerGender !== 'unknown' && best.gender !== playerGender) {
            console.warn(`⚠️ WARNING: Gender mismatch for "${gen.phase1?.name}": player is ${playerGender} but suspect is ${best.gender}`)
          }
          
          gen.photo = best.image_url
        }
      })
    }


    // ============================================
    // PASO 3: Generar hiddenContext
    // ============================================
    // Asegurar que el killer tenga playerId ANTES de generar hiddenContext
    const killerPlayerForContext = allPlayers.find((p: any) => p.phase4?.isKiller === true)
    if (!killerPlayerForContext) {
      throw new Error('Could not find killer player before generating hiddenContext')
    }
    
    // Si el killer no tiene playerId, asignarlo
    if (!killerPlayerForContext.playerId || killerPlayerForContext.playerId === 'undefined') {
      killerPlayerForContext.playerId = killerPlayerId
      console.log(`✅ Assigned killerPlayerId to killer before hiddenContext: ${killerPlayerId}`)
    }
    
    const killerIdForContext = killerPlayerForContext.playerId || killerPlayerId
    console.log(`✅ Using killerId for hiddenContext: ${killerIdForContext}`)
    
    const hiddenContext = await generatePhasesHiddenContext(
      body,
      language,
      randomKillerIndex,
      killerIdForContext,
      allPlayers
    )
    // Asegurar que killerId esté correcto
    hiddenContext.killerId = killerIdForContext
    console.log('✅ Paso 3 completado: HiddenContext generado')

    // Preservar URL del arma
    if (selectedWeapon && caseCore.weapon) {
      console.log(`✅ Assigning weapon photo: ${selectedWeapon.image_url}`)
      caseCore.weapon.photo = selectedWeapon.image_url
    }

    // Asegurar que el killerId esté correctamente asignado
    const killerPlayer = allPlayers.find((p: any) => p.phase4?.isKiller === true)
    
    if (!killerPlayer) {
      throw new Error('Could not find killer player in generated players')
    }
    
    // El killerPlayerId ya está en allPlayerIds[randomKillerIndex]
    // Asegurar que el killer tenga el playerId correcto
    if (!killerPlayer.playerId || killerPlayer.playerId === 'undefined') {
      killerPlayer.playerId = killerPlayerId
      console.log(`✅ Assigned killerPlayerId to killer: ${killerPlayerId}`)
    }
    
    const finalKillerId = killerPlayer.playerId || killerPlayerId
    
    if (!finalKillerId || finalKillerId === 'undefined') {
      throw new Error(`Could not determine killer playerId. randomKillerIndex: ${randomKillerIndex}, allPlayerIds.length: ${allPlayerIds.length}, killerPlayerId: ${killerPlayerId}, killerPlayer.playerId: ${killerPlayer?.playerId}`)
    }

    // Construir respuesta
    const response: ImpostorPhasesResponse = {
      caseTitle: caseCore.caseTitle,
      caseDescription: caseCore.caseDescription,
      victim: caseCore.victim,
      players: allPlayers,
      weapon: caseCore.weapon,
      hiddenContext: {
        ...hiddenContext,
        killerId: finalKillerId, // Asegurar que siempre tenga un valor
      },
      config: {
      caseType: body.caseType,
      totalClues: body.clues,
      scenario: body.customScenario 
        ? buildCustomScenarioText(body.customScenario)
        : (body.scenario || 'aleatorio'),
      customScenario: body.customScenario || undefined,
      difficulty: body.difficulty,
      },
    }
    
    // Log final para verificación
    console.log(`✅ Killer playerId final: ${finalKillerId}`)
    console.log(`✅ Killer player name: ${killerPlayer?.phase1?.name || 'Unknown'}`)
    console.log(`✅ Killer player index: ${randomKillerIndex + 1}`)

    console.log('✅ Impostor phases generated successfully (MULTI-STEP)')
    console.log(`   Killer: ${killerPlayerId}`)
    console.log(`   Players: ${allPlayers.length}`)

    return res.json(response)
    
  } catch (error) {
    console.error('Error in generate-impostor-phases API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return res.status(500).json({ 
      error: 'Failed to generate impostor phases',
      details: errorMessage,
    })
  }
}
