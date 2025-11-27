import { Router, Request, Response } from 'express'
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

export const generateRoundRouter = Router()

export interface RoundGenerationRequest {
  roundNumber: number // 1-10
  caseContext: {
    caseTitle: string
    caseDescription: string
    caseType: string
    scenario: string
    difficulty: string
    victim: any
    suspects: any[]
    weapon?: any
    guiltyId: string // ID del culpable (NO se muestra al usuario)
    guiltyReason: string
    keyClues: string[]
  }
  decisionHistory: Array<{
    roundNumber: number
    title: string
    selectedOption: string
    result: string
    discoveredEvidence?: string[]
    revealsInfo?: string
  }>
  discardedSuspects?: string[] // IDs de sospechosos descartados por el jugador
  language?: string
}

export interface RoundResponse {
  id: number
  title: string
  narrative: string
  options: Array<{
    id: string
    text: string
    result: string
    correct: boolean // Si esta opción apunta más al culpable
    discoversEvidence?: string[] // IDs de evidencia descubierta
    revealsInfo?: string // Información revelada
  }>
}

generateRoundRouter.post('/', async (req: Request, res: Response) => {
  try {
    console.log('API Route: generate-round called')
    
    const body: RoundGenerationRequest = req.body
    console.log(`Request for round ${body.roundNumber}`)
    
    // Validate required fields
    if (!body.roundNumber || !body.caseContext || !body.decisionHistory) {
      return res.status(400).json(
        { error: 'Missing required fields' }
      )
    }

    const { language = 'es' } = body

    // Crear prompt para OpenAI
    const prompt = createRoundPrompt(body, language)

    console.log(`🤖 Calling OpenAI for round ${body.roundNumber} generation...`)
    
    const openai = getOpenAIClient()
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Genera rondas de investigación. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Mantén el culpable fijo. Una opción correcta, otras falsas. Usa nombres específicos, no genéricos. Dificultad: FÁCIL=directo, NORMAL=ambiguo, DIFÍCIL=sutil. Responde SOLO JSON válido.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    })

    const response = completion.choices[0]?.message?.content
    if (!response) {
      throw new Error('No response from OpenAI')
    }

    console.log('✅ OpenAI response received')

    // Parsear respuesta (ya viene como JSON válido con response_format)
    let roundData: RoundResponse
    try {
      roundData = JSON.parse(response)
    } catch (parseError) {
      // Fallback: limpiar si viene con markdown
      const cleanedResponse = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim()
      roundData = JSON.parse(cleanedResponse)
    }
    
    console.log(`✅ Round ${body.roundNumber} generated successfully`)
    console.log(`   Options: ${roundData.options.length}`)

    return res.json(roundData)
    
  } catch (error) {
    console.error('Error in generate-round API:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    return res.status(500).json(
      { 
        error: 'Failed to generate round',
        details: errorMessage,
      }
    )
  }
})

