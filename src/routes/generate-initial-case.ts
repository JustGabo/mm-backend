import { Router, Request, Response } from 'express'
import { SuspectService } from '../services/suspect-service.js'
import { WeaponService } from '../services/weapon-service.js'
import { getSupabase } from '../services/supabase.js'
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

export interface CustomScenario {
  place: string // Lugar del escenario (ej: "jet privado")
  themeOrSituation?: string // Tema o situación opcional (ej: "es un viaje a otro país por motivo a una fiesta de empleados")
}

export function buildCustomScenarioText(customScenario: CustomScenario): string {
  let text = customScenario.place
  if (customScenario.themeOrSituation) {
    text += `. ${customScenario.themeOrSituation}`
  }
  return text
}

export interface InitialCaseGenerationRequest {
  caseType: string
  suspects: number
  clues: number
  scenario?: string // Opcional: escenario fijo (mansion, hotel, etc.)
  customScenario?: CustomScenario // Opcional: escenario personalizado con lugar y tema/situación
  difficulty: string
  style?: 'realistic' | 'pixel'
  language?: string
  playerNames?: string[]
  playerGenders?: string[]
}

export interface InitialCaseResponse {
  id?: string
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
    customScenario?: CustomScenario
    difficulty: string
  }
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
async function generateCaseCore(
  request: InitialCaseGenerationRequest,
  selectedSuspects: any[],
  selectedWeapon: any,
  language: string
): Promise<{ caseTitle: string; caseDescription: string; victim: any; weapon?: any }> {
  const openai = getOpenAIClient()
  
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

  const prompt = `
Genera SOLO el core de un caso de misterio con la siguiente configuración:

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
- Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
${customScenarioDetails}

${selectedWeapon ? `**ARMA HOMICIDA:**
- Nombre: ${language === 'es' ? selectedWeapon.name.es : selectedWeapon.name.en}
- URL de imagen: ${selectedWeapon.image_url}
` : ''}

**VÍCTIMA - DETALLES COMPLETOS OBLIGATORIOS:**
Crea una víctima con TODOS estos campos (NO OMITIR NINGUNO):
- Nombre, edad, rol/profesión
- Descripción BREVE de su personalidad (1-2 oraciones máximo)
${request.caseType === 'asesinato' ? `- **causeOfDeath**: Causa de muerte específica y detallada (relacionada con el arma: ${language === 'es' ? selectedWeapon?.name.es : selectedWeapon?.name.en || 'arma genérica'})` : ''}
- **timeOfDeath**: Hora de muerte estimada (ej: "Entre las 9:45pm y 10:15pm según la temperatura corporal")
- **discoveredBy**: Quién encontró el cuerpo CON LA HORA (ej: "[Nombre], [rol/profesión] a las [hora]")
- **location**: Ubicación exacta y detallada (ej: "En su oficina privada del segundo piso, tirado junto al escritorio")
- **bodyPosition**: Descripción detallada de la posición del cuerpo (ej: "Boca arriba, brazos extendidos, señales de lucha")
- **visibleInjuries**: Heridas visibles específicas (ej: "Tres heridas de arma blanca en el pecho, sangre seca alrededor")
- **objectsAtScene**: Objetos específicos encontrados en la escena (ej: "Un cuchillo ensangrentado a 2 metros, copa volcada, documentos esparcidos")
- **signsOfStruggle**: Señales de lucha detalladas (ej: "Silla volcada, lámpara rota, papeles desordenados")

**FORMATO JSON ESPERADO:**
{
  "caseTitle": "Título del caso",
  "caseDescription": "Descripción breve del caso",
  "victim": {
    "name": "Nombre",
    "age": 45,
    "role": "Profesión",
    "description": "Descripción breve de personalidad (1-2 oraciones)",
    ${request.caseType === 'asesinato' ? `"causeOfDeath": "Causa específica",` : ''}
    "timeOfDeath": "Entre 9:45pm y 10:15pm",
    "discoveredBy": "Sofía, la sumeller a las 11:00pm",
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

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Crea casos de misterio. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Responde SOLO JSON válido.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  return parseAndRepairJSON(response)
}

/**
 * PASO 2: Generar sospechosos en batches
 */
async function generateSuspectsBatch(
  request: InitialCaseGenerationRequest,
  selectedSuspects: any[],
  language: string,
  randomGuiltyIndex: number,
  playerNames: string[],
  playerGenders: string[],
  existingSuspects: any[],
  batchStart: number,
  batchSize: number
): Promise<any[]> {
  const openai = getOpenAIClient()
  
  const batchEnd = Math.min(batchStart + batchSize, request.suspects)
  const batchIndices = Array.from({ length: batchEnd - batchStart }, (_, i) => batchStart + i + 1)
  
  const batchSupabaseSuspects = selectedSuspects.slice(batchStart, batchEnd)
  
  const suspectsInfo = batchSupabaseSuspects.map((s, i) => `
- Suspect ${batchStart + i + 1} (suspect-${batchStart + i + 1}):
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
      return `- Suspect ${idx}: ${name} (${gender === 'male' ? 'hombre' : gender === 'female' ? 'mujer' : 'desconocido'})`
    }).join('\n')}\n\nUsa estos nombres EXACTOS para los sospechosos en el orden proporcionado.`
    : '\n**NOMBRES:** Genera nombres apropiados para todos los sospechosos basándote en el género y ocupación de cada uno.\n'
  
  const gendersInfo = playerGenders.length > 0 && batchStart < playerGenders.length
    ? `\n**GÉNEROS DE JUGADORES PROPORCIONADOS PARA ESTE BATCH:**
