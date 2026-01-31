import { Router, Request, Response } from 'express';
import { SuspectService } from '../services/suspect-service.js';
import { WeaponService } from '../services/weapon-service.js';
import { getSupabase } from '../services/supabase.js';
import OpenAI from 'openai';
import { CustomScenario, CustomVictim, buildCustomScenarioText } from './generate-initial-case.js';

// Lazy initialization - solo crea el cliente cuando se necesite
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not defined');
  }

  openaiClient = new OpenAI({
    apiKey: apiKey,
  });
  
  return openaiClient;
}

const router = Router();

export interface ImpostorCaseGenerationRequest {
  caseType: string;
  suspects: number;
  clues: number;
  scenario?: string; // Opcional: escenario fijo (mansion, hotel, etc.)
  customScenario?: CustomScenario; // Opcional: escenario personalizado con lugar y tema/situación
  /**
   * Contexto narrativo libre provisto por el usuario para "anclar" el caso.
   * Si se provee, el caso DEBE construirse coherentemente alrededor de este texto
   * y NO debe contradecirlo. Se permite expandir detalles, pero no cambiar el canon.
   */
  customContext?: string;
  /** Detalles opcionales de la víctima. Los campos definidos son CANON. */
  customVictim?: CustomVictim;
  difficulty: string;
  style?: 'realistic' | 'pixel';
  language?: string;
  playerNames?: string[];
  playerGenders?: string[];
}