function createRoundPrompt(
  request: RoundGenerationRequest,
  language: string
): string {
  const { roundNumber, caseContext, decisionHistory, discardedSuspects = [] } = request

  // 🗑️ Filtrar sospechosos activos (no descartados)
  const activeSuspects = caseContext.suspects.filter(
    (s: any) => !discardedSuspects.includes(s.id)
  );
  const discardedSuspectsNames = caseContext.suspects
    .filter((s: any) => discardedSuspects.includes(s.id))
    .map((s: any) => s.name)
    .join(', ');

  // Analizar decisiones previas para evitar repeticiones
  const interrogatedSuspects = new Set<string>();
  const investigationTypes = new Set<string>();
  
  decisionHistory.forEach(h => {
    // Detectar si se interrogó a alguien
    const suspectNames = caseContext.suspects.map((s: any) => s.name);
    suspectNames.forEach((name: string) => {
      if (h.title.toLowerCase().includes(name.toLowerCase()) || 
          h.selectedOption.toLowerCase().includes(name.toLowerCase())) {
        if (h.title.toLowerCase().includes('entrevist') || 
            h.title.toLowerCase().includes('interroga') ||
            h.selectedOption.toLowerCase().includes('entrevist') || 
            h.selectedOption.toLowerCase().includes('interroga')) {
          interrogatedSuspects.add(name);
        }
      }
    });
    
    // Detectar tipo de investigación
    if (h.title.toLowerCase().includes('entrevist') || h.title.toLowerCase().includes('interroga')) {
      investigationTypes.add('interrogatorio');
    } else if (h.title.toLowerCase().includes('analiz') || h.title.toLowerCase().includes('examin')) {
      investigationTypes.add('análisis');
    } else if (h.title.toLowerCase().includes('revisar') || h.title.toLowerCase().includes('buscar')) {
      investigationTypes.add('búsqueda');
    }
  });

  // Resumen de decisiones previas
  const historyText = decisionHistory.length > 0
    ? decisionHistory.map(h => `
Ronda ${h.roundNumber}: ${h.title}
- Opción elegida: ${h.selectedOption}
- Resultado: ${h.result}
${h.revealsInfo ? `- Información revelada: ${h.revealsInfo}` : ''}
${h.discoveredEvidence ? `- Evidencia descubierta: ${h.discoveredEvidence.join(', ')}` : ''}
`).join('\n')
    : 'Esta es la primera ronda, no hay decisiones previas.'

  const interrogatedList = Array.from(interrogatedSuspects).join(', ');
  const avoidRepetitionNote = interrogatedSuspects.size > 0 
    ? `\n⚠️ **SOSPECHOSOS YA INTERROGADOS (NO volver a interrogar):** ${interrogatedList}\n` 
    : '';
  
  const lastInvestigationType = decisionHistory.length > 0 
    ? (decisionHistory[decisionHistory.length - 1].title.toLowerCase().includes('entrevist') || 
       decisionHistory[decisionHistory.length - 1].title.toLowerCase().includes('interroga')
        ? '⚠️ La ronda anterior fue un INTERROGATORIO - esta ronda debe ser ANÁLISIS DE EVIDENCIA\n'
        : '')
    : '';

  // Obtener información del culpable para las instrucciones
  const guiltySuspect = caseContext.suspects.find((s: any) => s.id === caseContext.guiltyId)
  const guiltyRole = guiltySuspect?.role || ''
  const guiltyMotive = guiltySuspect?.motive || ''
  const isGuiltyStaff = guiltyRole && (
    guiltyRole.toLowerCase().includes('mayordomo') ||
    guiltyRole.toLowerCase().includes('cocinero') ||
    guiltyRole.toLowerCase().includes('limpieza') ||
    guiltyRole.toLowerCase().includes('personal') ||
    guiltyRole.toLowerCase().includes('empleado') ||
    guiltyRole.toLowerCase().includes('asistente') ||
    guiltyRole.toLowerCase().includes('sirviente') ||
    guiltyRole.toLowerCase().includes('camarero') ||
    guiltyRole.toLowerCase().includes('sumiller') ||
    guiltyRole.toLowerCase().includes('jardinero') ||
    guiltyRole.toLowerCase().includes('chofer') ||
    guiltyRole.toLowerCase().includes('seguridad')
  )

  // Información del culpable (SOLO para coherencia, NO para revelar)
  const guiltyInfo = `
**⚠️ CULPABLE FIJO (INFORMACIÓN CONFIDENCIAL - NO REVELAR):**
- ID del culpable: ${caseContext.guiltyId}
- Nombre: ${guiltySuspect?.name || 'N/A'}
- Rol: ${guiltyRole}
- Motivo: ${guiltyMotive}
- Razón: ${caseContext.guiltyReason}
- Pistas clave: ${caseContext.keyClues.join(', ')}

**REGLAS CRÍTICAS SOBRE EL CULPABLE:**
- ⚠️ **MOTIVO MÁS FUERTE:** El culpable tiene el motivo MÁS FUERTE de todos los sospechosos
- ⚠️ **PISTAS SOBRE PERSONAL:** ${isGuiltyStaff ? 'El culpable ES del personal, así que las pistas sobre personal son válidas.' : 'El culpable NO es del personal. Si generas pistas que sugieren que el culpable es alguien del personal, estas deben ser PISTAS FALSAS o MENOS RELEVANTES que el motivo del culpable. El motivo del culpable debe ser tan fuerte que el jugador pueda descartar pistas sobre personal como menos importantes.'}
- Rondas 1-6: NO dar pistas sobre el culpable. Investiga a TODOS los sospechosos equitativamente.
- Rondas 7-9: Pistas MUY sutiles, mezcladas con pistas falsas de otros sospechosos. Si mencionas "personal", debe ser ambiguo y el motivo del culpable debe ser más fuerte.
- Ronda 10: Pistas más fuertes pero aún requieren deducción del jugador. El motivo del culpable debe destacar como el más convincente.
- NUNCA hagas obvio quién es el culpable hasta que el jugador haga su acusación final.
- Las opciones "correctas" deben dar información útil, NO revelar directamente al culpable.
- ⚠️ **IMPORTANTE:** Si el culpable NO es del personal, las pistas que sugieren "alguien del personal" deben ser menos relevantes que el motivo del culpable. El jugador debe poder pensar "Vale, la pista dice que pudo haber sido alguien del personal, pero el motivo de [culpable] es mucho más fuerte, así que esa pista puede ser falsa o menos importante."
`

  // Definir el tipo de ronda según el número
  let roundType = ''
  let roundGuidance = ''

  if (roundNumber <= 3) {
    roundType = 'EXPLORACIÓN INICIAL'
    roundGuidance = `
**ENFOQUE: Exploración de la escena y evidencia física**
- ⚠️ NO interrogues a sospechosos directamente en estas rondas iniciales
- Establece el escenario y contexto general del caso
- Presenta evidencia física y detalles ambientales
- ⚠️ NO enfoques en el culpable, explora el crimen en general

**TIPOS DE ACCIONES (Elige 2 diferentes):**
- 🔍 "Examinar el área donde se encontró el cuerpo"
- 📱 "Revisar el celular/mensajes de la víctima"
- 🚪 "Inspeccionar las entradas y salidas del lugar"
- 📋 "Revisar documentos personales de la víctima"
- 🎥 "Revisar cámaras de seguridad (si aplica)"
- 🔑 "Buscar objetos fuera de lugar en la escena"
- 🩸 "Analizar manchas de sangre u otras marcas"

**IMPORTANTE:** NO menciones nombres de sospechosos en las opciones de estas rondas
`
  } else if (roundNumber <= 6) {
    roundType = 'ENTREVISTAS Y ANÁLISIS'
    roundGuidance = `
**ENFOQUE: Mix de entrevistas Y análisis de evidencia**
- ⚠️ NO interrogues al mismo sospechoso más de una vez en todo el juego
- Alterna entre entrevistar personas y analizar evidencia física
- Revela información sobre coartadas de MÚLTIPLES sospechosos (no solo el culpable)
- ⚠️ Haz que TODOS los sospechosos parezcan sospechosos, no solo uno

**TIPOS DE ACCIONES (Varía - NO siempre interrogatorios):**
- 👤 "Entrevistar a [Nombre]" (máximo en 1 de cada 3 rondas)
- 📱 "Revisar registros telefónicos de la víctima"
- 💬 "Analizar conversaciones/emails recientes"
- 🔍 "Verificar coartada de [Nombre] con evidencia física"
- 🗓️ "Revisar la agenda/calendario de la víctima"
- 💰 "Investigar movimientos financieros recientes"
- 🎭 "Observar interacciones entre sospechosos"

**CRÍTICO:** Si en la ronda anterior interrogaste a alguien, en esta ronda ANALIZA EVIDENCIA
`
  } else if (roundNumber <= 9) {
    roundType = 'ANÁLISIS PROFUNDO Y DEDUCCIONES'
    roundGuidance = `
**ENFOQUE: Conectar pistas y analizar patrones**
- ⚠️ PRIORIZA análisis de evidencia sobre interrogatorios
- Presenta evidencia que podría apuntar a varios sospechosos
- ⚠️ Crea dudas sobre TODOS, no confirmes sospechas sobre uno
- Las pistas deben ser ambiguas y requerir deducción del jugador

**TIPOS DE ACCIONES (Enfoque analítico):**
- 🔬 "Analizar evidencia forense (huellas, ADN, fibras)"
- ⏱️ "Reconstruir la línea temporal del crimen"
- 🧩 "Conectar pistas descubiertas anteriormente"
- 📊 "Comparar testimonios en busca de contradicciones"
- 🗺️ "Analizar movimientos de todos los sospechosos esa noche"
- 🔐 "Revisar quién tenía acceso a [lugar clave]"
- 💡 "Analizar el motivo más probable del crimen"
- 📸 "Estudiar fotos de la escena del crimen"

**IMPORTANTE:** Evita mencionar nombres específicos en las opciones, usa descripciones generales
`
  } else {
    roundType = 'RONDA FINAL - DEDUCCIÓN'
    roundGuidance = `
**ENFOQUE: Revisión final y conexión de pistas**
- ⚠️ NO interrogues a nadie - esta ronda es de ANÁLISIS FINAL
- Presenta pistas finales que conectan SUTILMENTE con el culpable
- Las pistas deben requerir que el jugador conecte información previa
- ⚠️ Mantén la ambigüedad - aún debe haber dudas

**TIPOS DE ACCIONES (Solo análisis, NO interrogatorios):**
- 🧠 "Revisar todas las pistas descubiertas hasta ahora"
- 🔍 "Hacer una última inspección de la escena del crimen"
- 📝 "Analizar inconsistencias en las coartadas"
- 🎯 "Identificar quién tenía el motivo más fuerte"
- 🔑 "Revisar quién tenía oportunidad real de cometer el crimen"
- 💭 "Conectar los rasgos del culpable con las pistas"

**CRÍTICO:** Esta ronda debe ser reflexiva, NO confrontativa
`
  }

  // 🎯 DISTRIBUCIÓN EQUITATIVA DE SOSPECHOSOS
  // Usar solo sospechosos ACTIVOS (no descartados por el jugador)
  const totalSuspects = activeSuspects.length
  const suspectsPerRound = Math.ceil(totalSuspects / 10) // Distribuir entre 10 rondas
  const startIndex = ((roundNumber - 1) * suspectsPerRound) % totalSuspects
  const endIndex = Math.min(startIndex + suspectsPerRound, totalSuspects)
  const focusSuspects = activeSuspects.slice(startIndex, endIndex)
  
  // Incluir al culpable solo en rondas específicas para mantener coherencia
  const shouldIncludeGuilty = roundNumber % 4 === 0 || roundNumber >= 8
  const guilty = activeSuspects.find((s: any) => s.id === caseContext.guiltyId)
  
  const suspectsForThisRound = shouldIncludeGuilty && guilty && !focusSuspects.find((s: any) => s.id === guilty.id)
    ? [...focusSuspects, guilty]
    : focusSuspects

  // 🗑️ Información sobre sospechosos descartados
  const discardedInfo = discardedSuspects.length > 0 ? `
⚠️ **SOSPECHOSOS DESCARTADOS POR EL JUGADOR:**
Los siguientes sospechosos fueron descartados y NO deben aparecer en las opciones: ${discardedSuspectsNames}
- NO incluyas estos sospechosos en las opciones de investigación
- NO menciones estos sospechosos en los resultados
- La investigación ahora se centra SOLO en los sospechosos activos
` : '';

  const suspectDistribution = `
**🎯 DISTRIBUCIÓN DE SOSPECHOSOS PARA ESTA RONDA:**
Esta ronda debe enfocarse en investigar a: ${suspectsForThisRound.map((s: any) => s.name).join(', ')}

⚠️ **CRÍTICO - DISTRIBUCIÓN EQUITATIVA:**
- Las opciones deben involucrar a los sospechosos listados arriba
- Trata a TODOS los sospechosos como igualmente sospechosos
- NO hagas que uno destaque más que otros en esta ronda
- Si el culpable está en la lista, NO lo hagas más obvio que los demás
- Ambas opciones deben parecer igualmente valiosas para la investigación
- NO uses frases como "esto es clave" o "información crucial" solo para el culpable

${discardedInfo}
`

  // 🎯 AJUSTE DE DIFICULTAD - MUY IMPORTANTE
  let difficultyGuidance = ''
  const difficulty = caseContext.difficulty.toLowerCase()
  
  if (difficulty === 'facil' || difficulty === 'fácil' || difficulty === 'easy') {
    difficultyGuidance = `
**NIVEL: FÁCIL**
- La opción correcta da pistas más claras (pero NO reveles directamente al culpable)
- El resultado de la opción correcta debe conectar con traits o motivos del culpable
- La opción incorrecta tiene información útil pero menos relevante
- ⚠️ NO menciones nombres en resultados, usa descripciones de roles o traits
- Ejemplo resultado correcto: "Encuentras un objeto que pertenece a alguien con [trait del culpable]"
- Ejemplo resultado incorrecto: "Encuentras un objeto que pertenece al personal de limpieza"
- Las pistas son más directas, pero el jugador aún debe conectar los puntos
`
  } else if (difficulty === 'medio' || difficulty === 'normal' || difficulty === 'medium') {
    difficultyGuidance = `
**NIVEL: NORMAL**
- AMBAS opciones deben dar información útil y parecer igualmente valiosas
- Los resultados deben ser AMBIGUOS - NO mencionar nombres directamente
- La opción correcta debe dar una pista SUTIL que conecta con el culpable
- La opción incorrecta debe apuntar a otro sospechoso o información parcial (confundir)
- ⚠️ CRÍTICO: NO uses frases como "María contradice su coartada" o "El testimonio de [Nombre] no cuadra"
- ✅ CORRECTO: "Alguien del personal estuvo en esa zona" o "Hay inconsistencias en los testimonios"
- Ejemplo resultado correcto: "Encuentras un objeto con [trait] que alguien pudo haber dejado"
- Ejemplo resultado incorrecto: "Encuentras evidencia de que otra persona estuvo en la zona"
- El jugador debe DEDUCIR conectando esta información con lo que ya sabe
- NO hagas obvio qué opción es la "correcta" - ambas deben parecer valiosas
`
  } else {
    difficultyGuidance = `
**NIVEL: DIFÍCIL** 🔥
- ⚠️ **NUNCA menciones nombres de sospechosos en los resultados**
- AMBAS opciones deben parecer igualmente válidas e interesantes
- Los resultados deben ser MUY AMBIGUOS y requieren investigación profunda
- La opción correcta solo da pistas MUY SUTILES e indirectas
- La opción incorrecta también puede revelar información útil (confundir al jugador)
- **Las pistas deben requerir INDAGACIÓN**: referencias vagas, descripciones indirectas, comportamientos sospechosos
- **NO digas directamente quién hizo qué**: usa descripciones ("alguien con acceso al...", "una persona del personal...", "quien estuvo en...")
- Ejemplo resultado correcto: "Encuentras evidencia de que alguien manipuló la escena, los detalles sugieren conocimiento íntimo del lugar"
- Ejemplo resultado incorrecto: "Los testimonios se contradicen en aspectos clave, haciendo difícil determinar la verdad"
- El jugador debe DEDUCIR basándose en traits, roles, motivos y comportamientos
- **Nunca digas**: "María estuvo...", "Carlos admite...", "El testimonio de Juan..."
- **Siempre di**: "Alguien del personal...", "Una persona con [trait]...", "Quien tenía [motivo]..."
`
  }

  return `
Genera la ronda ${roundNumber} de 10 para el caso de misterio.

**CONTEXTO DEL CASO:**
- Título: ${caseContext.caseTitle}
- Tipo: ${caseContext.caseType}
- Escenario: ${caseContext.scenario}
- Dificultad: ${caseContext.difficulty}

${suspectDistribution}

${difficultyGuidance}

**VÍCTIMA:**
- Nombre: ${caseContext.victim.name}
- Rol: ${caseContext.victim.role}
- Causa de muerte: ${caseContext.victim.causeOfDeath || 'N/A'}
- Descripción: ${caseContext.victim.description}

**SOSPECHOSOS:**
${caseContext.suspects.map((s: any) => `
- ${s.name} (ID: ${s.id}): ${s.role}, ${s.age} años
  Motivo: ${s.motive}${s.id === caseContext.guiltyId ? ' ⚠️ [CULPABLE - MOTIVO MÁS FUERTE]' : ''}
  Traits: ${s.traits?.join(', ') || 'N/A'}
`).join('\n')}

⚠️ **IMPORTANTE SOBRE MOTIVOS:**
- El culpable (${guiltySuspect?.name || caseContext.guiltyId}) tiene el motivo MÁS FUERTE de todos (en términos de contenido/convicción, no de longitud)
- Todos los motivos tienen longitud similar, pero el del culpable es más convincente por su contenido
- Si generas pistas que sugieren que el culpable es del personal pero el culpable NO es del personal, esas pistas deben ser MENOS RELEVANTES que el motivo del culpable
- El jugador debe poder pensar: "La pista dice que pudo ser alguien del personal, pero el motivo de [culpable] es mucho más fuerte, así que esa pista puede ser falsa o menos importante"
- El motivo del culpable debe ser tan convincente (por su contenido) que opaquen pistas confusas sobre personal

${guiltyInfo}

**DECISIONES PREVIAS DEL JUGADOR:**
${historyText}
${avoidRepetitionNote}
${lastInvestigationType}

**TIPO DE RONDA ${roundNumber}/10:**
${roundType}

**GUÍA PARA ESTA RONDA:**
${roundGuidance}

**REGLAS PARA LA GENERACIÓN:**

1. **TÍTULO:** Un título corto y atractivo para la ronda
   - Debe reflejar el TIPO DE ACCIÓN, no solo quién se investiga
   - ✅ BUENO: "Revisando el Celular de la Víctima", "Analizando la Escena del Crimen", "Entrevistando a María"
   - ❌ MALO: "Entrevistando a los Sospechosos" (demasiado genérico), "Ronda 3" (sin descripción)
   - VARÍA el tipo de título según la guía de ronda arriba
   - En rondas 1-3: Títulos sobre exploración física ("Examinando...", "Revisando...")
   - En rondas 4-6: Mix de entrevistas y análisis
   - En rondas 7-10: Análisis profundo ("Analizando...", "Conectando...", "Deduciendo...")

2. **NARRATIVA:** 1-2 oraciones CORTAS que establezcan la situación actual
   - Máximo 20-25 palabras
   - Debe ser coherente con las decisiones previas
   - Mantener el misterio y la tensión
   - NO revelar directamente al culpable
   - SER CONCISO Y DIRECTO

3. **OPCIONES:** Genera 2 opciones de investigación
   - Cada opción debe tener un "text" (acción a tomar)
   - Cada opción debe tener un "result" (consecuencia de la acción)
   - **UNA opción debe ser "correct": true** (apunta más al culpable)
   - **La otra opción debe ser "correct": false** (pista falsa o menos relevante)
   
   **🎭 VARIEDAD DE ACCIONES (MUY IMPORTANTE):**
   - ⚠️ NO hagas que AMBAS opciones sean interrogatorios a personas
   - ⚠️ Máximo 1 interrogatorio por ronda (la otra debe ser análisis/búsqueda)
   - ✅ MEJOR: Una opción interroga, la otra analiza evidencia
   - ✅ MEJOR AÚN: Ambas opciones analizan evidencia sin mencionar nombres
   - Consulta la guía de ronda arriba para tipos de acciones apropiadas
   
   **🎲 POSICIÓN DE LA CORRECTA:**
   - ⚠️ **VARÍA CUÁL OPCIÓN ES LA CORRECTA** - NO siempre la primera
   - Rondas impares (1,3,5,7,9): La opción CORRECTA puede ser la primera O la segunda
   - Rondas pares (2,4,6,8,10): La opción CORRECTA puede ser la primera O la segunda
   - **En ronda ${roundNumber}: ${roundNumber % 2 === 0 ? 'Considera poner la correcta como segunda opción' : 'Considera poner la correcta como primera o segunda opción'}**
   
   **🎯 OTRAS REGLAS:**
   - IMPORTANTE: Ambas opciones deben parecer igualmente válidas, el jugador debe usar intuición
   - LAS OPCIONES (text) PUEDEN mencionar nombres SOLO si es un interrogatorio directo
   - PERO los RESULTADOS varían según la dificultad (ver abajo)
   - Si mencionas nombres, asegúrate de NO repetir sospechosos ya interrogados
   
4. **RESULTADOS (result):**
   - Deben ser INFORMATIVOS, ESPECÍFICOS y CONCISOS
   - Máximo 2-3 oraciones (30-40 palabras)
   - El nivel de AMBIGÜEDAD depende de la dificultad (ver arriba)
   - En dificultad NORMAL/DIFÍCIL: evita mencionar nombres de sospechosos directamente
   - NUNCA deben ser vagos como "No encuentras nada"
   - ⚠️ **SI LA OPCIÓN MENCIONA UN NOMBRE, EL RESULTADO DEBE MENCIONARLO TAMBIÉN**
   
   ✅ BUENOS EJEMPLOS según dificultad:
   
   **FÁCIL:**
   - Si opción menciona "Interrogar a María": "María admite estar en el jardín, contradice su coartada inicial."
   - Si opción menciona "Examinar la chaqueta": "Encuentras huellas de sangre en una chaqueta de alguien con acceso al área."
   - Nota: Solo usa nombres si la opción los mencionó explícitamente
   
   **NORMAL:**
   - "Alguien del personal con [trait] estuvo en esa área durante el periodo crítico." ${!isGuiltyStaff ? '(⚠️ Si el culpable NO es del personal, esta pista debe ser menos relevante que el motivo del culpable)' : ''}
   - "Encuentras un objeto que coincide con los rasgos de [descripción vaga]."
   - "Hay inconsistencias en los testimonios del grupo de sospechosos principales."
   - ⚠️ **IMPORTANTE:** Si el culpable NO es del personal, las pistas sobre "personal" deben ser ambiguas y menos convincentes que el motivo del culpable. El jugador debe poder priorizar el motivo más fuerte sobre las pistas sobre personal.
   
   **DIFÍCIL:**
   - "Los testimonios se contradicen entre sí, sugiriendo que alguien oculta información."
   - "La evidencia apunta a múltiples personas, pero un detalle parece intencionalmente alterado."
   - "Alguien con conocimiento íntimo del lugar manipuló elementos clave de la escena."
   - ⚠️ **CRÍTICO:** Si el culpable NO es del personal, NO generes pistas fuertes que sugieran que el culpable es del personal. Si mencionas "personal", debe ser ambiguo y el motivo del culpable debe ser claramente más fuerte y convincente.
   
   ❌ MALOS EJEMPLOS:
   - "No encuentras nada relevante" (muy vago)
   - "La investigación continúa" (no informativo)
   - "El sospechoso afirma..." sin mencionar nombre si la opción lo mencionó
   - "Es claramente culpable" o "Esto confirma que [Nombre] es el asesino" (DEMASIADO OBVIO)
   - En NORMAL/DIFÍCIL: "María contradice su coartada" si la opción NO mencionó a María

5. **EVIDENCIA (discoversEvidence):**
   - OPCIONAL: Si la opción descubre evidencia física
   - Usar IDs como: ["evidence-1", "evidence-2"]
   - Solo si es relevante para la ronda

6. **INFORMACIÓN REVELADA (revealsInfo):**
   - OPCIONAL: Información clave que se revela
   - Debe ser específica y útil para resolver el caso
   - Ej: "El culpable tiene acceso a las llaves del sótano"

**FORMATO JSON ESPERADO:**
{
  "id": ${roundNumber},
  "title": "Entrevistando a María",
  "narrative": "Decides hablar con María sobre su coartada de esa noche.",
  "options": [
    {
      "id": "option-1",
      "text": "Preguntarle sobre su relación con la víctima",
      "result": "María describe una relación profesional normal, sin nada inusual.",
      "correct": false
    },
    {
      "id": "option-2",
      "text": "Preguntarle sobre su ubicación exacta a las 10pm",
      "result": "María admite estar en el jardín, no en su habitación como dijo antes.",
      "correct": true,
      "discoversEvidence": ["evidence-1"],
      "revealsInfo": "Información clave revelada (opcional)"
    }
  ]
}

**NOTA SOBRE EL EJEMPLO ARRIBA:**
- En este ejemplo, la opción CORRECTA es la SEGUNDA (option-2)
- Recuerda: En ronda ${roundNumber}, ${roundNumber % 2 === 0 ? 'considera poner la correcta como segunda' : 'varía la posición de la correcta'}
- NO sigas un patrón predecible - mantén al jugador adivinando
- Ambas opciones deben parecer igualmente valiosas

**IMPORTANTE:**
- Mantén consistencia con el culpable fijo (${caseContext.guiltyId})
- La opción "correct" debe apuntar sutilmente al culpable (NO OBVIAMENTE)
- Los resultados deben ser ambiguos pero informativos
- Continúa la narrativa basándote en las decisiones previas
- En la ronda ${roundNumber}, el jugador debe sentir que está ${roundNumber <= 3 ? 'explorando' : roundNumber <= 6 ? 'entrevistando' : roundNumber <= 9 ? 'analizando' : 'concluyendo'}

⚠️ **CRÍTICO - USA NOMBRES ESPECÍFICOS:**
- Si mencionas entrevistar/interrogar a alguien, USA SU NOMBRE
- Si el resultado involucra una persona, MENCIONA SU NOMBRE
- NO uses términos genéricos: "el sospechoso", "uno de ellos", "otro testigo"
- ✅ CORRECTO: "Interrogar a María", "Carlos admite que...", "El testimonio de James..."
- ❌ INCORRECTO: "Interrogar a un sospechoso", "El sospechoso admite...", "Otro testigo dice..."

🚨 **ADVERTENCIAS FINALES - NO HAGAS OBVIO AL CULPABLE:**
- NO reveles al culpable directamente en ninguna ronda (ni siquiera en la 10)
- Las opciones "correctas" dan pistas SUTILES, no confirmaciones
- TODOS los sospechosos deben parecer sospechosos en diferentes momentos
- La opción "correct" significa "apunta más al culpable", NO "revela al culpable"
- El jugador debe DEDUCIR basándose en TODAS las pistas, no en una sola ronda
- Si un resultado hace que un sospechoso parezca culpable, TAMBIÉN haz que otro parezca culpable
- Mantén la tensión y el misterio hasta que el jugador haga su acusación final

⚠️ **REGLA CRÍTICA SOBRE PISTAS DE PERSONAL Y MOTIVOS:**
${!isGuiltyStaff ? `
- El culpable (${guiltySuspect?.name || caseContext.guiltyId}) NO es del personal (es ${guiltyRole})
- Si generas pistas que sugieren "alguien del personal", estas deben ser AMBIGUAS y MENOS RELEVANTES
- El motivo del culpable (${guiltyMotive}) es el MÁS FUERTE de todos
- Las pistas sobre personal deben ser lo suficientemente débiles/ambiguas para que el jugador pueda pensar: "Vale, la pista dice que pudo haber sido alguien del personal, pero el motivo de ${guiltySuspect?.name || 'el culpable'} es mucho más fuerte, así que esa pista puede ser falsa o menos importante"
- El motivo del culpable debe ser tan convincente que opaquen pistas confusas sobre personal
- NO hagas que las pistas sobre personal sean más fuertes que el motivo del culpable a menos que la dificultad sea dificil
` : `
- El culpable (${guiltySuspect?.name || caseContext.guiltyId}) ES del personal (es ${guiltyRole})
- Las pistas sobre personal son válidas y pueden apuntar al culpable
- El motivo del culpable (${guiltyMotive}) sigue siendo el MÁS FUERTE de todos
`}

**RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`
}

