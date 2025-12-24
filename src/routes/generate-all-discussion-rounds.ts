import { Request, Response } from 'express'
import { getCaseFromRoom, getRoomPlayers } from '../services/supabase.js'
import { ImpostorPhasesResponse, PlayerPhaseInfo } from '../types/multiplayer.js'
import {
  ImpostorPhasesDiscussionResponse,
} from '../types/multiplayer.js'
import { GenerateAllRoundsRequest } from '../types/multiplayer.js'
import { createDiscussionPrompt } from './generate-impostor-phases-discussion.js'
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

export async function generateAllDiscussionRounds(req: Request, res: Response) {
  try {
    console.log('API Route: generate-all-discussion-rounds called')
    
    const body: GenerateAllRoundsRequest = req.body
    console.log(`Request to generate all discussion rounds for room ${body.roomId}`)
    
    // Validate required fields
    if (!body.roomId) {
      return res.status(400).json({
        error: 'Missing required field: roomId is required'
      })
    }

    const { language = 'es' } = body

    // Obtener el caso desde Supabase
    const caseResult = await getCaseFromRoom(body.roomId)
    if (!caseResult.success || !caseResult.caseData) {
      return res.status(404).json({ error: 'Case not found in room' })
    }

    const caseData: ImpostorPhasesResponse = caseResult.caseData

    // Generar las rondas 3, 4, 5 y 6 directamente
    const roundsToGenerate = [3, 4, 5, 6]
    const generatedRounds: ImpostorPhasesDiscussionResponse[] = []

    console.log(`🤖 Generating ${roundsToGenerate.length} discussion rounds...`)

    // Obtener jugadores de la sala
    const playersResult = await getRoomPlayers(body.roomId)
    if (!playersResult.success || !playersResult.players) {
      return res.status(404).json({ error: 'Players not found in room' })
    }

    // Mapear información de jugadores
    const allPlayersInfo = caseData.players.map((player: any) => {
      const phase4 = player.phase4
      const phase3 = player.phase3
      const phase1 = player.phase1
      
      const timelineText = phase3.timeline
        .map((t: any) => `A las ${t.time} estaba en ${t.location} haciendo ${t.activity}`)
        .join('. ')
      
      return {
        id: player.playerId,
        name: phase1.name,
        role: phase1.occupation,
        isKiller: phase4.isKiller,
        alibi: phase4.alibi || timelineText,
        location: phase3.timeline[phase3.timeline.length - 1]?.location || 'Desconocido',
        whereWas: timelineText,
        whatDid: phase3.timeline.map((t: any) => t.activity).join(', '),
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
      players: caseData.players.map((p: PlayerPhaseInfo) => ({
        id: p.playerId,
        name: p.phase1.name,
        role: p.phase1.occupation,
        isKiller: p.phase4.isKiller
      })),
      killerId: caseData.hiddenContext.killerId
    }

    // Obtener historial de discusiones (vacío para las primeras rondas)
    const discussionHistory = (caseData as any).discussionHistory || []

    for (const roundNumber of roundsToGenerate) {
      try {
        console.log(`📝 Generating round ${roundNumber}...`)
        
        // Crear prompt para esta ronda
        const prompt = createDiscussionPrompt(
          {
            roundNumber,
            caseContext,
            discussionHistory: [...discussionHistory, ...generatedRounds], // Incluir rondas ya generadas
            allPlayersInfo,
            language
          },
          language
        )

        // Llamar a OpenAI
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

        // Parsear respuesta
        let roundData: ImpostorPhasesDiscussionResponse
        try {
          roundData = JSON.parse(response)
        } catch (parseError) {
          const cleanedResponse = response
            .replace(/```json\s*/g, '')
            .replace(/```\s*$/g, '')
            .trim()
          roundData = JSON.parse(cleanedResponse)
        }

        // Asegurar que el ID sea correcto
        roundData.id = roundNumber
        generatedRounds.push(roundData)
        
        // Agregar al historial para las siguientes rondas
        discussionHistory.push(roundData)
        
        console.log(`✅ Round ${roundNumber} generated successfully`)
      } catch (error) {
        console.error(`❌ Error generating round ${roundNumber}:`, error)
        // Continuar con las siguientes rondas aunque una falle
        continue
      }
    }

    if (generatedRounds.length === 0) {
      return res.status(500).json({
        error: 'Failed to generate any discussion rounds'
      })
    }

    // Organizar las rondas por ID
    const discussionData = {
      rounds: generatedRounds.sort((a, b) => a.id - b.id),
      generatedAt: new Date().toISOString(),
    }

    console.log(`✅ Successfully generated ${generatedRounds.length} discussion rounds`)

    return res.json(discussionData)
    
  } catch (error) {
    console.error('Error in generate-all-discussion-rounds API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return res.status(500).json({ 
      error: 'Failed to generate discussion rounds',
      details: errorMessage,
    })
  }
}