export interface ImpostorCaseResponse {
  id?: string;
  caseTitle: string;
  caseDescription: string;
  victim: {
    name: string;
    age: number;
    role: string;
    description: string;
    gender?: string;
    causeOfDeath?: string;
    timeOfDeath?: string;
    timeOfDiscovery?: string;
    discoveredBy?: string;
    location?: string;
    bodyPosition?: string;
    visibleInjuries?: string;
    objectsAtScene?: string;
    signsOfStruggle?: string;
  };
  players: Array<{
    id: string;
    name: string;
    age: number;
    role: string;
    description: string;
    isKiller: boolean;
    alibi: string;
    location: string;
    whereWas: string;
    whatDid: string;
    suspiciousBehavior?: string;
    whySuspicious: string;
    additionalContext?: string;
    photo: string;
    traits: string[];
    gender?: string;
  }>;
  weapon?: {
    id: string;
    name: string;
    description: string;
    location: string;
    photo: string;
    importance: 'high';
  };
  hiddenContext: {
    killerId: string;
    killerReason: string;
    keyClues: string[];
    killerTraits: string[];
  };
  config: {
    caseType: string;
    totalClues: number;
    scenario: string;
    customScenario?: CustomScenario;
    customContext?: string;
    customVictim?: CustomVictim;
    difficulty: string;
  };
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
 * PASO 1: Generar core del caso impostor (caseTitle, caseDescription, victim, weapon)
 */
async function generateImpostorCaseCore(
  request: ImpostorCaseGenerationRequest,
  selectedSuspects: any[],
  selectedWeapon: any,
  language: string,
  discoveredByPlayerIndex: number
): Promise<{ caseTitle: string; caseDescription: string; victim: any; weapon?: any }> {
  const openai = getOpenAIClient()
  
  // Determinar el escenario a usar
  const hasCustomContext = Boolean(request.customContext && request.customContext.trim().length > 0)
  const scenarioText = hasCustomContext
    ? `Escenario: DEFINIDO POR EL CONTEXTO PERSONALIZADO DEL USUARIO`
    : request.customScenario 
      ? `Escenario personalizado: ${buildCustomScenarioText(request.customScenario)}`
      : `Escenario: ${request.scenario || 'aleatorio'}`

  const customScenarioDetails = !hasCustomContext && request.customScenario
    ? `\n**CONTEXTO DEL ESCENARIO PERSONALIZADO:**
- Lugar: ${request.customScenario.place}
${request.customScenario.themeOrSituation ? `- Tema/Situación: ${request.customScenario.themeOrSituation}` : ''}

Debes crear un caso que se ajuste perfectamente a este escenario personalizado. Usa tu creatividad para adaptar todos los elementos (víctima, ubicación, detalles) a este contexto específico.`
    : ''

  const customContextDetails =
    request.customContext && request.customContext.trim().length > 0
      ? `\n**CONTEXTO PERSONALIZADO DEL USUARIO (PRIORIDAD ABSOLUTA):**
${request.customContext.trim()}

REGLAS:
- Este texto es CANON. NO lo contradigas.
- Debes basar la escena del crimen, víctima, pistas y tono en este contexto.
- Puedes agregar detalles y conectar elementos, pero sin cambiar hechos explícitos del texto.`
      : ''

  const customVictimDetails = (() => {
    const v = request.customVictim
    if (!v || (Object.keys(v).length === 0)) return ''
    const lines: string[] = []
    if (v.name != null && String(v.name).trim()) lines.push(`- **Nombre**: ${String(v.name).trim()}`)
    if (v.gender != null && String(v.gender).trim()) lines.push(`- **Género**: ${String(v.gender).trim()}`)
    if (v.age != null && Number(v.age) >= 0) lines.push(`- **Edad**: ${Number(v.age)}`)
    if (v.role != null && String(v.role).trim()) lines.push(`- **Rol/Profesión**: ${String(v.role).trim()}`)
    if (v.description != null && String(v.description).trim()) lines.push(`- **Descripción**: ${String(v.description).trim()}`)
    if (v.notableTrait != null && String(v.notableTrait).trim()) lines.push(`- **Detalle notable** (integrar en la trama): ${String(v.notableTrait).trim()}`)
    if (lines.length === 0) return ''
    return `\n**VÍCTIMA PERSONALIZADA (PRIORIDAD - USA EXACTAMENTE ESTOS DATOS):**
${lines.join('\n')}

La víctima generada DEBE usar estos valores en los campos indicados. No los cambies. Puedes completar el resto (causeOfDeath, location, bodyPosition, etc.) de forma coherente.`
  })()

  const prompt = `
Genera SOLO el core de un caso de misterio tipo "IMPOSTOR" (como Among Us) con la siguiente configuración:

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
- Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
- Quien descubrió el cuerpo: player-${discoveredByPlayerIndex}
${customScenarioDetails}
${customContextDetails}
${customVictimDetails}

${selectedWeapon ? `**ARMA HOMICIDA:**
- Nombre: ${language === 'es' ? selectedWeapon.name.es : selectedWeapon.name.en}
- URL de imagen: ${selectedWeapon.image_url}
` : ''}

**VÍCTIMA - DETALLES COMPLETOS OBLIGATORIOS:**
Crea una víctima con TODOS estos campos (NO OMITIR NINGUNO):
- Nombre, edad, rol/profesión
- Descripción BREVE de su personalidad (1-2 oraciones máximo)
${request.caseType === 'asesinato' ? `- **causeOfDeath**: Causa de muerte específica y detallada (relacionada con el arma: ${language === 'es' ? selectedWeapon?.name.es : selectedWeapon?.name.en || 'arma genérica'})` : ''}
- **timeOfDeath**: Hora de muerte estimada
- **discoveredBy**: DEBE ser "player-${discoveredByPlayerIndex}" CON LA HORA (ej: "player-${discoveredByPlayerIndex}, la sumeller a las 11:00pm")
- **location**: Ubicación exacta y detallada
- **bodyPosition**: Descripción detallada de la posición del cuerpo
- **visibleInjuries**: Heridas visibles específicas
- **objectsAtScene**: Objetos específicos encontrados en la escena
- **signsOfStruggle**: Señales de lucha detalladas

**FORMATO JSON ESPERADO:**
{
  "caseTitle": "Título del caso",
  "caseDescription": "Descripción breve del contexto del caso",
  "victim": {
    "name": "Nombre",
    "age": 45,
    "role": "Profesión",
    "description": "Descripción breve de personalidad (1-2 oraciones)",
    ${request.caseType === 'asesinato' ? `"causeOfDeath": "Causa específica",` : ''}
    "timeOfDeath": "Entre 9:45pm y 10:15pm",
    "discoveredBy": "player-${discoveredByPlayerIndex}, la sumeller a las 11:00pm",
    "location": "Ubicación exacta",
    "bodyPosition": "Descripción de la posición",
    "visibleInjuries": "Heridas visibles",
    "objectsAtScene": "Objetos encontrados",
    "signsOfStruggle": "Señales de lucha"
  }${selectedWeapon ? `,
  "weapon": {
    "id": "weapon-1",
    "name": "${language === 'es' ? selectedWeapon.name.es : selectedWeapon.name.en}",
    "description": "Descripción detallada del arma",
    "location": "Donde se encontró",
    "photo": "${selectedWeapon.image_url}",
    "importance": "high"
  }` : ''}
}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`

  console.log('🤖 Paso 1: Generando core del caso impostor...')
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Crea casos de misterio tipo impostor. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Responde SOLO JSON válido.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  console.log('✅ Core generado, parseando...')
  return parseAndRepairJSON(response)
}

/**
 * PASO 2: Generar jugadores en batches
 */
async function generatePlayersBatch(
  request: ImpostorCaseGenerationRequest,
  selectedSuspects: any[],
  language: string,
  randomKillerIndex: number,
  playerNames: string[],
  playerGenders: string[],
  discoveredByPlayerIndex: number,
  existingPlayers: any[],
  batchStart: number,
  batchSize: number
): Promise<any[]> {
  const openai = getOpenAIClient()
  
  const batchEnd = Math.min(batchStart + batchSize, request.suspects)
  const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i + 1)
  
