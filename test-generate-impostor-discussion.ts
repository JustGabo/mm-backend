/**
 * Script de prueba para verificar que el endpoint de generar discusión impostor funciona
 * 
 * Uso:
 *   npm run test:impostor-discussion
 *   o
 *   npx tsx test-generate-impostor-discussion.ts
 * 
 * NOTA: Este test requiere que primero generes un caso impostor y uses su respuesta
 * como contexto. Puedes usar test-impostor-response.json si existe.
 */

import dotenv from 'dotenv'
import { readFile } from 'fs/promises'

// Cargar .env.local primero (si existe), luego .env
dotenv.config({ path: '.env.local' })
dotenv.config() // .env tiene prioridad sobre .env.local

// Usar el mismo puerto que el servidor
const SERVER_PORT = process.env.PORT || 3001
const API_URL = process.env.API_URL || `http://localhost:${SERVER_PORT}`
const ENDPOINT = `${API_URL}/api/generate-impostor-discussion`

async function checkServerHealth() {
  // Intentar primero con el puerto configurado, luego 3000, luego 3001
  const portsToTry = [SERVER_PORT, 3000, 3001].filter((port, index, self) => self.indexOf(port) === index)
  
  for (const port of portsToTry) {
    try {
      const testUrl = `http://localhost:${port}/api/health`
      const healthResponse = await fetch(testUrl)
      if (healthResponse.ok) {
        if (port !== SERVER_PORT) {
          console.log(`⚠️  Servidor encontrado en puerto ${port} (configurado: ${SERVER_PORT})`)
          return { running: true, port }
        }
        console.log('✅ Servidor está corriendo\n')
        return { running: true, port }
      }
    } catch (error) {
      // Continuar al siguiente puerto
      continue
    }
  }
  return { running: false, port: null }
}

