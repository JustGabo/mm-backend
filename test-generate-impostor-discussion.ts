/**
 * Script de prueba para verificar que el endpoint de generar discusión impostor funciona
 * 
 * Uso:
 *   npm run test:impostor-discussion
 *   o
 *   npx tsx test-generate-impostor-discussion.ts
 */

import dotenv from 'dotenv'

// Cargar .env.local primero (si existe), luego .env
dotenv.config({ path: '.env.local' })
dotenv.config() // .env tiene prioridad sobre .env.local

// Usar el mismo puerto que el servidor (lee PORT del .env)
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

  // Usar el puerto donde encontramos el servidor
  const actualPort = serverStatus.port || SERVER_PORT
  const actualApiUrl = `http://localhost:${actualPort}`
  const actualEndpoint = `${actualApiUrl}/api/generate-impostor-discussion`
  
  console.log(`📍 Endpoint: ${actualEndpoint}\n`)

  // Datos de prueba (simula un caso impostor ya generado)
  const testData = {
    roundNumber: 1,
    caseContext: {
      caseTitle: 'El Misterio en la Mansión',
      caseDescription: 'Un asesinato ha ocurrido en una mansión',
      caseType: 'asesinato',
      scenario: 'mansion',
      difficulty: 'normal',
      victim: {
        name: 'Ricardo Martínez',
        age: 50,
        role: 'Propietario',
        description: 'Un hombre carismático'
      },
      players: [
        { id: 'player-1', name: 'Ana', role: 'Sumeller', isKiller: false },
        { id: 'player-2', name: 'Carlos', role: 'Empresario', isKiller: true },
        { id: 'player-3', name: 'María', role: 'Ama de llaves', isKiller: false },
        { id: 'player-4', name: 'Luis', role: 'Mayordomo', isKiller: false }
      ],
      killerId: 'player-2'
    },
    discussionHistory: [],
    allPlayersInfo: [
      {
        id: 'player-1',
        name: 'Ana',
        role: 'Sumeller',
        alibi: 'Estaba en la bodega',
        location: 'Bodega',
        whereWas: 'En la bodega revisando vinos',
        whatDid: 'Revisó inventario de vinos',
        whySuspicious: 'Nadie la vio durante 20 minutos',
        isKiller: false
      },
      {
        id: 'player-2',
        name: 'Carlos',
        role: 'Empresario',
        alibi: 'Reunión de negocios',
        location: 'Oficina',
        whereWas: 'Afirmó estar en reunión',
        whatDid: 'Reunión de negocios',
        suspiciousBehavior: 'No hay registros de la reunión',
        whySuspicious: 'Coartada no verificable',
        isKiller: true
      },
      {
        id: 'player-3',
        name: 'María',
        role: 'Ama de llaves',
        alibi: 'Limpiando piso de arriba',
        location: 'Piso superior',
        whereWas: 'Piso superior limpiando',
        whatDid: 'Tareas de limpieza',
        whySuspicious: 'No la vieron en el piso superior',
        isKiller: false
      },
      {
        id: 'player-4',
        name: 'Luis',
        role: 'Mayordomo',
        alibi: 'Organizando eventos',
        location: 'Salón principal',
        whereWas: 'En el salón',
        whatDid: 'Preparando evento',
        whySuspicious: 'Fue quien encontró el cuerpo',
        isKiller: false
      }
    ],
    language: 'es'
  }

  console.log('📤 Enviando petición con los siguientes datos:')
  console.log(`   Round: ${testData.roundNumber}`)
  console.log(`   Case: ${testData.caseContext.caseTitle}`)
  console.log(`   Players: ${testData.caseContext.players.length}`)
  console.log(`   Killer: ${testData.caseContext.killerId}`)
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
      process.exit(1)
    }

    const data = await response.json()

    console.log('✅ Respuesta exitosa!\n')
    console.log('📋 Resumen de la discusión generada:')
    console.log(`   ID: ${data.id}`)
    console.log(`   Título: ${data.title}`)
    console.log(`   Tipo: ${data.type}`)
    console.log(`   Contenido: ${data.content.substring(0, 100)}...`)
    if (data.context) {
      console.log(`   Contexto: ${data.context.substring(0, 100)}...`)
    }
    console.log(`   Sugerencias: ${data.suggestions.length}`)
    if (data.targetedPlayers && data.targetedPlayers.length > 0) {
      console.log(`   Jugadores objetivo: ${data.targetedPlayers.join(', ')}`)
    }

    console.log('\n💡 Sugerencias:')
    data.suggestions.forEach((suggestion: string, index: number) => {
      console.log(`   ${index + 1}. ${suggestion}`)
    })

    console.log('\n✅ Test completado exitosamente!')
    
    // Guardar respuesta completa en un archivo para inspección
    const fs = await import('fs/promises')
    await fs.writeFile(
      'test-impostor-discussion-response.json',
      JSON.stringify(data, null, 2),
      'utf-8'
    )
    console.log('💾 Respuesta completa guardada en test-impostor-discussion-response.json')

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
    console.log('   3. El puerto sea el correcto (default: 3001)')
    
    process.exit(1)
  }
}

// Ejecutar el test
testGenerateImpostorDiscussion()