${batchIndices.map((idx, i) => {
      const genderIdx = batchStart + i
      return `- Suspect ${idx}: ${playerGenders[genderIdx]}`
    }).join('\n')}\n\nUsa estos géneros EXACTOS para los sospechosos en el orden proporcionado.\n`
    : '\n**GÉNEROS:** Asigna géneros apropiados a todos los sospechosos basándote en la ocupación y otros factores.\n'

  const previousSuspectsContext = existingSuspects.length > 0
    ? `\n**SOSPECHOSOS YA GENERADOS (CONTEXTO):**
${existingSuspects.map(s => `- ${s.name} (${s.role}): ${s.description || 'Sin descripción'}`).join('\n')}
\n**IMPORTANTE:** Los nuevos sospechosos deben tener conocimiento de estos sospechosos anteriores y sus relaciones con ellos.`
    : ''

  // Determinar el escenario a usar
  const scenarioText = request.customScenario 
    ? `Escenario personalizado: ${buildCustomScenarioText(request.customScenario)}`
    : `Escenario: ${request.scenario || 'aleatorio'}`

  const customScenarioDetails = request.customScenario
    ? `\n**CONTEXTO DEL ESCENARIO PERSONALIZADO:**
- Lugar: ${request.customScenario.place}
${request.customScenario.themeOrSituation ? `- Tema/Situación: ${request.customScenario.themeOrSituation}` : ''}

Los sospechosos deben tener roles y ocupaciones que tengan sentido en este escenario personalizado. Adapta sus profesiones, motivos y relaciones al contexto específico proporcionado.`
    : ''

  const prompt = `
Genera EXACTAMENTE ${batchSize} sospechosos para un caso de misterio.

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
- Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
- Total de sospechosos en el caso: ${request.suspects}
- Sospechosos a generar en este batch: ${batchStart + 1} a ${batchEnd} (suspect-${batchStart + 1} a suspect-${batchEnd})
${customScenarioDetails}

**SOSPECHOSOS DE SUPABASE PARA ESTE BATCH:**
${suspectsInfo}
${namesInfo}
${gendersInfo}
${previousSuspectsContext}