  console.log(`🤖 Paso 2: Generando jugadores ${batchStart + 1}-${batchEnd} de ${request.suspects}...`)
  
  const batchSupabaseSuspects = selectedSuspects.slice(batchStart, batchEnd)
  
  const suspectsInfo = batchSupabaseSuspects.map((s, i) => `
- Player ${batchStart + i + 1} (player-${batchStart + i + 1}):
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
      return `- Player ${idx}: ${name} (${gender === 'male' ? 'hombre' : gender === 'female' ? 'mujer' : 'desconocido'})`
    }).join('\n')}\n\nUsa estos nombres EXACTOS para los jugadores en el orden proporcionado.`
    : '\n**NOMBRES:** Genera nombres apropiados para todos los jugadores basándote en el género y ocupación de cada uno.\n'
  
  const gendersInfo = playerGenders.length > 0 && batchStart < playerGenders.length
    ? `\n**GÉNEROS DE JUGADORES PROPORCIONADOS PARA ESTE BATCH:**
${batchIndices.map((idx, i) => {
      const genderIdx = batchStart + i
      return `- Player ${idx}: ${playerGenders[genderIdx]}`
    }).join('\n')}\n\nUsa estos géneros EXACTOS para los jugadores en el orden proporcionado.\n`
    : '\n**GÉNEROS:** Asigna géneros apropiados a todos los jugadores basándote en la ocupación y otros factores.\n'

  const previousPlayersContext = existingPlayers.length > 0
    ? `\n**JUGADORES YA GENERADOS (CONTEXTO):**
${existingPlayers.map(p => `- ${p.name} (${p.role}): ${p.description || 'Sin descripción'}`).join('\n')}
\n**IMPORTANTE:** Los nuevos jugadores deben tener conocimiento de estos jugadores anteriores y sus relaciones con ellos. Si hubo conversaciones o encuentros, deben estar documentados en ambos jugadores.`
    : ''

  // Determinar el escenario a usar
  const hasCustomContext = Boolean(request.customContext && request.customContext.trim().length > 0)
  const scenarioText = hasCustomContext
    ? `Escenario: DEFINIDO POR EL CONTEXTO PERSONALIZADO DEL USUARIO`
    : request.customScenario 
      ? `Escenario personalizado: ${buildCustomScenarioText(request.customScenario)}`
      : `Escenario: ${request.scenario || 'aleatorio'}`

  const customScenarioDetails = !hasCustomContext && request.customScenario
    ? `\n**CONTEXTO DEL ESCENARIO PERSONALIZADO:**
- Lugar: ${request.customScenario.place}
${request.customScenario.themeOrSituation ? `- Tema/Situación: ${request.customScenario.themeOrSituation}` : ''}

Los jugadores deben tener roles y ocupaciones que tengan sentido en este escenario personalizado. Adapta sus profesiones, motivos y relaciones al contexto específico proporcionado.`
    : ''

  const customContextDetails =
    request.customContext && request.customContext.trim().length > 0
      ? `\n**CONTEXTO PERSONALIZADO DEL USUARIO (PRIORIDAD ABSOLUTA):**
${request.customContext.trim()}

REGLAS:
- Este texto es CANON. NO lo contradigas.
- Los jugadores deben encajar naturalmente en este contexto (roles, oportunidades, relaciones).
- Puedes expandir con detalles coherentes, sin inventar hechos que contradigan el texto.`
      : ''

  const prompt = `
Genera EXACTAMENTE ${batchSize} jugadores para un caso de misterio tipo "IMPOSTOR" (como Among Us).

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
- Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
- Total de jugadores en el caso: ${request.suspects}
- Jugadores a generar en este batch: ${batchStart + 1} a ${batchEnd} (player-${batchStart + 1} a player-${batchEnd})
- Quien descubrió el cuerpo: player-${discoveredByPlayerIndex}
${batchIndices.includes(discoveredByPlayerIndex) ? `- ⚠️ **UN JUGADOR DE ESTE BATCH (player-${discoveredByPlayerIndex}) DESCUBRIÓ EL CUERPO**` : ''}
${customScenarioDetails}
${customContextDetails}

**JUGADORES DE SUPABASE PARA ESTE BATCH:**
${suspectsInfo}
${namesInfo}
${gendersInfo}
${previousPlayersContext}

**CRÍTICO - LEER ATENTAMENTE:**
- 🚨 **NÚMERO DE JUGADORES - OBLIGATORIO: DEBES generar EXACTAMENTE ${batchSize} jugadores en el array "players".**
- 🚨 **LISTA OBLIGATORIA DE IDs DE JUGADORES QUE DEBES GENERAR:**
${batchIndices.map(idx => `  ${idx}. player-${idx}`).join('\n')}
- 🚨 **El array "players" DEBE contener EXACTAMENTE estos ${batchSize} elementos con estos IDs. NO omitas ninguno.**
${batchIndices.includes(randomKillerIndex) ? `- ⚠️ **EL ASESINO OBLIGATORIAMENTE ES: player-${randomKillerIndex} (está en este batch)**` : '- ⚠️ **El asesino NO está en este batch, todos deben tener isKiller: false.**'}
${batchIndices.includes(discoveredByPlayerIndex) ? `- ⚠️ **QUIEN DESCUBRIÓ EL CUERPO ES: player-${discoveredByPlayerIndex} (está en este batch)**` : ''}

**REGLAS PARA JUGADORES - PRIMERA PERSONA:**
1. Usa EXACTAMENTE los géneros, edades y ocupaciones proporcionados
2. ${playerNames.length > 0 && batchStart < playerNames.length ? 'Usa los nombres proporcionados cuando estén disponibles' : 'Genera nombres que coincidan con el género'}
3. Usa EXACTAMENTE las URLs de imagen proporcionadas como campo "photo"
4. **IMPORTANTE: TODA LA INFORMACIÓN DEBE ESTAR EN PRIMERA PERSONA**
5. Cada jugador debe tener:
   - **isKiller**: true para UNO SOLO si está en este batch y es player-${randomKillerIndex}, false para todos los demás
   - **description**: Descripción EN PRIMERA PERSONA
   - **alibi**: Coartada COMPLETA EN PRIMERA PERSONA con HORAS ESPECÍFICAS (FALSA si es el asesino, VERDADERA si es inocente)
   - **whySuspicious**: Motivo REAL, CREÍBLE y ESPECÍFICO EN PRIMERA PERSONA
   - **additionalContext**: Contexto MUY DETALLADO EN PRIMERA PERSONA con TÍTULOS DE SECCIÓN y doble salto de línea entre secciones
   ${batchIndices.includes(discoveredByPlayerIndex) ? `- Si es player-${discoveredByPlayerIndex}, debe incluir en additionalContext información sobre cómo descubrió el cuerpo` : ''}

**FORMATO JSON ESPERADO:**
{
  "players": [
    ${batchIndices.map((idx, i) => `{
      "id": "player-${idx}",
      "name": "${playerNames[batchStart + i] || 'Nombre generado apropiado'}",
      "age": 35,
      "role": "Ocupación exacta de Supabase",
      "description": "Descripción EN PRIMERA PERSONA",
      "isKiller": ${idx === randomKillerIndex ? 'true' : 'false'},
      "alibi": "Coartada COMPLETA EN PRIMERA PERSONA con HORAS ESPECÍFICAS",
      "location": "Versión resumida (DEPRECADO)",
      "whereWas": "Versión resumida (DEPRECADO)",
      "whatDid": "Versión resumida (DEPRECADO)",
      "whySuspicious": "Motivo REAL y CREÍBLE EN PRIMERA PERSONA",
      "additionalContext": "Contexto MUY DETALLADO con TÍTULOS DE SECCIÓN y doble salto de línea",
      "photo": "URL de Supabase",
      "traits": ["trait1", "trait2", "trait3"],
      "gender": "${playerGenders[batchStart + i] || 'male/female'}"
    }`).join(',\n    ')}
  ]
}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Crea jugadores para casos de misterio tipo impostor. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Responde SOLO JSON válido.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: Math.min(4000, 1000 + (batchSize * 500)),
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
 * PASO 3: Generar hiddenContext
 */
async function generateImpostorHiddenContext(
  request: ImpostorCaseGenerationRequest,
  language: string,
  randomKillerIndex: number,
  allPlayers: any[]
): Promise<any> {
  const openai = getOpenAIClient()
  
  const killerPlayer = allPlayers.find(p => p.id === `player-${randomKillerIndex}`)
  
  // Determinar el escenario a usar
  const hasCustomContext = Boolean(request.customContext && request.customContext.trim().length > 0)
  const scenarioText = hasCustomContext
    ? `Escenario: DEFINIDO POR EL CONTEXTO PERSONALIZADO DEL USUARIO`
    : request.customScenario 
      ? `Escenario personalizado: ${buildCustomScenarioText(request.customScenario)}`
      : `Escenario: ${request.scenario || 'aleatorio'}`

  const customScenarioDetails = !hasCustomContext && request.customScenario
    ? `\n**CONTEXTO DEL ESCENARIO PERSONALIZADO:**
- Lugar: ${request.customScenario.place}
${request.customScenario.themeOrSituation ? `- Tema/Situación: ${request.customScenario.themeOrSituation}` : ''}

Las pistas clave y razones del asesino deben estar relacionadas con este escenario personalizado.`
    : ''

  const customContextDetails =
    request.customContext && request.customContext.trim().length > 0
      ? `\n**CONTEXTO PERSONALIZADO DEL USUARIO (PRIORIDAD ABSOLUTA):**
${request.customContext.trim()}

REGLAS:
- Este texto es CANON. NO lo contradigas.
- El killerReason y las keyClues deben estar conectados a detalles del contexto (objetos, horarios, restricciones, etc.).
- Puedes inferir y expandir, pero no cambiar hechos explícitos del texto.`
      : ''

  const prompt = `
Genera el contexto oculto (hiddenContext) para un caso de misterio tipo impostor.

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
- Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
- Asesino: player-${randomKillerIndex} (${killerPlayer?.name || 'Nombre del asesino'})
${customScenarioDetails}
${customContextDetails}

**JUGADORES:**
${allPlayers.map(p => `- ${p.name} (${p.id}): ${p.role} - ${p.isKiller ? 'ASESINO' : 'INOCENTE'}`).join('\n')}

**FORMATO JSON ESPERADO:**
{
  "hiddenContext": {
    "killerId": "player-${randomKillerIndex}",
    "killerReason": "Razón detallada de por qué player-${randomKillerIndex} es el asesino (2-3 oraciones)",
    "keyClues": ["pista1 que conecta con player-${randomKillerIndex}", "pista2 que conecta con player-${randomKillerIndex}", "pista3 sutil"],
    "killerTraits": ["trait que conecta con el crimen", "trait que da una pista sutil"]
  }
}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`

  console.log('🤖 Paso 3: Generando hiddenContext...')
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Crea contexto oculto para casos de misterio tipo impostor. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Responde SOLO JSON válido.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  console.log('✅ HiddenContext generado, parseando...')
  const parsed = parseAndRepairJSON(response)
  return parsed.hiddenContext
}

/**
 * Guardar caso impostor en Supabase (tabla cases y relacionadas, mode = impostor)
 */
async function saveImpostorCaseToSupabase(
  caseCore: any,
  players: any[],
  hiddenContext: any,
  request: ImpostorCaseGenerationRequest,
  randomKillerIndex: number
): Promise<void> {
  const supabase = getSupabase()
  const scenarioValue = request.customScenario
    ? buildCustomScenarioText(request.customScenario)
    : (request.scenario || null)
  const caseInsert: any = {
    case_title: caseCore.caseTitle,
    case_description: caseCore.caseDescription,
    case_type: request.caseType,
    scenario: scenarioValue,
    difficulty: request.difficulty,
    style: request.style || 'realistic',
    language: request.language || 'es',
    suspects_count: request.suspects,
    clues_count: request.clues,
    mode: 'impostor',
  }
  if (request.customScenario) caseInsert.custom_scenario = JSON.stringify(request.customScenario)
  if (request.customContext?.trim()) caseInsert.custom_context = request.customContext.trim()
  if (request.customVictim && Object.keys(request.customVictim).length > 0) caseInsert.custom_victim = request.customVictim

  const { data: caseData, error: caseError } = await supabase.from('cases').insert(caseInsert).select().single()
  if (caseError) throw new Error(`Error saving case: ${caseError.message}`)
  const caseId = caseData.id

  const victim = caseCore.victim
  const { error: victimError } = await supabase.from('case_victims').insert({
    case_id: caseId,
    name: victim.name,
    age: victim.age,
    role: victim.role,
    description: victim.description,
    cause_of_death: victim.causeOfDeath,
    time_of_death: victim.timeOfDeath,
    discovered_by: victim.discoveredBy,
    location: victim.location,
    body_position: victim.bodyPosition,
    visible_injuries: victim.visibleInjuries,
    objects_at_scene: victim.objectsAtScene,
    signs_of_struggle: victim.signsOfStruggle,
  })
  if (victimError) throw new Error(`Error saving victim: ${victimError.message}`)

  const killerIdStr = `player-${randomKillerIndex}`
  const suspectsToInsert = players.map((s) => ({
    case_id: caseId,
    suspect_key: s.id,
    name: s.name,
    age: s.age ?? null,
    role: s.role,
    gender: s.gender ?? null,
    description: s.description ?? null,
    motive: null,
    alibi: s.alibi ?? null,
    time_gap: null,
    suspicious: true,
    photo: s.photo ?? null,
    traits: s.traits ?? null,
    last_seen: s.whereWas ?? s.location ?? null,
    relationship_to_victim: null,
    is_guilty: s.id === killerIdStr,
  }))
  const { error: suspectsError } = await supabase.from('case_suspects').insert(suspectsToInsert)
  if (suspectsError) throw new Error(`Error saving suspects: ${suspectsError.message}`)

  if (hiddenContext) {
    const { error: hiddenError } = await supabase.from('case_hidden_context').insert({
      case_id: caseId,
      guilty_suspect_key: hiddenContext.killerId,
      guilty_reason: hiddenContext.killerReason,
      key_clues: hiddenContext.keyClues || [],
      guilty_traits: hiddenContext.killerTraits || [],
    })
    if (hiddenError) console.warn('⚠️ case_hidden_context:', hiddenError.message)
  }

  if (caseCore.weapon) {
    const w = caseCore.weapon
    const { error: weaponError } = await supabase.from('case_weapons').insert({
      case_id: caseId,
      weapon_key: w.id || 'weapon-1',
      name: typeof w.name === 'string' ? w.name : (w.name?.es || w.name?.en || ''),
      description: w.description,
      location: w.location,
      photo: w.photo,
      importance: w.importance || 'high',
    })
    if (weaponError) console.warn('⚠️ case_weapons:', weaponError.message)
  }
}

router.post('/api/generate-impostor-case', async (req: Request, res: Response) => {
  try {
    console.log('API Route: generate-impostor-case called (MULTI-STEP)');
    
    const body: ImpostorCaseGenerationRequest = req.body;
    console.log('Request body:', body);
    
    // Validate required fields
    if (!body.caseType || !body.suspects || !body.clues || !body.difficulty) {
      return res.status(400).json({ error: 'Missing required fields: caseType, suspects, clues, difficulty' });
    }

    const hasCustomContext = Boolean(body.customContext && body.customContext.trim().length > 0)

    // Validar que solo haya scenario o customScenario (si NO hay customContext)
    if (!hasCustomContext && body.scenario && body.customScenario) {
      return res.status(400).json({ error: 'Cannot provide both scenario and customScenario. Provide only one.' });
    }

    // Si hay customContext, puede venir sin scenario/customScenario
    if (!hasCustomContext && !body.scenario && !body.customScenario) {
      return res.status(400).json({ error: 'Must provide either scenario, customScenario, or customContext' });
    }

    const { language = 'es', playerNames: rawPlayerNames = [], playerGenders: rawPlayerGenders = [] } = body;

    // Normalizar playerNames
    const playerNames: string[] = rawPlayerNames.map((item: any) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && item.name) return item.name
      return String(item || '')
    });

    // Normalizar playerGenders
    const playerGenders: string[] = rawPlayerGenders.length > 0 
      ? rawPlayerGenders.map((item: any) => typeof item === 'string' ? item : String(item || ''))
      : rawPlayerNames.map((item: any) => {
          if (item && typeof item === 'object' && item.gender) {
            return item.gender;
          }
          return '';
        }).filter(g => g);

    // Obtener sospechosos reales desde Supabase
    // Si hay customScenario o customContext, no pasar scene (obtendrá aleatorios)
    const sceneForService = (hasCustomContext || body.customScenario) ? undefined : body.scenario;
    
    console.log(`🔍 Fetching ${body.suspects} suspects from Supabase...`);
    if (hasCustomContext) {
      console.log(`📝 Custom context detected - fetching random suspects`);
    } else if (body.customScenario) {
      console.log(`🎨 Custom scenario detected: "${buildCustomScenarioText(body.customScenario)}" - fetching random suspects`);
      console.log(`   Place: ${body.customScenario.place}`);
      if (body.customScenario.themeOrSituation) {
        console.log(`   Theme/Situation: ${body.customScenario.themeOrSituation}`);
      }
    } else {
      console.log(`📍 Fixed scenario: ${body.scenario}`);
    }
    if (playerGenders.length > 0) {
      console.log(`👥 Player genders provided: ${playerGenders.join(', ')}`);
    }
    
    const selectedSuspects = await SuspectService.getSuspectsForScene({
      count: body.suspects,
      scene: sceneForService,
      style: body.style,
      preferredGenders: playerGenders.length > 0 ? playerGenders : undefined,
    });
    
    console.log(`✅ Found ${selectedSuspects.length} suspects from Supabase`);

    // Seleccionar arma para casos de asesinato
    // Si hay customScenario o customContext, no pasar scene (obtendrá aleatoria)
    let selectedWeapon = null;
    if (body.caseType === 'asesinato') {
      console.log(`🔫 Selecting murder weapon...`);
      selectedWeapon = await WeaponService.selectWeapon({
        scene: sceneForService,
        style: body.style,
        preferSpecific: !(hasCustomContext || body.customScenario), // No preferir específica si es custom
      });
      console.log(`✅ Selected weapon: ${selectedWeapon?.name?.es}`);
    }

    // Generar número aleatorio para el asesino
    const randomKillerIndex = Math.floor(Math.random() * body.suspects) + 1;
    console.log(`🎲 Random killer suggestion: player-${randomKillerIndex}`);
    
    // Decidir quién descubrió el cuerpo
    const discoveredByIsKiller = Math.random() < 0.3;
    const discoveredByPlayerIndex = discoveredByIsKiller 
      ? randomKillerIndex 
      : Math.floor(Math.random() * body.suspects) + 1;
    console.log(`🔍 Body discovered by: player-${discoveredByPlayerIndex} (${discoveredByIsKiller ? 'ASESINO' : 'INOCENTE'})`);

    // ============================================
    // PASO 1: Generar core del caso
    // ============================================
    const caseCore = await generateImpostorCaseCore(
      body,
      selectedSuspects,
      selectedWeapon,
      language,
      discoveredByPlayerIndex
    )
    console.log('✅ Paso 1 completado: Core del caso generado')

    // Aplicar customVictim sobre la víctima generada (prioridad al input del usuario)
    if (body.customVictim && caseCore.victim) {
      const v = body.customVictim
      if (v.name != null && String(v.name).trim()) caseCore.victim.name = String(v.name).trim()
      if (v.gender != null && String(v.gender).trim()) caseCore.victim.gender = String(v.gender).trim()
      if (v.age != null && Number(v.age) >= 0) caseCore.victim.age = Number(v.age)
      if (v.role != null && String(v.role).trim()) caseCore.victim.role = String(v.role).trim()
      if (v.description != null && String(v.description).trim()) caseCore.victim.description = String(v.description).trim()
    }

    // ============================================
    // PASO 2: Generar jugadores en batches
    // ============================================
    const BATCH_SIZE = 3 // Generar 3 jugadores a la vez
    const allPlayers: any[] = []
    
    for (let batchStart = 0; batchStart < body.suspects; batchStart += BATCH_SIZE) {
      const batch = await generatePlayersBatch(
        body,
        selectedSuspects,
        language,
        randomKillerIndex,
        playerNames,
        playerGenders,
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

    // Aplicar nombres de jugadores
    if (allPlayers && playerNames.length > 0) {
      allPlayers.forEach((p, i) => {
        if (playerNames[i]) {
          p.name = playerNames[i]
        }
      })
    }

    // Matching con Supabase
    if (allPlayers && selectedSuspects) {
      console.log('🔧 Matching players to Supabase photos...');
      
      const remaining = [...selectedSuspects];
      const usedIds = new Set<string>();

      function scoreMatch(gen: any, orig: any): number {
        let score = 0;
        const genRole = (gen.role || '').toString().toLowerCase().trim();
        const origOccEs = (orig.occupation?.es || orig.occupation || '').toString().toLowerCase().trim();
        const origOccEn = (orig.occupation?.en || '').toString().toLowerCase().trim();
        
        if (genRole && (genRole === origOccEs || genRole === origOccEn)) score += 5;
        else if (genRole && (origOccEs.includes(genRole) || genRole.includes(origOccEs))) score += 3;

        if (gen.gender && orig.gender && gen.gender === orig.gender) score += 2;

        if (typeof gen.age === 'number' && typeof orig.approx_age === 'number') {
          const diff = Math.abs(gen.age - orig.approx_age);
          if (diff <= 1) score += 2;
          else if (diff <= 3) score += 1;
        }

        return score;
      }

      allPlayers.forEach((gen) => {
        let best = null as any;
        let bestScore = -1;
        
        remaining.forEach((orig) => {
          if (usedIds.has(orig.id)) return;
          const s = scoreMatch(gen, orig);
          if (s > bestScore) {
            best = orig;
            bestScore = s;
          }
        });

        if (!best) {
          best = remaining.find((o) => !usedIds.has(o.id));
        }

        if (best?.id) usedIds.add(best.id);

        if (best?.image_url) {
          console.log(`✅ Matched "${gen.name}" → ${best.occupation?.es}`);
          gen.photo = best.image_url;
        }
      });
    }

    // ============================================
    // PASO 3: Generar hiddenContext
    // ============================================
    const hiddenContext = await generateImpostorHiddenContext(
      body,
      language,
      randomKillerIndex,
      allPlayers
    )
    // Asegurar que killerId esté en el formato correcto
    hiddenContext.killerId = `player-${randomKillerIndex}`
    console.log('✅ Paso 3 completado: HiddenContext generado')

    // Preservar URL del arma
    if (selectedWeapon && caseCore.weapon) {
      console.log(`✅ Assigning weapon photo: ${selectedWeapon.image_url}`);
      caseCore.weapon.photo = selectedWeapon.image_url;
    }

    // Construir respuesta
    const response: ImpostorCaseResponse = {
      caseTitle: caseCore.caseTitle,
      caseDescription: caseCore.caseDescription,
      victim: caseCore.victim,
      players: allPlayers,
      weapon: caseCore.weapon,
      hiddenContext: {
        ...hiddenContext,
        killerId: `player-${randomKillerIndex}`,
      },
      config: {
        caseType: body.caseType,
        totalClues: body.clues,
        scenario: hasCustomContext
          ? 'DEFINIDO POR EL CONTEXTO PERSONALIZADO DEL USUARIO'
          : body.customScenario 
            ? buildCustomScenarioText(body.customScenario)
            : (body.scenario || 'aleatorio'),
        customScenario: body.customScenario || undefined,
        customContext: body.customContext?.trim() || undefined,
        customVictim: body.customVictim || undefined,
        difficulty: body.difficulty,
      },
    };

    console.log('✅ Impostor case generated successfully (MULTI-STEP)');
    console.log(`   Killer: player-${randomKillerIndex}`);
    console.log(`   Players: ${allPlayers.length}`);

    // Guardar caso en tabla cases (mode = impostor)
    await saveImpostorCaseToSupabase(caseCore, allPlayers, hiddenContext, body, randomKillerIndex);

    res.json(response);
    
  } catch (error) {
    console.error('Error in generate-impostor-case API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    res.status(500).json({
      error: 'Failed to generate impostor case',
      details: errorMessage,
    });
  }
});

export default router;
