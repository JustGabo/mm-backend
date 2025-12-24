import { Request, Response } from 'express'
import OpenAI from 'openai'
import { getCaseFromRoom, getRoomPlayers } from '../services/supabase.js'
import {
  ImpostorPhasesResponse,
  PlayerPhaseInfo,
  ImpostorPhasesDiscussionRequest,
  ImpostorPhasesDiscussionResponse,
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

export async function generateImpostorPhasesDiscussion(req: Request, res: Response) {
  try {
    console.log('API Route: generate-impostor-phases-discussion called')
    
    const body: ImpostorPhasesDiscussionRequest = req.body
    console.log(`Request for discussion round ${body.roundNumber} in room ${body.roomId}`)
    
    // Validate required fields
    if (!body.roomId || !body.roundNumber) {
      return res.status(400).json({
        error: 'Missing required fields: roomId and roundNumber are required'
      })
    }

    const { language = 'es' } = body

    // Obtener el caso desde Supabase
    const caseResult = await getCaseFromRoom(body.roomId)
    if (!caseResult.success || !caseResult.caseData) {
      return res.status(404).json({ error: 'Case not found in room' })
    }

    const caseData: ImpostorPhasesResponse = caseResult.caseData

    // Obtener jugadores de la sala
    const playersResult = await getRoomPlayers(body.roomId)
    if (!playersResult.success || !playersResult.players) {
      return res.status(404).json({ error: 'Players not found in room' })
    }

    // Obtener historial de discusiones desde case_data
    const discussionHistory = (caseData as any).discussionHistory || []

    // Mapear información de jugadores desde las fases al formato esperado por el prompt
    const allPlayersInfo = caseData.players.map((player: PlayerPhaseInfo) => {
      const phase4 = player.phase4
      const phase3 = player.phase3
      const phase1 = player.phase1
      
      const timelineText = phase3.timeline
        .map((t: { time: string; location: string; activity: string }) => `A las ${t.time} estaba en ${t.location} haciendo ${t.activity}`)
        .join('. ')
      
      return {
        id: player.playerId,
        name: phase1.name,
        role: phase1.occupation,
        isKiller: phase4.isKiller,
        alibi: phase4.alibi || timelineText,
        location: phase3.timeline[phase3.timeline.length - 1]?.location || 'Desconocido',
        whereWas: timelineText,
        whatDid: phase3.timeline.map(t => t.activity).join(', '),
        suspiciousBehavior: phase4.suspiciousBehavior,
        whySuspicious: phase4.whySuspicious,
        additionalContext: `Relación con víctima: ${phase1.relationshipWithVictim}. ${phase1.description}. Observaciones previas: ${player.phase2.observations.join('. ')}`
      }
    })

    // Construir contexto del caso
    const caseContext = {
      caseTitle: caseData.caseTitle,
      caseDescription: caseData.caseDescription,
      caseType: caseData.config?.caseType || 'asesinato',
      scenario: caseData.config?.scenario || 'hotel',
      difficulty: caseData.config?.difficulty || 'normal',
      victim: caseData.victim,
      players: caseData.players.map(p => ({
        id: p.playerId,
        name: p.phase1.name,
        role: p.phase1.occupation,
        isKiller: p.phase4.isKiller
      })),
      killerId: caseData.hiddenContext.killerId
    }

    // Crear prompt para OpenAI
    const prompt = createDiscussionPrompt(
      {
        roundNumber: body.roundNumber,
        caseContext,
        discussionHistory,
        allPlayersInfo,
        language
      },
      language
    )

    console.log(`🤖 Calling OpenAI for discussion round ${body.roundNumber}...`)
    
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un detective que interroga a los sospechosos en el modo impostor multijugador. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Puedes hacer preguntas, señalar inconsistencias, o hacer observaciones basadas en el contexto de todos los jugadores. Responde SOLO JSON válido.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    })

    const response = completion.choices[0]?.message?.content
    if (!response) {
      throw new Error('No response from OpenAI')
    }

    console.log('✅ OpenAI response received')

    // Parsear respuesta
    let discussionData: ImpostorPhasesDiscussionResponse
    try {
      discussionData = JSON.parse(response)
    } catch (parseError) {
      const cleanedResponse = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim()
      discussionData = JSON.parse(cleanedResponse)
    }
    
    console.log(`✅ Discussion round ${body.roundNumber} generated successfully`)

    return res.json(discussionData)
    
  } catch (error) {
    console.error('Error in generate-impostor-phases-discussion API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return res.status(500).json({ 
      error: 'Failed to generate discussion round',
      details: errorMessage,
    })
  }
}