**CRÍTICO - LEER ATENTAMENTE:**
- 🚨 **NÚMERO DE SOSPECHOSOS - OBLIGATORIO: DEBES generar EXACTAMENTE ${batchSize} sospechosos en el array "suspects".**
- 🚨 **LISTA OBLIGATORIA DE IDs DE SOSPECHOSOS QUE DEBES GENERAR:**
${batchIndices.map(idx => `  ${idx}. suspect-${idx}`).join('\n')}
- 🚨 **El array "suspects" DEBE contener EXACTAMENTE estos ${batchSize} elementos con estos IDs. NO omitas ninguno.**
${batchIndices.includes(randomGuiltyIndex) ? `- ⚠️ **EL CULPABLE OBLIGATORIAMENTE ES: suspect-${randomGuiltyIndex} (está en este batch)**` : '- ⚠️ **El culpable NO está en este batch, todos deben parecer sospechosos pero ninguno es el culpable real.**'}

**REGLAS PARA SOSPECHOSOS:**
1. Usa EXACTAMENTE los géneros, edades y ocupaciones proporcionados
2. ${playerNames.length > 0 && batchStart < playerNames.length ? 'Usa los nombres proporcionados cuando estén disponibles' : 'Genera nombres que coincidan con el género'}
3. Usa EXACTAMENTE las URLs de imagen proporcionadas como campo "photo"
4. Agrega descripción de personalidad, motivo para el crimen, coartada con huecos
5. **IMPORTANTE:** Todos deben tener "suspicious": true
6. **CRÍTICO - MOTIVOS:**
   - ⚠️ **LONGITUD EQUILIBRADA:** Todos los motivos deben tener aproximadamente la MISMA LONGITUD (mismo número de palabras/oraciones).
   ${batchIndices.includes(randomGuiltyIndex) ? `- El sospechoso suspect-${randomGuiltyIndex} (el culpable) DEBE tener el motivo MÁS FUERTE en términos de CONTENIDO/CONVICCIÓN, no de longitud.` : ''}
   - Los demás deben tener motivos fuertes pero MENOS CONVINCENTES que el del culpable (misma longitud, menos fuerza en el contenido).
   - 🚨 **REGLA CRÍTICA - NO REVELAR CULPABILIDAD:**
     * ❌ NUNCA uses lenguaje que implique acción criminal directa: "decidió eliminar", "llevó a un acto", "cometió el crimen", "realizó el asesinato", "eliminó a", "mató a", etc.
     * ❌ NUNCA uses frases que confirmen que la persona hizo algo: "lo que la llevó a...", "decidió que...", "actuó para...", etc.
     * ✅ USA lenguaje que describa SITUACIONES, CONFLICTOS o SENTIMIENTOS: "tenía resentimiento por", "estaba celoso de", "se sintió traicionado por", "había conflicto con", "guardaba rencor hacia", etc.
     * ✅ Todos los motivos deben ser SUPOSICIONES o EXPLICACIONES DE POR QUÉ PODRÍA ser sospechoso, no confirmaciones de culpabilidad.
     * ✅ El motivo del culpable debe ser más convincente por la PROFUNDIDAD del conflicto o la INTENSIDAD de las emociones, NO por decir que hizo algo.
     * ✅ Ejemplos CORRECTOS: "Gabriel tenía celos de la atención que el actor principal recibía, lo que generaba resentimiento hacia él." / "Clara estaba furiosa porque su guion fue rechazado en favor del de la víctima, sintiéndose profundamente traicionada."
     * ❌ Ejemplos INCORRECTOS: "Clara decidió eliminar a Gabriel" / "lo que la llevó a un acto desesperado" / "decidió eliminar a Gabriel para obtener su puesto"