async function testGenerateImpostorDiscussion() {
  console.log('🧪 Iniciando test de generación de discusión impostor...\n')

  // Verificar que el servidor esté corriendo
  console.log('🔍 Verificando que el servidor esté corriendo...')
  const serverStatus = await checkServerHealth()
  
  if (!serverStatus.running) {
    console.error('❌ El servidor no está corriendo o no responde\n')
    console.log('💡 Para iniciar el servidor, ejecuta en otra terminal:')
    console.log('   npm run dev\n')
    process.exit(1)
  }

  // Intentar cargar caso impostor previo
  let caseContext: any = null
  try {
    const caseData = await readFile('test-impostor-response.json', 'utf-8')
    caseContext = JSON.parse(caseData)
    console.log('✅ Caso impostor cargado desde test-impostor-response.json\n')
  } catch (error) {
    console.log('⚠️  No se encontró test-impostor-response.json')
    console.log('💡 Ejecuta primero: npm run test:impostor-case\n')
    console.log('📝 Usando datos de ejemplo para el test...\n')
    
    // Datos de ejemplo mínimos
    caseContext = {
      caseTitle: "Asesinato en la Mansión",
      caseDescription: "Un asesinato ha tenido lugar en una mansión durante una fiesta.",
      caseType: "asesinato",
      scenario: "mansion",
      difficulty: "normal",
      victim: {
        name: "Don Alejandro",
        role: "Propietario de la mansión"
      },
      players: [
        { id: "player-1", name: "Ana", role: "Jardinera", isKiller: true },
        { id: "player-2", name: "Carlos", role: "Empresario", isKiller: false },
        { id: "player-3", name: "María", role: "Jardinera", isKiller: false },
        { id: "player-4", name: "Luis", role: "Jefe de tripulación", isKiller: false }
      ],
      killerId: "player-1"
    }
  }

  // Usar el puerto donde encontramos el servidor
  const actualPort = serverStatus.port || SERVER_PORT
  const actualApiUrl = `http://localhost:${actualPort}`
  const actualEndpoint = `${actualApiUrl}/api/generate-impostor-discussion`
  
  console.log(`📍 Endpoint: ${actualEndpoint}\n`)

  // Preparar información completa de jugadores si está disponible
  const allPlayersInfo = caseContext.players?.map((p: any) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    alibi: p.alibi || `Coartada de ${p.name}`,
    location: p.location || `Ubicación de ${p.name}`,
    whereWas: p.whereWas || `Dónde estaba ${p.name}`,
    whatDid: p.whatDid || `Qué hizo ${p.name}`,
    suspiciousBehavior: p.suspiciousBehavior,
    whySuspicious: p.whySuspicious || `Motivo de sospecha de ${p.name}`,
    additionalContext: p.additionalContext,
    isKiller: p.isKiller === true
  })) || []

  // Datos de prueba para diferentes rondas
  const testRounds = [
    {
      roundNumber: 3,
      description: "FASE 3 - Preguntas de clarificación"
    },
    {
      roundNumber: 4,
      description: "FASE 4 - Evidencias generadas"
    },
    {
      roundNumber: 5,
      description: "FASE 5 - Contradicciones directas"
    }
  ]

  const discussionHistory: any[] = []

  for (const testRound of testRounds) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🧪 Testando ronda ${testRound.roundNumber}: ${testRound.description}`)
    console.log(`${'='.repeat(60)}\n`)

    const testData = {
      roundNumber: testRound.roundNumber,
      caseContext: {
        caseTitle: caseContext.caseTitle,
        caseDescription: caseContext.caseDescription,
        caseType: caseContext.caseType,
        scenario: caseContext.scenario,
        difficulty: caseContext.difficulty,
        victim: caseContext.victim,
        players: caseContext.players,
        killerId: caseContext.hiddenContext?.killerId || caseContext.killerId || caseContext.players?.find((p: any) => p.isKiller)?.id
      },
      discussionHistory: discussionHistory.length > 0 ? discussionHistory : undefined,
      allPlayersInfo: allPlayersInfo.length > 0 ? allPlayersInfo : undefined,
      language: 'es'
    }

    console.log('📤 Enviando petición con los siguientes datos:')
    console.log(`   Ronda: ${testData.roundNumber}`)
    console.log(`   Historial previo: ${discussionHistory.length} entradas`)
    console.log(`   Jugadores: ${testData.caseContext.players.length}`)
    console.log(`   Asesino: ${testData.caseContext.killerId}\n`)

    try {
      const startTime = Date.now()
      
      const response = await fetch(actualEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testData)
      })

      const endTime = Date.now()
      const duration = endTime - startTime

      console.log(`⏱️  Tiempo de respuesta: ${duration}ms`)
      console.log(`📊 Status: ${response.status} ${response.statusText}\n`)

      if (!response.ok) {
        const errorData = await response.json()
        console.error('❌ Error en la respuesta:')
        console.error(JSON.stringify(errorData, null, 2))
        continue
      }

      const data = await response.json()

      console.log('✅ Respuesta exitosa!\n')
      console.log('📋 Resumen de la discusión generada:')
      console.log(`   ID: ${data.id}`)
      console.log(`   Título: ${data.title}`)
      console.log(`   Tipo: ${data.type}`)
      console.log(`   Contenido: ${data.content?.substring(0, 150)}...`)
      if (data.targetedPlayers) {
        console.log(`   Jugadores mencionados: ${data.targetedPlayers.join(', ')}`)
      }
      if (data.suggestions) {
        console.log(`   Sugerencias: ${data.suggestions.length}`)
        data.suggestions.forEach((s: string, i: number) => {
          console.log(`      ${i + 1}. ${s.substring(0, 80)}...`)
        })
      }

      // Agregar al historial para la siguiente ronda
      discussionHistory.push({
        roundNumber: data.id,
        type: data.type,
        content: data.content,
        topicsDiscussed: data.topicsDiscussed,
        targetedPlayers: data.targetedPlayers
      })

      // Guardar respuesta individual
      const fs = await import('fs/promises')
      await fs.writeFile(
        `test-impostor-discussion-round-${testRound.roundNumber}.json`,
        JSON.stringify(data, null, 2),
        'utf-8'
      )
      console.log(`💾 Respuesta guardada en test-impostor-discussion-round-${testRound.roundNumber}.json`)

    } catch (error) {
      console.error(`❌ Error al ejecutar el test para la ronda ${testRound.roundNumber}:`)
      if (error instanceof Error) {
        console.error(`   ${error.message}`)
      } else {
        console.error(error)
      }
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ Test de discusiones completado!')
  console.log('='.repeat(60))
  console.log('\n💡 Archivos generados:')
  console.log('   - test-impostor-discussion-round-3.json')
  console.log('   - test-impostor-discussion-round-4.json')
  console.log('   - test-impostor-discussion-round-5.json')
}

// Ejecutar el test
testGenerateImpostorDiscussion()

