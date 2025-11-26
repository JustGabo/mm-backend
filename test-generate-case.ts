/**
 * Script de prueba para verificar que el endpoint de generar caso inicial funciona
 * 
 * Uso:
 *   npm run test:case
 *   o
 *   npx tsx test-generate-case.ts
 */

import dotenv from 'dotenv'

// Cargar .env.local primero (si existe), luego .env
dotenv.config({ path: '.env.local' })
dotenv.config() // .env tiene prioridad sobre .env.local

// Usar el mismo puerto que el servidor
const SERVER_PORT = process.env.PORT || 3001
const API_URL = process.env.API_URL || `http://localhost:${SERVER_PORT}`
const ENDPOINT = `${API_URL}/api/generate-initial-case`

async function checkServerHealth() {
  // Intentar primero con el puerto configurado, luego 3000, luego 3001
  const portsToTry = [SERVER_PORT, 3000, 3001].filter((port, index, self) => self.indexOf(port) === index)
  
  for (const port of portsToTry) {
    try {
      const testUrl = `http://localhost:${port}/api/health`
      const healthResponse = await fetch(testUrl)
      if (healthResponse.ok) {
        // Actualizar API_URL si encontramos el servidor en otro puerto
        if (port !== SERVER_PORT) {
          console.log(`⚠️  Servidor encontrado en puerto ${port} (configurado: ${SERVER_PORT})`)
          // Actualizar para usar el puerto correcto
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

async function testGenerateInitialCase() {
  console.log('🧪 Iniciando test de generación de caso inicial...\n')

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
    console.log('   - FRONTEND_URL (opcional, solo si hay frontend)\n')
    process.exit(1)
  }

  // Usar el puerto donde encontramos el servidor
  const actualPort = serverStatus.port || SERVER_PORT
  const actualApiUrl = `http://localhost:${actualPort}`
  const actualEndpoint = `${actualApiUrl}/api/generate-initial-case`
  
  console.log(`📍 Endpoint: ${actualEndpoint}\n`)

  // Datos de prueba
  const testData = {
    caseType: 'asesinato',
    suspects: 3,
    clues: 8,
    scenario: 'mansion',
    difficulty: 'normal',
    style: 'realistic' as const,
    language: 'es'
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
      process.exit(1)
    }

    const data = await response.json()

    console.log('✅ Respuesta exitosa!\n')
    console.log('📋 Resumen del caso generado:')
    console.log(`   Título: ${data.caseTitle}`)
    console.log(`   Tipo: ${data.config.caseType}`)
    console.log(`   Escenario: ${data.config.scenario}`)
    console.log(`   Dificultad: ${data.config.difficulty}`)
    console.log(`   Víctima: ${data.victim.name} (${data.victim.role})`)
    console.log(`   Sospechosos: ${data.suspects.length}`)
    console.log(`   Arma: ${data.weapon?.name || 'N/A'}`)
    console.log(`   Culpable (oculto): ${data.hiddenContext.guiltyId}\n`)

    console.log('👥 Sospechosos:')
    data.suspects.forEach((suspect: any, index: number) => {
      const isGuilty = suspect.id === data.hiddenContext.guiltyId
      console.log(`   ${index + 1}. ${suspect.name} (${suspect.role}, ${suspect.age} años) ${isGuilty ? '🔴 [CULPABLE]' : ''}`)
    })

    console.log('\n🔍 Detalles del caso:')
    console.log(`   Descripción: ${data.caseDescription.substring(0, 100)}...`)
    
    if (data.victim.causeOfDeath) {
      console.log(`   Causa de muerte: ${data.victim.causeOfDeath}`)
    }
    
    console.log(`   Ubicación: ${data.victim.location || 'N/A'}`)
    console.log(`   Descubierto por: ${data.victim.discoveredBy || 'N/A'}`)

    console.log('\n✅ Test completado exitosamente!')
    
    // Guardar respuesta completa en un archivo para inspección
    const fs = await import('fs/promises')
    await fs.writeFile(
      'test-response.json',
      JSON.stringify(data, null, 2),
      'utf-8'
    )
    console.log('💾 Respuesta completa guardada en test-response.json')

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
testGenerateInitialCase()

