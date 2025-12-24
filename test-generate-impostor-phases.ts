/**
 * Script de prueba para verificar que el endpoint de generar caso impostor con fases funciona
 * 
 * Uso:
 *   npx tsx test-generate-impostor-phases.ts
 * 
 * NOTA: Este test requiere:
 * - Un roomId válido en Supabase con jugadores
 * - Variables de entorno configuradas (.env)
 */

import dotenv from 'dotenv'

// Cargar .env.local primero (si existe), luego .env
dotenv.config({ path: '.env.local' })
dotenv.config() // .env tiene prioridad sobre .env.local

// Usar el mismo puerto que el servidor
const SERVER_PORT = process.env.PORT || 3001
const API_URL = process.env.API_URL || `http://localhost:${SERVER_PORT}`
const ENDPOINT = `${API_URL}/api/generate-impostor-phases`

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

async function testGenerateImpostorPhases() {
  console.log('🧪 Iniciando test de generación de caso impostor con fases...\n')

  // Verificar que el servidor esté corriendo
  console.log('🔍 Verificando que el servidor esté corriendo...')
  const serverStatus = await checkServerHealth()
  
  if (!serverStatus.running) {
    console.error('❌ El servidor no está corriendo o no responde\n')
    console.log('💡 Para iniciar el servidor, ejecuta en otra terminal:')
    console.log('   npm run dev\n')
    console.log('📋 Asegúrate de tener configuradas las variables de entorno en .env:')
    console.log('   - OPENAI_API_KEY (requerido)')
    console.log('   - NEXT_PUBLIC_SUPABASE_URL (requerido)')
    console.log('   - NEXT_PUBLIC_SUPABASE_ANON_KEY (requerido)')
    console.log('   - PORT (opcional, default: 3001)')
    process.exit(1)
  }

  // Usar el puerto donde encontramos el servidor
  const actualPort = serverStatus.port || SERVER_PORT
  const actualApiUrl = `http://localhost:${actualPort}`
  const actualEndpoint = `${actualApiUrl}/api/generate-impostor-phases`
  
  console.log(`📍 Endpoint: ${actualEndpoint}\n`)

  // NOTA: Necesitas un roomId válido con jugadores en Supabase
  // Por ahora usamos un roomId de ejemplo - deberás reemplazarlo con uno real
  const testRoomId = process.env.TEST_ROOM_ID || 'test-room-id'
  
  if (testRoomId === 'test-room-id') {
    console.log('⚠️  Usando roomId de prueba. Si falla, configura TEST_ROOM_ID en .env con un roomId válido\n')
  }

  // Datos de prueba
  const testData = {
    roomId: testRoomId,
    caseType: 'asesinato',
    suspects: 4,
    clues: 8,
    scenario: 'hotel',
    difficulty: 'normal',
    style: 'realistic' as const,
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
      
      if (errorData.error?.includes('No players found')) {
        console.log('\n💡 El roomId no tiene jugadores. Asegúrate de:')
        console.log('   1. Crear una sala en Supabase')
        console.log('   2. Agregar jugadores a esa sala')
        console.log('   3. Usar el roomId correcto en TEST_ROOM_ID')
      }
      
      process.exit(1)
    }

    const data = await response.json()

    console.log('✅ Respuesta exitosa!\n')
    console.log('📋 Resumen del caso impostor con fases generado:')
    console.log(`   Título: ${data.caseTitle}`)
    console.log(`   Tipo: ${data.config?.caseType}`)
    console.log(`   Escenario: ${data.config?.scenario}`)
    console.log(`   Dificultad: ${data.config?.difficulty}`)
    console.log(`   Víctima: ${data.victim.name} (${data.victim.role})`)
    console.log(`   Jugadores: ${data.players.length}`)
    console.log(`   Arma: ${data.weapon?.name || 'N/A'}`)
    console.log(`   Asesino (oculto): ${data.hiddenContext.killerId}\n`)

    console.log('👥 Jugadores con fases:')
    data.players.forEach((player: any, index: number) => {
      const isKiller = player.phase4?.isKiller === true
      console.log(`\n   ${index + 1}. ${player.phase1?.name || 'Sin nombre'}`)
      console.log(`      - PlayerId: ${player.playerId}`)
      console.log(`      - Ocupación: ${player.phase1?.occupation || 'N/A'}`)
      console.log(`      - Relación con víctima: ${player.phase1?.relationshipWithVictim || 'N/A'}`)
      console.log(`      - Observaciones (Fase 2): ${player.phase2?.observations?.length || 0}`)
      console.log(`      - Timeline (Fase 3): ${player.phase3?.timeline?.length || 0} momentos`)
      console.log(`      - Motivo de sospecha: ${player.phase4?.whySuspicious?.substring(0, 60) || 'N/A'}...`)
      console.log(`      - ${isKiller ? '🔴 [ASESINO]' : '✅ Inocente'}`)
    })
    
    // Verificar que hay exactamente un asesino
    const killers = data.players.filter((p: any) => p.phase4?.isKiller === true)
    console.log('\n🔍 Verificación del asesino:')
    if (killers.length === 1) {
      console.log(`   ✅ Hay exactamente un asesino: ${killers[0].phase1?.name} (${killers[0].playerId})`)
      if (killers[0].playerId === data.hiddenContext.killerId) {
        console.log(`   ✅ El playerId del asesino coincide con hiddenContext.killerId`)
      } else {
        console.log(`   ⚠️  El playerId del asesino (${killers[0].playerId}) no coincide con hiddenContext.killerId (${data.hiddenContext.killerId})`)
      }
    } else {
      console.log(`   ❌ Error: Se esperaba 1 asesino, pero se encontraron ${killers.length}`)
    }

    // Verificar estructura de fases
    console.log('\n🔍 Verificación de estructura de fases:')
    let allPhasesValid = true
    data.players.forEach((player: any, index: number) => {
      if (!player.phase1 || !player.phase2 || !player.phase3 || !player.phase4) {
        console.log(`   ❌ Jugador ${index + 1} (${player.phase1?.name}): Faltan fases`)
        allPhasesValid = false
      } else {
        console.log(`   ✅ Jugador ${index + 1} (${player.phase1.name}): Todas las fases presentes`)
      }
    })

    if (allPhasesValid) {
      console.log('\n✅ Todas las fases están correctamente estructuradas!')
    }

    console.log('\n✅ Test completado exitosamente!')
    
    // Guardar respuesta completa en un archivo para inspección
    const fs = await import('fs/promises')
    await fs.writeFile(
      'test-impostor-phases-response.json',
      JSON.stringify(data, null, 2),
      'utf-8'
    )
    console.log('💾 Respuesta completa guardada en test-impostor-phases-response.json')

  } catch (error) {
    console.error('❌ Error al ejecutar el test:')
    if (error instanceof Error) {
      console.error(`   ${error.message}`)
      if (error.cause) {
        console.error(`   Causa: ${error.cause}`)
      }
    } else {
      console.error(error)
    }
    
    console.log('\n💡 Asegúrate de que:')
    console.log('   1. El servidor esté corriendo (npm run dev)')
    console.log('   2. Las variables de entorno estén configuradas (.env)')
    console.log('   3. El roomId tenga jugadores en Supabase')
    console.log('   4. El puerto sea el correcto (default: 3001)')
    
    process.exit(1)
  }
}

// Ejecutar el test
testGenerateImpostorPhases()

