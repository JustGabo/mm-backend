import dotenv from 'dotenv'
import * as fs from 'fs/promises'

// Cargar variables de entorno
dotenv.config({ path: '.env.local' })
dotenv.config()

const SERVER_PORT = process.env.PORT || 3001
const API_URL = process.env.API_URL || `http://localhost:${SERVER_PORT}`
const ENDPOINT = `${API_URL}/api/generate-impostor-phases`

// ID de sala de prueba (debe existir en Supabase con jugadores)
// IMPORTANTE: Cambiar por un roomId real de tu base de datos
const testRoomId = process.env.TEST_ROOM_ID || 'test-room-id'

// Si quieres forzar un número específico de sospechosos, úsalo aquí
// Si es null, usará el número real de jugadores en la sala
const FORCE_SUSPECTS_COUNT = 3

// Health check
async function checkServerHealth() {
  const portsToTry = [SERVER_PORT, 3000, 3001].filter(
    (port, index, self) => self.indexOf(port) === index
  )

  for (const port of portsToTry) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`)
      if (res.ok) {
        console.log(`✅ Servidor activo en puerto ${port}`)
        return { running: true, port }
      }
    } catch {
      continue
    }
  }

  return { running: false, port: null }
}

// Función para obtener jugadores de la sala desde Supabase
async function getRoomPlayersCount(roomId: string): Promise<number> {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️  No se encontraron credenciales de Supabase, no se puede obtener número de jugadores')
      return 0
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)
    
    const { data, error } = await supabase
      .from('players')
      .select('id')
      .eq('room_id', roomId)
    
    if (error) {
      console.warn(`⚠️  No se pudo obtener jugadores de la sala: ${error.message}`)
      return 0
    }
    
    return data?.length || 0
  } catch (error) {
    console.warn('⚠️  No se pudo obtener número de jugadores:', error instanceof Error ? error.message : 'Unknown error')
    return 0
  }
}

async function testGenerateImpostorPhases() {
  // Declarar testData fuera del try para que esté disponible en el catch
  let testData: any = null
  
  try {
    console.log('\n🧪 TEST → generate-impostor-phases\n')

    // Health check
    const health = await checkServerHealth()
    if (!health.running) {
      console.error('❌ Servidor no está corriendo. Por favor inicia el servidor primero.')
      process.exit(1)
    }

    // Determinar número de sospechosos
    let suspectsCount = FORCE_SUSPECTS_COUNT
    
    if (!suspectsCount) {
      // Si no se fuerza un número, obtenerlo de la sala
      console.log(`📋 Obteniendo jugadores de la sala ${testRoomId}...`)
      const roomPlayersCount = await getRoomPlayersCount(testRoomId)
      
      if (roomPlayersCount === 0) {
        console.warn(`⚠️  No se encontraron jugadores en la sala ${testRoomId}`)
        console.warn(`   El endpoint puede funcionar igual, generará nombres para los jugadores`)
        console.warn(`   Para probar la solución multi-step, usa: FORCE_SUSPECTS_COUNT=10`)
        console.log(`\n📋 Usando 10 sospechosos por defecto para probar la solución multi-step...`)
        suspectsCount = 10
      } else {
        suspectsCount = roomPlayersCount
        console.log(`✅ Se encontraron ${suspectsCount} jugadores en la sala`)
        console.log(`📋 Usando ${suspectsCount} sospechosos (número de jugadores en la sala)`)
        console.log(`💡 Tip: Si quieres probar con más sospechosos, usa FORCE_SUSPECTS_COUNT=10 en .env`)
      }
    } else {
      console.log(`📋 Número de sospechosos forzado: ${suspectsCount}`)
      console.log(`⚠️  Nota: Si hay menos jugadores en la sala, el endpoint generará nombres para los adicionales`)
    }

    // Probar con customContext como canon del escenario (modo impostor)
    testData = {
      roomId: testRoomId,
      caseType: 'asesinato',
      suspects: suspectsCount,
      clues: 8,
      customContext: `Biblioteca del hotel. El cadáver está en la biblioteca del hotel, una habitación rectangular con estanterías de madera oscura hasta el techo. Una chimenea apagada ocupa una pared. Hay dos sillones, una mesa baja y un escritorio antiguo junto a la ventana. La víctima es León Ferrer, 54 años, empresario cultural y dueño de una valiosa colección privada de manuscritos antiguos. Estaba hospedado en la habitación 6, pero fue hallado aquí.

🩸 El cuerpo
León Ferrer yace en el suelo, de costado, cerca del escritorio. No hay señales de lucha violenta. No hay sangre visible en exceso. La causa de muerte aún no es oficial, pero a simple vista no parece un disparo ni una puñalada. Su rostro está relajado… casi como si no hubiera anticipado lo que ocurrió. En su mano derecha sostiene un botón oscuro, suelto, sin hilo.

🕰️ Detalles importantes del entorno
El reloj de pared de la biblioteca está detenido en 11:20 p.m.
Una taza de té frío está sobre el escritorio.
La ventana está cerrada por dentro.
La puerta no estaba con llave cuando se encontró el cuerpo.
No hay signos de robo inmediato: su reloj y su billetera siguen con él.

🏨 Quiénes estaban en el hotel anoche
Además de la víctima y ustedes (los jugadores), solo había cuatro personas más en el hotel durante la noche: el dueño del hotel, una huésped habitual, un empleado, y una persona que llegó el mismo día que León. Todos estaban presentes cuando el cuerpo fue descubierto. Nadie abandonó el hotel. Nadie pudo entrar ni salir.`,
      difficulty: 'normal',
      style: 'realistic' as const,
      language: 'es' // Español
    }

    console.log('🧪 Testing generate-impostor-phases endpoint...')
    console.log(`📋 Test data:`, JSON.stringify(testData, null, 2))
    console.log(`\n📡 Sending request to ${ENDPOINT}...`)

    const startTime = Date.now()
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData),
    })

    const endTime = Date.now()
    const duration = (endTime - startTime) / 1000

    console.log(`\n⏱️  Request completed in ${duration.toFixed(2)}s`)
    console.log(`📊 Status: ${response.status} ${response.statusText}`)

    let data: any
    try {
      data = await response.json()
    } catch (jsonError) {
      // Si falla el parse, guardar la respuesta raw
      const textData = await response.text()
      await fs.writeFile(
        'test-impostor-phases-response-raw.txt',
        textData,
        'utf-8'
      )
      console.error('❌ Error parsing JSON response')
      console.error('💾 Raw response saved to test-impostor-phases-response-raw.txt')
      throw jsonError
    }

    // Always save the raw response for inspection
    await fs.writeFile(
      'test-impostor-phases-response.json',
      JSON.stringify(data, null, 2),
      'utf-8'
    )
    console.log('\n💾 Raw response saved to test-impostor-phases-response.json')

    if (!response.ok) {
      console.error('❌ Error en respuesta')
      console.error(JSON.stringify(data, null, 2))
      await fs.writeFile(
        'test-impostor-phases-error.json',
        JSON.stringify({ error: 'Server responded with error', details: data }, null, 2),
        'utf-8'
      )
      process.exit(1)
    }

    // Validaciones
    console.log('\n✅ Validating response...')

    // 1. Validar estructura básica
    if (!data.caseTitle) {
      throw new Error('Missing caseTitle')
    }
    console.log(`   ✅ caseTitle: "${data.caseTitle}"`)

    if (!data.caseDescription) {
      throw new Error('Missing caseDescription')
    }
    console.log(`   ✅ caseDescription: "${data.caseDescription.substring(0, 50)}..."`)

    // 2. Validar víctima
    if (!data.victim || !data.victim.name) {
      throw new Error('Missing victim')
    }
    console.log(`   ✅ Victim: ${data.victim.name}`)

    // 3. Validar jugadores
    if (!data.players || !Array.isArray(data.players)) {
      throw new Error('Missing players array')
    }

    // Validar que el número de jugadores coincida (puede ser diferente si hay menos en la sala)
    if (data.players.length !== testData.suspects) {
      console.warn(`   ⚠️  Warning: Expected ${testData.suspects} players, got ${data.players.length}`)
      console.warn(`   ℹ️  This is OK if there are fewer players in the room than requested`)
    } else {
      console.log(`   ✅ Players: ${data.players.length} (expected ${testData.suspects})`)
    }

    // 4. Validar que cada jugador tenga las 4 fases
    data.players.forEach((player: any, index: number) => {
      if (!player.phase1) {
        throw new Error(`Player ${index + 1} missing phase1`)
      }
      if (!player.phase1.name) {
        throw new Error(`Player ${index + 1} missing phase1.name`)
      }
      if (!player.phase1.occupation) {
        throw new Error(`Player ${index + 1} missing phase1.occupation`)
      }

      if (!player.phase2) {
        throw new Error(`Player ${index + 1} missing phase2`)
      }
      if (!player.phase2.observations || !Array.isArray(player.phase2.observations)) {
        throw new Error(`Player ${index + 1} missing phase2.observations`)
      }

      if (!player.phase3) {
        throw new Error(`Player ${index + 1} missing phase3`)
      }
      if (!player.phase3.timeline || !Array.isArray(player.phase3.timeline)) {
        throw new Error(`Player ${index + 1} missing phase3.timeline`)
      }

      if (!player.phase4) {
        throw new Error(`Player ${index + 1} missing phase4`)
      }
      if (typeof player.phase4.isKiller !== 'boolean') {
        throw new Error(`Player ${index + 1} missing phase4.isKiller`)
      }
      if (!player.phase4.whySuspicious) {
        throw new Error(`Player ${index + 1} missing phase4.whySuspicious`)
      }
      if (!player.phase4.alibi) {
        throw new Error(`Player ${index + 1} missing phase4.alibi`)
      }
    })
    console.log(`   ✅ All ${data.players.length} players have all 4 phases`)

    // 5. Validar que haya exactamente un asesino
    const killers = data.players.filter((p: any) => p.phase4.isKiller === true)
    if (killers.length !== 1) {
      throw new Error(`Expected 1 killer, got ${killers.length}`)
    }
    console.log(`   ✅ Exactly one killer: ${killers[0].phase1?.name} (${killers[0].playerId})`)

    // 6. Validar hiddenContext
    if (!data.hiddenContext || !data.hiddenContext.killerId) {
      throw new Error('Missing hiddenContext.killerId')
    }
    console.log(`   ✅ HiddenContext.killerId: ${data.hiddenContext.killerId}`)

    // Verificar que el killerId coincida
    if (killers[0].playerId !== data.hiddenContext.killerId) {
      console.warn(`   ⚠️  Warning: killer playerId (${killers[0].playerId}) doesn't match hiddenContext.killerId (${data.hiddenContext.killerId})`)
    } else {
      console.log(`   ✅ Killer playerId matches hiddenContext.killerId`)
    }

    // 7. Validar arma (si es asesinato)
    if (testData.caseType === 'asesinato') {
      if (!data.weapon) {
        throw new Error('Missing weapon for murder case')
      }
      console.log(`   ✅ Weapon: ${data.weapon.name}`)
    }

    // 8. Validar config
    if (!data.config) {
      throw new Error('Missing config')
    }
    console.log(`   ✅ Config: ${JSON.stringify(data.config)}`)
    
    // 9. Validar customScenario si está presente
    if (testData.customScenario) {
      if (!data.config?.customScenario) {
        throw new Error('❌ customScenario no está en la respuesta')
      }
      const received = data.config.customScenario
      if (received.place !== testData.customScenario.place) {
        throw new Error(`❌ customScenario.place no coincide: esperado "${testData.customScenario.place}", recibido "${received.place}"`)
      }
      if (testData.customScenario.themeOrSituation && received.themeOrSituation !== testData.customScenario.themeOrSituation) {
        throw new Error(`❌ customScenario.themeOrSituation no coincide: esperado "${testData.customScenario.themeOrSituation}", recibido "${received.themeOrSituation}"`)
      }
      console.log(`   ✅ Custom scenario válido: "${received.place}"${received.themeOrSituation ? ` - "${received.themeOrSituation}"` : ''}`)
    } else if ('scenario' in testData && testData.scenario) {
      if (data.config?.scenario !== testData.scenario) {
        throw new Error(`❌ scenario no coincide: esperado "${testData.scenario}", recibido "${data.config?.scenario}"`)
      }
      console.log(`   ✅ Scenario válido: "${data.config.scenario}"`)
    }

    // 10. Validar customContext si está presente
    if (testData.customContext) {
      if (!data.config?.customContext) {
        throw new Error('❌ customContext no está en la respuesta')
      }
      if (data.config.customContext.trim() !== testData.customContext.trim()) {
        throw new Error('❌ customContext no coincide con el enviado')
      }
      console.log(`   ✅ Custom context válido (devuelto en config)`)
      // Verificación suave: que la víctima o el caso reflejen el contexto (biblioteca, León Ferrer, etc.)
      const victimName = (data.victim?.name || '').toLowerCase()
      const caseDesc = (data.caseDescription || '').toLowerCase()
      const caseTitle = (data.caseTitle || '').toLowerCase()
      if (victimName.includes('león') || victimName.includes('leon') || caseDesc.includes('biblioteca') || caseDesc.includes('hotel') || caseTitle.includes('biblioteca') || caseTitle.includes('hotel')) {
        console.log(`   ✅ Caso coherente con customContext (víctima/ubicación mencionados)`)
      } else {
        console.log(`   ℹ️  Caso generado; revisar test-impostor-phases-response.json para coherencia con customContext`)
      }
    }

    // Resumen
    console.log('\n' + '='.repeat(60))
    console.log('✅ ALL VALIDATIONS PASSED!')
    console.log('='.repeat(60))
    console.log(`\n📊 Summary:`)
    console.log(`   - Case: "${data.caseTitle}"`)
    console.log(`   - Players: ${data.players.length}`)
    console.log(`   - Killer: ${killers[0].phase1?.name} (${killers[0].playerId})`)
    console.log(`   - Victim: ${data.victim.name}`)
    console.log(`   - Duration: ${duration.toFixed(2)}s`)
    console.log(`\n💾 Full response saved to: test-impostor-phases-response.json`)

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    if (error instanceof Error) {
      console.error(`   Error message: ${error.message}`)
    }
    
    // Guardar información del error también
    try {
      await fs.writeFile(
        'test-impostor-phases-error.json',
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          testData: testData || null,
        }, null, 2),
        'utf-8'
      )
      console.log('💾 Error details saved to test-impostor-phases-error.json')
    } catch (writeError) {
      // Ignorar errores al escribir el archivo de error
    }
    
    process.exit(1)
  }
}

// Ejecutar test
testGenerateImpostorPhases().catch((error) => {
  console.error('❌ Test execution failed:', error)
  process.exit(1)
})
