/**
 * Script de prueba para verificar que el endpoint de generar discusión impostor con fases funciona
 * 
 * Uso:
 *   npx tsx test-generate-impostor-phases-discussion.ts
 * 
 * NOTA: Este test requiere que primero generes un caso impostor con fases usando
 * test-generate-impostor-phases.ts y que el caso esté guardado en Supabase con el roomId.
 */

import dotenv from 'dotenv'
import { readFile } from 'fs/promises'

// Cargar .env.local primero (si existe), luego .env
dotenv.config({ path: '.env.local' })
dotenv.config() // .env tiene prioridad sobre .env.local

// Usar el mismo puerto que el servidor
const SERVER_PORT = process.env.PORT || 3001
const API_URL = process.env.API_URL || `http://localhost:${SERVER_PORT}`
const ENDPOINT = `${API_URL}/api/generate-impostor-phases-discussion`

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

async function testGenerateImpostorPhasesDiscussion() {
  console.log('🧪 Iniciando test de generación de discusión impostor con fases...\n')

  // Verificar que el servidor esté corriendo
  console.log('🔍 Verificando que el servidor esté corriendo...')
  const serverStatus = await checkServerHealth()
  
  if (!serverStatus.running) {
    console.error('❌ El servidor no está corriendo o no responde\n')
    console.log('💡 Para iniciar el servidor, ejecuta en otra terminal:')
    console.log('   npm run dev\n')
    process.exit(1)
  }

  // Intentar cargar caso impostor previo para obtener el roomId
  let testRoomId = process.env.TEST_ROOM_ID || null
  let caseData: any = null
  
  try {
    const caseDataFile = await readFile('test-impostor-phases-response.json', 'utf-8')
    caseData = JSON.parse(caseDataFile)
    console.log('✅ Caso impostor con fases cargado desde test-impostor-phases-response.json')
    
    // Si no hay roomId en el archivo, usar el de env o pedir uno
    if (!testRoomId) {
      console.log('⚠️  No se encontró roomId en el archivo ni en TEST_ROOM_ID')
      console.log('💡 Este test requiere un roomId válido con el caso guardado en Supabase')
      console.log('💡 Configura TEST_ROOM_ID en .env o proporciona un roomId válido\n')
      
      // Intentar continuar con un roomId de ejemplo (probablemente fallará)
      testRoomId = 'test-room-id'
      console.log(`⚠️  Usando roomId de prueba: ${testRoomId}\n`)
    } else {
      console.log(`✅ Usando roomId: ${testRoomId}\n`)
    }
  } catch (error) {
    console.log('⚠️  No se encontró test-impostor-phases-response.json')
    console.log('💡 Ejecuta primero: npx tsx test-generate-impostor-phases.ts\n')
    
    if (!testRoomId) {
      console.log('❌ No se puede continuar sin un roomId válido')
      console.log('💡 Configura TEST_ROOM_ID en .env con un roomId que tenga un caso guardado en Supabase\n')
      process.exit(1)
    }
    
    console.log(`⚠️  Continuando con roomId de configuración: ${testRoomId}\n`)
  }

  // Usar el puerto donde encontramos el servidor
  const actualPort = serverStatus.port || SERVER_PORT
  const actualApiUrl = `http://localhost:${actualPort}`
  const actualEndpoint = `${actualApiUrl}/api/generate-impostor-phases-discussion`
  
  console.log(`📍 Endpoint: ${actualEndpoint}\n`)

  // Datos de prueba para diferentes rondas
  const testRounds = [
    {
      roundNumber: 1,
      description: "RONDA 1 - Preguntar el motivo"
    },
    {
      roundNumber: 2,
      description: "RONDA 2 - Decir las coartadas"
    },
    {
      roundNumber: 3,
      description: "RONDA 3 - Primer descubrimiento"
    },
    {
      roundNumber: 4,
      description: "RONDA 4 - Segundo descubrimiento"
    }
  ]

  for (const testRound of testRounds) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`🧪 Testando ronda ${testRound.roundNumber}: ${testRound.description}`)
    console.log(`${'='.repeat(60)}\n`)

    const testData = {
      roomId: testRoomId,
      roundNumber: testRound.roundNumber,
      language: 'en'
    }

    console.log('📤 Enviando petición con los siguientes datos:')
    console.log(JSON.stringify(testData, null, 2))
    console.log('\n')

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
        
        if (errorData.error?.includes('Case not found')) {
          console.log('\n💡 El roomId no tiene un caso guardado. Asegúrate de:')
          console.log('   1. Generar un caso primero con test-generate-impostor-phases.ts')
          console.log('   2. Guardar el caso en Supabase con el roomId correcto')
          console.log('   3. Usar el mismo roomId en TEST_ROOM_ID')
        }
        
        continue
      }

      const data = await response.json()

      console.log('✅ Respuesta exitosa!\n')
      console.log('📋 Resumen de la discusión generada:')
      console.log(`   ID: ${data.id}`)
      console.log(`   Título: ${data.title}`)
      console.log(`   Tipo: ${data.type}`)
      console.log(`   Contenido: ${data.content?.substring(0, 200)}...`)
      if (data.targetedPlayers) {
        console.log(`   Jugadores mencionados: ${data.targetedPlayers.length} - ${data.targetedPlayers.join(', ')}`)
      }
      if (data.suggestions) {
        console.log(`   Sugerencias: ${data.suggestions.length}`)
        data.suggestions.slice(0, 3).forEach((s: string, i: number) => {
          console.log(`      ${i + 1}. ${s.substring(0, 80)}...`)
        })
      }
      if (data.discovery) {
        console.log(`   Descubrimiento: ${data.discovery.description?.substring(0, 150)}...`)
        if (data.discovery.implications) {
          console.log(`   Implicaciones: ${data.discovery.implications.length}`)
        }
      }

      // Guardar respuesta individual
      const fs = await import('fs/promises')
      await fs.writeFile(
        `test-impostor-phases-discussion-round-${testRound.roundNumber}.json`,
        JSON.stringify(data, null, 2),
        'utf-8'
      )
      console.log(`💾 Respuesta guardada en test-impostor-phases-discussion-round-${testRound.roundNumber}.json`)

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
  console.log('✅ Test de discusiones con fases completado!')
  console.log('='.repeat(60))
  console.log('\n💡 Archivos generados:')
  testRounds.forEach(round => {
    console.log(`   - test-impostor-phases-discussion-round-${round.roundNumber}.json`)
  })
}

// Ejecutar el test
testGenerateImpostorPhasesDiscussion()