**FORMATO JSON ESPERADO:**
{
  "suspects": [
    ${batchIndices.map((idx, i) => `{
      "id": "suspect-${idx}",
      "name": "${playerNames[batchStart + i] || 'Nombre generado apropiado'}",
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
        content: `Crea sospechosos para casos de misterio. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Responde SOLO JSON válido.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: Math.min(4000, 1000 + (batchSize * 500)),
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  const parsed = parseAndRepairJSON(response)
  
  if (!parsed.suspects || !Array.isArray(parsed.suspects)) {
    throw new Error('Invalid response structure: missing suspects array')
  }
  
  if (parsed.suspects.length !== batchSize) {
    throw new Error(`AI generated ${parsed.suspects.length} suspects but ${batchSize} were requested for this batch`)
  }
  
  return parsed.suspects
}

/**
 * PASO 3: Generar hiddenContext
 */
async function generateHiddenContext(
  request: InitialCaseGenerationRequest,
  language: string,
  randomGuiltyIndex: number,
  allSuspects: any[]
): Promise<any> {
  const openai = getOpenAIClient()
  
  const guiltySuspect = allSuspects.find(s => s.id === `suspect-${randomGuiltyIndex}`)
  
  // Determinar el escenario a usar
  const scenarioText = request.customScenario 
    ? `Escenario personalizado: ${buildCustomScenarioText(request.customScenario)}`
    : `Escenario: ${request.scenario || 'aleatorio'}`

  const customScenarioDetails = request.customScenario
    ? `\n**CONTEXTO DEL ESCENARIO PERSONALIZADO:**
- Lugar: ${request.customScenario.place}
${request.customScenario.themeOrSituation ? `- Tema/Situación: ${request.customScenario.themeOrSituation}` : ''}

Las pistas clave y razones del culpable deben estar relacionadas con este escenario personalizado.`
    : ''

  const prompt = `
Genera el contexto oculto (hiddenContext) para un caso de misterio.

**CONFIGURACIÓN:**
- Tipo de caso: ${request.caseType}
- ${scenarioText}
- Dificultad: ${request.difficulty}
- Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
- Culpable: suspect-${randomGuiltyIndex} (${guiltySuspect?.name || 'Nombre del culpable'})
${customScenarioDetails}

**SOSPECHOSOS:**
${allSuspects.map(s => `- ${s.name} (${s.id}): ${s.role} - ${s.motive || 'Sin motivo'}`).join('\n')}

**FORMATO JSON ESPERADO:**
{
  "hiddenContext": {
    "guiltyId": "suspect-${randomGuiltyIndex}",
    "guiltyReason": "Razón detallada de por qué suspect-${randomGuiltyIndex} es el culpable (2-3 oraciones)",
    "keyClues": ["pista1 que conecta con suspect-${randomGuiltyIndex}", "pista2 que conecta con suspect-${randomGuiltyIndex}", "pista3 sutil"],
    "guiltyTraits": ["trait que conecta con el crimen", "trait que da una pista sutil"]
  }
}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Crea contexto oculto para casos de misterio. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Responde SOLO JSON válido.`,
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  })

  const response = completion.choices[0]?.message?.content
  if (!response) throw new Error('No response from OpenAI')

  const parsed = parseAndRepairJSON(response)
  return parsed.hiddenContext
}

/**
 * Guardar caso en Supabase
 */
async function saveCaseToSupabase(
  caseCore: any,
  victim: any,
  weapon: any,
  suspects: any[],
  hiddenContext: any,
  request: InitialCaseGenerationRequest
): Promise<string> {
  const supabase = getSupabase()
  
  // 1. Insertar caso
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
    }
  
  // Intentar agregar custom_scenario como JSON si existe la columna (no crítico si falla)
  if (request.customScenario) {
    caseInsert.custom_scenario = JSON.stringify(request.customScenario)
  }

  const { data: caseData, error: caseError } = await supabase
    .from('cases')
    .insert(caseInsert)
    .select()
    .single()
  
  if (caseError) throw new Error(`Error saving case: ${caseError.message}`)
  const caseId = caseData.id
  
  // 2. Insertar víctima
  const { error: victimError } = await supabase
    .from('case_victims')
    .insert({
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
  
  // 3. Insertar sospechosos
  const guiltyIdStr = `suspect-${hiddenContext.guiltyId?.replace('suspect-', '') || hiddenContext.guiltyId || ''}`
  const suspectsToInsert = suspects.map((s) => ({
    case_id: caseId,
    suspect_key: s.id,
    name: s.name,
    age: s.age,
    role: s.role,
    gender: s.gender,
    description: s.description,
    motive: s.motive,
    alibi: s.alibi,
    time_gap: s.timeGap || null,
    suspicious: s.suspicious !== false,
    photo: s.photo || null,
    traits: s.traits || null,
    last_seen: s.lastSeen || null,
    relationship_to_victim: s.relationshipToVictim || null,
    is_guilty: s.id === guiltyIdStr,
  }))
  
  const { error: suspectsError } = await supabase
    .from('case_suspects')
    .insert(suspectsToInsert)
  
  if (suspectsError) throw new Error(`Error saving suspects: ${suspectsError.message}`)
  
  // 4. Insertar hiddenContext (opcional - tabla puede no existir)
  if (hiddenContext) {
    const guiltyIdForDb = hiddenContext.guiltyId?.replace('suspect-', '') || hiddenContext.guiltyId
    const { error: hiddenError } = await supabase
      .from('case_hidden_context')
      .insert({
        case_id: caseId,
        guilty_suspect_key: `suspect-${guiltyIdForDb}`,
        guilty_reason: hiddenContext.guiltyReason,
        key_clues: hiddenContext.keyClues || [],
        guilty_traits: hiddenContext.guiltyTraits || [],
      })
    
    if (hiddenError) {
      console.warn('⚠️  No se pudo guardar hiddenContext (tabla puede no existir):', hiddenError.message)
    }
  }
  
  // 5. Insertar arma si existe (opcional - tabla puede no existir)
  if (weapon) {
    const { error: weaponError } = await supabase
      .from('case_weapons')
      .insert({
        case_id: caseId,
        weapon_key: weapon.id || 'weapon-1',
        name: typeof weapon.name === 'string' ? weapon.name : (weapon.name?.es || weapon.name?.en || ''),
        description: weapon.description,
        location: weapon.location,
        photo: weapon.photo,
        importance: weapon.importance || 'high',
      })
    
    if (weaponError) {
      console.warn('⚠️  No se pudo guardar arma (tabla puede no existir):', weaponError.message)
    }
  }
  
  return caseId
}

generateInitialCaseRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body: InitialCaseGenerationRequest = req.body
    
    // Validate required fields
    if (!body.caseType || !body.suspects || !body.clues || !body.difficulty) {
      return res.status(400).json({ error: 'Missing required fields: caseType, suspects, clues, difficulty' })
    }

    // Validar que solo haya scenario o customScenario, no ambos
    if (body.scenario && body.customScenario) {
      return res.status(400).json({ error: 'Cannot provide both scenario and customScenario. Provide only one.' })
    }

    if (!body.scenario && !body.customScenario) {
      return res.status(400).json({ error: 'Must provide either scenario or customScenario' })
    }

    const { language = 'es', playerNames: rawPlayerNames = [], playerGenders: rawPlayerGenders = [] } = body

    // Normalizar playerNames
    const playerNames: string[] = rawPlayerNames.map((item: any) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && item.name) return item.name
      return String(item || '')
    })

    // Normalizar playerGenders
    const playerGenders: string[] =
      rawPlayerGenders.length > 0
        ? rawPlayerGenders.map((g: any) => typeof g === 'string' ? g : String(g || ''))
        : rawPlayerNames
            .map((item: any) => item?.gender || '')
            .filter(Boolean)

    // Obtener sospechosos desde Supabase
    // Si hay customScenario, no pasar scene (obtendrá aleatorios)
    const sceneForService = body.customScenario ? undefined : body.scenario

    const selectedSuspects = await SuspectService.getSuspectsForScene({
      count: body.suspects,
      scene: sceneForService,
      style: body.style,
      preferredGenders: playerGenders.length > 0 ? playerGenders : undefined,
    })

    // Seleccionar arma
    // Si hay customScenario, no pasar scene (obtendrá aleatoria)
    let selectedWeapon = null
    if (body.caseType === 'asesinato') {
      selectedWeapon = await WeaponService.selectWeapon({
        scene: sceneForService,
        style: body.style,
        preferSpecific: !body.customScenario, // No preferir específica si es custom
      })
    }

    const randomGuiltyIndex = Math.floor(Math.random() * body.suspects) + 1

    // ============================================
    // PASO 1: Generar core del caso
    // ============================================
    const caseCore = await generateCaseCore(body, selectedSuspects, selectedWeapon, language)

    // ============================================
    // PASO 2: Generar sospechosos en batches
    // ============================================
    const BATCH_SIZE = 3 // Generar 3 sospechosos a la vez
    const allSuspects: any[] = []
    
    for (let batchStart = 0; batchStart < body.suspects; batchStart += BATCH_SIZE) {
      const batch = await generateSuspectsBatch(
        body,
        selectedSuspects,
        language,
        randomGuiltyIndex,
        playerNames,
        playerGenders,
        allSuspects, // Pasar sospechosos anteriores como contexto
        batchStart,
        Math.min(BATCH_SIZE, body.suspects - batchStart)
      )
      allSuspects.push(...batch)
    }

    // Validar número de sospechosos
    if (allSuspects.length !== body.suspects) {
      throw new Error(`AI generated ${allSuspects.length} suspects instead of ${body.suspects}`)
    }

    // Aplicar nombres de jugadores
    if (allSuspects && playerNames.length > 0) {
      allSuspects.forEach((s, i) => {
        if (playerNames[i]) {
          s.name = playerNames[i]
        }
      })
    }

    // Matching con Supabase
    if (allSuspects && selectedSuspects) {
      const remaining = [...selectedSuspects]
      const usedIds = new Set<string>()

      function scoreMatch(gen: any, orig: any): number {
        let score = 0
        const genRole = (gen.role || '').toLowerCase()
        const origOccEs = (orig.occupation?.es || '').toLowerCase()
        const origOccEn = (orig.occupation?.en || '').toLowerCase()

        if (genRole && (genRole === origOccEs || genRole === origOccEn)) score += 5
        else if (genRole && origOccEs.includes(genRole)) score += 3

        if (gen.gender && orig.gender && gen.gender === orig.gender) score += 2
        return score
      }

      allSuspects.forEach((gen) => {
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

        if (best?.id) usedIds.add(best.id)

        if (best?.image_url) {
          gen.photo = best.image_url
        }
      })
    }

    // ============================================
    // PASO 3: Generar hiddenContext
    // ============================================
    const hiddenContext = await generateHiddenContext(
      body,
      language,
      randomGuiltyIndex,
      allSuspects
    )
    // Asegurar que guiltyId esté en el formato correcto
    hiddenContext.guiltyId = `suspect-${randomGuiltyIndex}`

    // ============================================
    // Guardar en Supabase
    // ============================================
    const caseId = await saveCaseToSupabase(
      caseCore,
      caseCore.victim,
      caseCore.weapon,
      allSuspects,
      hiddenContext,
      body
    )

    // Construir respuesta
    const response: InitialCaseResponse = {
      id: caseId,
      caseTitle: caseCore.caseTitle,
      caseDescription: caseCore.caseDescription,
      victim: caseCore.victim,
      suspects: allSuspects,
      weapon: caseCore.weapon,
      hiddenContext: {
        ...hiddenContext,
        guiltyId: `suspect-${randomGuiltyIndex}`,
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
      supabaseSuspects: selectedSuspects,
    }

    return res.json(response)
  } catch (error) {
    console.error('Error in generate-initial-case API:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'

    return res.status(500).json({
      error: 'Failed to generate initial case',
      details: message,
    })
  }
})