// Esta función es muy larga, así que cópiala completa desde app/api/generate-impostor-phases-discussion/route.ts
// (líneas 183-362)
// IMPORTANTE: La función debe usar el parámetro 'language' para generar contenido en el idioma correcto
export function createDiscussionPrompt(
  request: {
    roundNumber: number
    caseContext: any
    discussionHistory: any[]
    allPlayersInfo: any[]
    language: string
  },
  language: string
): string {
  const { roundNumber, caseContext, discussionHistory = [], allPlayersInfo } = request
  // Analizar historial para detectar temas ya cubiertos y evitar repeticiones
  const coveredTopics = new Set<string>()
  const coveredDiscoveries = new Set<string>()
  const coveredInconsistencies = new Set<string>()
  const coveredQuestions = new Set<string>()
  const coveredPlayers = new Set<string>()
  const coveredLocations = new Set<string>()
  const coveredTimes = new Set<string>()
  const coveredEvidence = new Set<string>() // Para evitar repetir el mismo tipo de evidencia
  
  discussionHistory.forEach(h => {
    const content = (h.content || '').toLowerCase()
    const discovery = (h.discovery?.description || '').toLowerCase()
    const type = h.type || ''
    
    // Extraer temas principales
    if (content.includes('coartada') || content.includes('alibi') || content.includes('dónde estaba')) {
      coveredTopics.add('coartadas')
    }
    if (content.includes('tiempo') || content.includes('hora') || content.includes('momento') || content.includes('cuándo')) {
      coveredTopics.add('tiempos')
    }
    if (content.includes('ubicación') || content.includes('lugar') || content.includes('donde') || content.includes('dónde')) {
      coveredTopics.add('ubicaciones')
    }
    if (content.includes('relación') || content.includes('interacción') || content.includes('habló') || content.includes('conversación')) {
      coveredTopics.add('relaciones')
    }
    if (content.includes('comportamiento') || content.includes('extraño') || content.includes('sospechoso')) {
      coveredTopics.add('comportamientos')
    }
    if (content.includes('motivo') || content.includes('por qué') || content.includes('razón')) {
      coveredTopics.add('motivos')
    }
    
    // Extraer descubrimientos específicos para evitar repetición
    if (discovery.includes('huella') || content.includes('huella')) {
      coveredEvidence.add('huellas')
      coveredDiscoveries.add('huellas dactilares')
    }
    if (discovery.includes('dna') || content.includes('adn') || content.includes('genético')) {
      coveredEvidence.add('dna')
      coveredDiscoveries.add('análisis genético')
    }
    if (discovery.includes('cámara') || content.includes('grabación') || content.includes('video')) {
      coveredEvidence.add('cámaras')
      coveredDiscoveries.add('grabaciones de seguridad')
    }
    if (discovery.includes('testigo') || content.includes('testimonio')) {
      coveredEvidence.add('testigos')
      coveredDiscoveries.add('testimonios')
    }
    if (discovery.includes('documento') || content.includes('papel') || content.includes('archivo')) {
      coveredEvidence.add('documentos')
    }
    if (discovery.includes('teléfono') || content.includes('llamada') || content.includes('mensaje')) {
      coveredEvidence.add('comunicaciones')
    }
    
    // Extraer jugadores mencionados
    if (h.targetedPlayers && Array.isArray(h.targetedPlayers)) {
      h.targetedPlayers.forEach((playerId: string) => coveredPlayers.add(playerId))
    }
    
    // Extraer ubicaciones mencionadas
    const locationMatches = content.match(/(?:en|en la|en el)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)*)/gi)
    if (locationMatches) {
      locationMatches.forEach((loc: string) => coveredLocations.add(loc.toLowerCase()))
    }
  })
  
  const historySummary = discussionHistory.length > 0
    ? `\n**RESUMEN DEL HISTORIAL (${discussionHistory.length} rondas anteriores):**\n` +
      `- Temas ya cubiertos: ${Array.from(coveredTopics).join(', ') || 'ninguno'}\n` +
      `- Tipos de evidencia ya mencionados: ${Array.from(coveredEvidence).join(', ') || 'ninguno'}\n` +
      `- Descubrimientos previos: ${Array.from(coveredDiscoveries).join(', ') || 'ninguno'}\n` +
      `- Jugadores más mencionados: ${Array.from(coveredPlayers).slice(0, 3).join(', ') || 'ninguno'}\n` +
      `\n**IMPORTANTE:** NO repitas los mismos temas, descubrimientos o tipos de evidencia ya mencionados. Varía el contenido y enfócate en aspectos NUEVOS.`
    : ''

  const historyInfo = discussionHistory.length > 0
    ? `\n**HISTORIAL COMPLETO DE DISCUSIONES ANTERIORES:**\n${discussionHistory.map(h => {
        const roundInfo = `- Ronda ${h.id || h.roundNumber} (${h.type || 'unknown'}): ${h.content || ''}`
        const discoveryInfo = h.discovery ? `\n  Descubrimiento: ${h.discovery.description || ''}${h.discovery.implications ? `\n  Implicaciones: ${h.discovery.implications.join(', ')}` : ''}` : ''
        const playersInfo = h.targetedPlayers ? `\n  Jugadores mencionados: ${h.targetedPlayers.join(', ')}` : ''
        return roundInfo + discoveryInfo + playersInfo
      }).join('\n')}\n`
    : ''

  // Información completa de jugadores
  const allPlayersInfoText = allPlayersInfo && allPlayersInfo.length > 0
    ? allPlayersInfo.map(p => `
- **${p.name}** (${p.role}):
  * Motivo por el que es sospechoso: ${p.whySuspicious || 'No especificado'}
  * Coartada: ${p.alibi}
  * Ubicación: ${p.location}
  * Dónde estaba: ${p.whereWas}
  * Qué estaba haciendo: ${p.whatDid}
  ${p.suspiciousBehavior ? `* Comportamiento sospechoso: ${p.suspiciousBehavior}` : ''}
  ${p.additionalContext ? `* Contexto adicional: ${p.additionalContext.substring(0, 200)}...` : ''}
  ${p.isKiller ? '* 🔴 CULPABLE' : '* ✅ Inocente'}
`).join('\n')
    : ''

  // Reutilizar el mismo prompt del modo single-player pero adaptado
  // (El prompt es muy largo, así que lo importaremos o copiaremos la estructura)
  return `
Eres un detective que interroga a los sospechosos en la ronda ${roundNumber} del modo impostor multijugador.

**CONTEXTO DEL CASO:**
- Título: ${caseContext.caseTitle}
- Descripción: ${caseContext.caseDescription}
- Tipo: ${caseContext.caseType}
- Escenario: ${caseContext.scenario}
- Dificultad: ${caseContext.difficulty}
- Culpable: ${caseContext.players.find((p: any) => p.id === caseContext.killerId)?.name || 'Desconocido'}

**INFORMACIÓN COMPLETA DE TODOS LOS JUGADORES:**
${allPlayersInfoText}
${historyInfo}
${historySummary}

**ESTRUCTURA DE RONDAS:**
- RONDA 1 (roundNumber 1): Preguntar el motivo - Genera preguntas (tipo "question") para que los jugadores expliquen sus motivos de sospecha y por qué podrían ser sospechosos. Pregunta a MÚLTIPLES jugadores (mínimo 3-4) sobre sus motivos. NO hagas focus en un solo jugador, especialmente NO en el culpable.
- RONDA 2 (roundNumber 2): Decir las coartadas - Genera preguntas (tipo "question") para que los jugadores expliquen sus coartadas y dónde estaban durante el evento. Pregunta a MÚLTIPLES jugadores (mínimo 3-4) sobre sus coartadas. NO hagas focus en un solo jugador.
- RONDA 3 (roundNumber 3): Primer descubrimiento - Genera un descubrimiento/pista NUEVA (tipo "discovery") descubierta por la investigación. Debe ser evidencia objetiva que pueda inculpar a varios jugadores. Ejemplos: "Se encontraron huellas en [lugar]", "El análisis forense revela...", "Los registros muestran...". Varía los tipos de evidencia: forense, tecnológica, testimonial, física, etc. ${historySummary.includes('huellas') ? '**NO menciones huellas dactilares, ya se habló de eso anteriormente.**' : ''}
- RONDA 4 (roundNumber 4): Segundo descubrimiento - Genera OTRO descubrimiento/pista NUEVA (tipo "discovery"), DIFERENTE al de la RONDA 3. Continúa revelando evidencia objetiva. ${historySummary.includes('huellas') || historySummary.includes('dna') ? '**NO repitas el mismo tipo de evidencia (huellas, DNA, etc.) ya mencionado.**' : ''}
- RONDA 5 (roundNumber 5): Tercer descubrimiento o contradicción - Genera otro descubrimiento NUEVO (tipo "discovery") O señala una contradicción (tipo "inconsistency"), pero SIEMPRE mencionando a MÚLTIPLES jugadores (mínimo 3-4). ${historySummary.includes('huellas') || historySummary.includes('dna') || historySummary.includes('cámaras') ? '**NO repitas tipos de evidencia ya mencionados.**' : ''}
- RONDA 6 (roundNumber 6): Análisis final y presión - Haz preguntas generales (tipo "question") o señala contradicciones finales (tipo "inconsistency") que inviten a reflexionar sobre todo lo descubierto. Que generen debates entre TODOS los sospechosos sin hacer focus en uno solo.

**TIPOS DE INTERVENCIONES DEL DETECTIVE:**
1. **PREGUNTA (type: "question")**: Hacer una pregunta directa a los jugadores
2. **INCONSISTENCIA (type: "inconsistency")**: Señalar inconsistencias usando EVIDENCIA OBJETIVA
3. **DESCUBRIMIENTO (type: "discovery")**: Revelar información nueva descubierta por la investigación

**🚨 REGLA CRÍTICA - DISTRIBUCIÓN DE JUGADORES Y REDUCIR FOCUS EN CULPABLE:**
- **NUNCA menciones SOLO al culpable** en ninguna intervención
- **PREFIERE NO mencionar al culpable** si puedes evitarlo. Si lo mencionas, DEBES mencionar también a AL MENOS 2-3 OTROS JUGADORES
- **Distribuye equitativamente** las menciones entre TODOS los jugadores, no solo entre el culpable y otros
- En "targetedPlayers", SIEMPRE incluye al menos 3-4 jugadores, nunca solo 1 o 2
- **Varía los jugadores mencionados** entre rondas: si una ronda mencionó al culpable, en la siguiente menciona a otros jugadores SIN mencionar al culpable
- **El objetivo es que el culpable NO sea obvio.** Si siempre lo mencionas o haces focus en él, se vuelve muy evidente. Distribuye la atención entre TODOS los sospechosos.

**FORMATO JSON ESPERADO:**
{
  "id": ${roundNumber},
  "title": "Título de la ronda",
  "type": "question" | "inconsistency" | "observation" | "discovery",
  "content": "Contenido principal",
  "context": "Contexto adicional",
  "suggestions": ["Sugerencia 1", "Sugerencia 2", "Sugerencia 3"],
  "targetedPlayers": ["player-1", "player-2", "player-3"],
  "discovery": {
    "description": "Descripción del descubrimiento (solo si type es 'discovery')",
    "implications": ["Implicación 1", "Implicación 2"]
  }
}

**CRÍTICO:**
- El contenido debe estar en ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
- Debe ser clara y específica
- Debe permitir que todos los jugadores participen
- NO reveles directamente quién es el culpable
- Varía los temas y jugadores mencionados entre rondas
`
}