import { Router, Request, Response } from 'express';
import OpenAI from 'openai';

const router = Router();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface ImpostorDiscussionRequest {
  roundNumber: number;
  caseContext: {
    caseTitle: string;
    caseDescription: string;
    caseType: string;
    scenario: string;
    difficulty: string;
    victim: any;
    players: Array<{
      id: string;
      name: string;
      role: string;
      isKiller: boolean;
    }>;
    killerId: string;
  };
  discussionHistory?: Array<{
    roundNumber: number;
    type: string;
    content: string;
    topicsDiscussed?: string[];
    targetedPlayers?: string[];
  }>;
  allPlayersInfo?: Array<{
    id: string;
    name: string;
    role: string;
    alibi: string;
    location: string;
    whereWas: string;
    whatDid: string;
    suspiciousBehavior?: string;
    whySuspicious?: string;
    additionalContext?: string;
    isKiller: boolean;
  }>;
  language?: string;
}

export interface ImpostorDiscussionResponse {
  id: number;
  title: string;
  type: "question" | "inconsistency" | "observation";
  content: string;
  context?: string;
  suggestions: string[];
  targetedPlayers?: string[];
}

router.post('/api/generate-impostor-discussion', async (req: Request, res: Response) => {
  try {
    console.log('API Route: generate-impostor-discussion called');
    
    const body: ImpostorDiscussionRequest = req.body;
    console.log(`Request for discussion round ${body.roundNumber}`);
    
    // Validate required fields
    if (!body.roundNumber || !body.caseContext) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { language = 'es' } = body;

    // Crear prompt para OpenAI
    const prompt = createDiscussionPrompt(body, language);

    console.log(`🤖 Calling OpenAI for discussion round ${body.roundNumber}...`);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Eres un detective que interroga a los sospechosos en el modo impostor. Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. Puedes hacer preguntas, señalar inconsistencias, o hacer observaciones basadas en el contexto de todos los jugadores. Responde SOLO JSON válido.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.8,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    console.log('✅ OpenAI response received');

    // Parsear respuesta
    let discussionData: ImpostorDiscussionResponse;
    try {
      discussionData = JSON.parse(response);
    } catch (parseError) {
      const cleanedResponse = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      discussionData = JSON.parse(cleanedResponse);
    }
    
    console.log(`✅ Discussion round ${body.roundNumber} generated successfully`);

    res.json(discussionData);
    
  } catch (error) {
    console.error('Error in generate-impostor-discussion API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    res.status(500).json({
      error: 'Failed to generate discussion round',
      details: errorMessage,
    });
  }
});

// Función createDiscussionPrompt (copiar desde el archivo original)
function createDiscussionPrompt(
  request: ImpostorDiscussionRequest,
  language: string
): string {
  // ... (copiar toda la función createDiscussionPrompt del archivo original)
  // Esta función es muy larga, así que cópiala completa desde app/api/generate-impostor-discussion/route.ts
  // líneas 136-667
  const { roundNumber, caseContext, discussionHistory = [] } = request

  // Analizar historial para detectar temas ya cubiertos
  const coveredTopics = new Set<string>()
  const coveredQuestions = new Set<string>()
  const coveredDiscoveries = new Set<string>()
  const coveredInconsistencies = new Set<string>()
  const coveredQuestionTypes = new Set<string>()
  const coveredDiscoveryTypes = new Set<string>()
  
  discussionHistory.forEach(h => {
    const content = (h.content || '').toLowerCase()
    const type = h.type || ''
    
    // Extraer temas principales
    if (content.includes('coartada') || content.includes('alibi')) coveredTopics.add('coartadas')
    if (content.includes('tiempo') || content.includes('hora') || content.includes('momento')) coveredTopics.add('tiempos')
    if (content.includes('ubicación') || content.includes('lugar') || content.includes('donde')) coveredTopics.add('ubicaciones')
    if (content.includes('relación') || content.includes('interacción')) coveredTopics.add('relaciones')
    if (content.includes('comportamiento') || content.includes('extraño')) coveredTopics.add('comportamientos')
    if (content.includes('confirmar') || content.includes('verificar')) coveredQuestionTypes.add('confirmar coartadas')
    if (content.includes('quién') && content.includes('puede')) coveredQuestionTypes.add('quién puede')
    if (content.includes('explicar') || content.includes('explica')) coveredQuestionTypes.add('explicar')
    
    // Detectar tipos específicos de descubrimientos
    if (content.includes('apagón') || content.includes('luz') || content.includes('electricidad') || content.includes('corte de luz')) {
      coveredDiscoveries.add('apagón')
      coveredDiscoveryTypes.add('problema eléctrico')
    }
    if (content.includes('cuchillo') || content.includes('cuchillos')) {
      coveredDiscoveries.add('cuchillo')
      coveredDiscoveryTypes.add('objeto de cocina')
    }
    if (content.includes('cerrado') || content.includes('llave') || content.includes('puerta') || content.includes('bloqueado')) {
      coveredDiscoveries.add('lugar cerrado')
      coveredDiscoveryTypes.add('lugar inaccesible')
    }
    if (content.includes('huella') || content.includes('dactilar') || content.includes('huellas')) {
      coveredDiscoveries.add('huellas')
      coveredDiscoveryTypes.add('evidencia forense')
    }
    if (content.includes('guante') || content.includes('guantes')) {
      coveredDiscoveries.add('guante')
      coveredDiscoveryTypes.add('objeto de protección')
    }
    if (content.includes('chimenea') || content.includes('fuego') || content.includes('encendida') || content.includes('apagada')) {
      coveredDiscoveries.add('chimenea')
      coveredDiscoveryTypes.add('estado de objetos')
    }
    if (content.includes('testigo') || content.includes('vio') || content.includes('observó') || content.includes('visto')) {
      coveredInconsistencies.add('testigos')
      coveredDiscoveryTypes.add('testimonios')
    }
    if (content.includes('objeto') || content.includes('encontrado') || content.includes('escena') || content.includes('hallado')) {
      coveredDiscoveryTypes.add('objetos en escena')
    }
    
    // Guardar preguntas específicas con más detalle
    if (type === 'question') {
      // Extraer la esencia de la pregunta
      let questionEssence = content
        .replace(/[¿?]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      
      // Normalizar variaciones comunes
      if (questionEssence.includes('confirmar') || questionEssence.includes('verificar')) {
        coveredQuestionTypes.add('confirmar coartadas')
      }
      if (questionEssence.includes('quién') && (questionEssence.includes('puede') || questionEssence.includes('estaba'))) {
        coveredQuestionTypes.add('quién puede/estaba')
      }
      if (questionEssence.includes('explicar') || questionEssence.includes('explica')) {
        coveredQuestionTypes.add('explicar')
      }
      if (questionEssence.includes('relación') || questionEssence.includes('relaciones')) {
        coveredQuestionTypes.add('relaciones')
      }
      if (questionEssence.includes('comportamiento') || questionEssence.includes('extraño')) {
        coveredQuestionTypes.add('comportamientos')
      }
      
      const questionKey = questionEssence.substring(0, 120).trim()
      coveredQuestions.add(questionKey)
    }
    
    // Guardar descubrimientos específicos con más detalle
    if (type === 'discovery') {
      const discoveryKey = content.substring(0, 200).trim()
      coveredDiscoveries.add(discoveryKey)
      
      // Detectar el tipo de descubrimiento
      if (content.includes('descubierto') || content.includes('encontrado') || content.includes('hallado')) {
        const discoveryType = content.match(/(?:descubierto|encontrado|hallado).*?(?:que|un|una|el|la)\s+([^,\.]+)/i)?.[1]?.trim()
        if (discoveryType && discoveryType.length < 50) {
          coveredDiscoveryTypes.add(discoveryType)
        }
      }
    }
    
    // Guardar inconsistencias específicas
    if (type === 'inconsistency') {
      const inconsistencyKey = content.substring(0, 200).trim()
      coveredInconsistencies.add(inconsistencyKey)
    }
  })
  
  const historyInfo = discussionHistory.length > 0
    ? `\n**HISTORIAL DE DISCUSIONES ANTERIORES:**\n${discussionHistory.map(h => 
        `- Ronda ${h.roundNumber} (${h.type || 'unknown'}): ${h.content || ''}${h.targetedPlayers ? ` [Jugadores: ${h.targetedPlayers.join(', ')}]` : ''}`
      ).join('\n')}\n`
    : ''
  
  // Analizar fichas de jugadores para sugerir pistas creativas
  const playerActivities = new Set<string>()
  const playerLocations = new Set<string>()
  const playerObjects = new Set<string>()
  
  if (request.allPlayersInfo && request.allPlayersInfo.length > 0) {
    request.allPlayersInfo.forEach(p => {
      // Extraer actividades mencionadas
      const whatDid = (p.whatDid || '').toLowerCase()
      const whereWas = (p.whereWas || '').toLowerCase()
      const alibi = (p.alibi || '').toLowerCase()
      
      // Detectar actividades
      if (whatDid.includes('cocinar') || whatDid.includes('preparar') || whatDid.includes('cocina')) playerActivities.add('cocinar')
      if (whatDid.includes('leer') || whatDid.includes('libro') || whatDid.includes('lectura')) playerActivities.add('leer')
      if (whatDid.includes('escribir') || whatDid.includes('documento') || whatDid.includes('papel')) playerActivities.add('escribir')
      if (whatDid.includes('hablar') || whatDid.includes('llamada') || whatDid.includes('teléfono')) playerActivities.add('comunicarse')
      if (whatDid.includes('caminar') || whatDid.includes('pasear') || whatDid.includes('moverse')) playerActivities.add('moverse')
      if (whatDid.includes('ver') || whatDid.includes('mirar') || whatDid.includes('observar')) playerActivities.add('observar')
      if (whatDid.includes('escuchar') || whatDid.includes('música') || whatDid.includes('radio')) playerActivities.add('escuchar')
      if (whatDid.includes('limpiar') || whatDid.includes('ordenar') || whatDid.includes('organizar')) playerActivities.add('limpiar')
      
      // Detectar ubicaciones
      if (whereWas.includes('cocina') || alibi.includes('cocina')) playerLocations.add('cocina')
      if (whereWas.includes('oficina') || alibi.includes('oficina')) playerLocations.add('oficina')
      if (whereWas.includes('salón') || alibi.includes('salón')) playerLocations.add('salón')
      if (whereWas.includes('biblioteca') || alibi.includes('biblioteca')) playerLocations.add('biblioteca')
      if (whereWas.includes('dormitorio') || alibi.includes('dormitorio')) playerLocations.add('dormitorio')
      if (whereWas.includes('baño') || alibi.includes('baño')) playerLocations.add('baño')
      if (whereWas.includes('jardín') || alibi.includes('jardín')) playerLocations.add('jardín')
      if (whereWas.includes('garaje') || alibi.includes('garaje')) playerLocations.add('garaje')
      
      // Detectar objetos mencionados
      if (whatDid.includes('teléfono') || whatDid.includes('móvil') || whatDid.includes('celular')) playerObjects.add('teléfono')
      if (whatDid.includes('computadora') || whatDid.includes('ordenador') || whatDid.includes('laptop')) playerObjects.add('computadora')
      if (whatDid.includes('televisión') || whatDid.includes('tv') || whatDid.includes('televisor')) playerObjects.add('televisión')
      if (whatDid.includes('libro') || whatDid.includes('libros')) playerObjects.add('libro')
      if (whatDid.includes('llave') || whatDid.includes('llaves')) playerObjects.add('llave')
      if (whatDid.includes('reloj') || whatDid.includes('relojes')) playerObjects.add('reloj')
    })
  }
  
  const avoidRepetitionInfo = discussionHistory.length > 0
    ? `\n**⚠️ CRÍTICO - EVITAR REPETICIONES:**
Los siguientes temas, preguntas y descubrimientos YA FUERON CUBIERTOS en rondas anteriores. DEBES EVITAR repetirlos o hacer variaciones muy similares:

**Temas ya cubiertos:** ${Array.from(coveredTopics).join(', ') || 'Ninguno'}
**Tipos de preguntas ya hechas:** ${Array.from(coveredQuestionTypes).join(', ') || 'Ninguno'}
**Preguntas específicas ya hechas:** ${coveredQuestions.size > 0 ? `\n${Array.from(coveredQuestions).slice(0, 5).map(q => `  - "${q.substring(0, 80)}..."`).join('\n')}` : 'Ninguna'}
**Tipos de descubrimientos ya revelados:** ${Array.from(coveredDiscoveryTypes).join(', ') || 'Ninguno'}
**Descubrimientos específicos ya revelados:** ${Array.from(coveredDiscoveries).filter(d => d.length < 100).slice(0, 5).map(d => `"${d.substring(0, 80)}..."`).join(', ') || 'Ninguno'}
**Inconsistencias ya señaladas:** ${coveredInconsistencies.size > 0 ? `${coveredInconsistencies.size} inconsistencias diferentes` : 'Ninguna'}

**🚨 REGLAS ESTRICTAS PARA EVITAR REPETICIONES:**
- **NO hagas preguntas similares a las que ya se hicieron** - Revisa el historial completo arriba y asegúrate de que tu pregunta sea COMPLETAMENTE DIFERENTE
- **NO uses los mismos tipos de preguntas** - Si ya se hizo una pregunta tipo "quién puede confirmar", NO hagas otra pregunta similar
- **NO reveles descubrimientos sobre los mismos tipos de evidencia** - Si ya se habló de un cuchillo, NO menciones otro objeto de cocina. Si ya se habló de un apagón, NO menciones problemas eléctricos. Si ya se habló de un lugar cerrado, NO menciones otro lugar bloqueado
- **NO repitas descubrimientos específicos** - Revisa la lista de descubrimientos ya revelados y asegúrate de que tu descubrimiento sea TOTALMENTE NUEVO
- **Varía los tipos de evidencia:** En lugar de siempre objetos físicos, considera: testimonios, registros de tiempo, análisis forense, patrones de comportamiento, relaciones entre personas, etc.
- **Varía los temas:** Si ya se habló de ubicaciones, habla de relaciones, comportamientos, objetos personales, comunicaciones, etc.
- **Varía los jugadores mencionados:** Si una ronda anterior mencionó a ciertos jugadores, menciona a otros en esta ronda
- **Si una ronda anterior fue tipo "question", considera usar "discovery" o "inconsistency" en esta ronda**
- **Si una ronda anterior fue tipo "discovery", NO repitas descubrimientos sobre el mismo tipo de evidencia**
- **ANTES de generar tu respuesta, revisa TODO el historial y asegúrate de que tu contenido sea COMPLETAMENTE DIFERENTE y NO REPETITIVO**

`
    : ''
  
  // Generar sugerencias de pistas creativas basadas en las fichas
  const creativeClueSuggestions = request.allPlayersInfo && request.allPlayersInfo.length > 0
    ? `\n**💡 SUGERENCIAS DE PISTAS CREATIVAS BASADAS EN LAS FICHAS:**
Analiza las fichas de los jugadores y genera descubrimientos CREATIVOS y VARIADOS. NO uses siempre los mismos tipos de pistas (cuchillo, apagón, lugar cerrado).

**Actividades mencionadas en las coartadas:** ${Array.from(playerActivities).join(', ') || 'Ninguna específica'}
**Ubicaciones mencionadas:** ${Array.from(playerLocations).join(', ') || 'Ninguna específica'}
**Objetos mencionados:** ${Array.from(playerObjects).join(', ') || 'Ninguno específico'}

**Ejemplos de pistas CREATIVAS y VARIADAS (NO uses siempre las mismas):**
- Si jugadores mencionaron leer: "Se encontraron marcas de dedos en un libro que estaba en [lugar]"
- Si jugadores mencionaron cocinar: "El análisis de residuos en el fregadero revela que se lavaron utensilios después del crimen"
- Si jugadores mencionaron escribir: "Se encontraron restos de tinta en [lugar] que no coincide con ningún documento de la víctima"
- Si jugadores mencionaron teléfonos: "Los registros de llamadas muestran actividad inusual durante el tiempo del crimen"
- Si jugadores mencionaron moverse: "Se encontraron huellas de barro en [lugar] que no corresponden a la víctima"
- Si jugadores mencionaron escuchar música: "El volumen del sistema de audio fue ajustado justo antes del crimen"
- Si jugadores mencionaron limpiar: "Se detectaron productos de limpieza usados recientemente en [lugar]"
- Si jugadores mencionaron estar en biblioteca: "Un libro fue movido de su posición original en la biblioteca"
- Si jugadores mencionaron estar en jardín: "Se encontraron restos de tierra específica del jardín en [lugar]"
- Si jugadores mencionaron estar en garaje: "El vehículo en el garaje tiene el motor aún caliente"
- "Se encontraron fibras de ropa específicas en la escena que no corresponden a la víctima"
- "El análisis de ADN revela la presencia de una tercera persona en [lugar]"
- "Los registros de seguridad muestran que una puerta fue abierta desde el interior"
- "Se encontraron restos de comida específica en [lugar] que no coincide con lo que la víctima consumió"
- "El análisis de polen revela que alguien estuvo recientemente en [lugar específico]"
- "Se detectaron cambios de temperatura inusuales en [lugar] durante el tiempo del crimen"
- "Los registros muestran que un dispositivo electrónico fue desactivado justo antes del crimen"
- "Se encontraron marcas de arrastre que sugieren que algo pesado fue movido"
- "El análisis de patrones de iluminación revela que las luces fueron manipuladas"
- "Se detectaron sonidos específicos grabados por dispositivos inteligentes en [lugar]"

**IMPORTANTE:** 
- Varía los tipos de pistas entre rondas
- NO uses siempre objetos físicos (cuchillos, guantes, etc.)
- Considera evidencia forense, tecnológica, testimonial, ambiental, etc.
- Basa las pistas en las actividades y ubicaciones REALES mencionadas en las fichas de los jugadores
- Sé CREATIVO y ORIGINAL, no repitas los mismos tipos de descubrimientos

`
    : ''
  
  // Información completa de jugadores para análisis de inconsistencias
  const allPlayersInfoText = request.allPlayersInfo && request.allPlayersInfo.length > 0
    ? request.allPlayersInfo.map(p => `
- **${p.name}** (${p.role}):
  * Motivo por el que es sospechoso: ${p.whySuspicious || 'No especificado'}
  * Coartada: ${p.alibi}
  * Ubicación: ${p.location}
  * Dónde estaba: ${p.whereWas}
  * Qué estaba haciendo: ${p.whatDid}
  ${p.suspiciousBehavior ? `* Comportamiento sospechoso: ${p.suspiciousBehavior}` : ''}
  ${p.additionalContext ? `* Contexto adicional: ${p.additionalContext.substring(0, 200)}...` : ''}
  ${p.isKiller ? '* 🔴 ASESINO' : '* ✅ Inocente'}
`).join('\n')
    : ''
  
  // Fallback si no hay información completa
  const playersInfo = caseContext.players.map(p => `
- ${p.name} (${p.role}) - ${p.isKiller ? '🔴 ASESINO' : '✅ Inocente'}
`).join('')

  return `
Eres un detective que interroga a los sospechosos en la ronda ${roundNumber} del modo impostor.

**⚠️ PASO 1 - REVISAR HISTORIAL ANTES DE GENERAR:**
${discussionHistory.length > 0 
  ? `ANTES de generar tu respuesta, DEBES revisar TODO el historial de discusiones anteriores (ver más abajo). 
Asegúrate de que tu nueva intervención:
- NO repita preguntas similares
- NO repita descubrimientos sobre los mismos temas
- NO repita inconsistencias sobre los mismos jugadores
- Varíe el tipo de intervención (question, discovery, inconsistency)
- Varíe los temas y jugadores mencionados
- Sea FRESCA y NUEVA, no una variación de algo ya dicho`
  : 'Esta es la primera ronda generada, no hay historial previo.'}

**🚨 REGLA CRÍTICA - DISTRIBUCIÓN DE JUGADORES:**
El asesino es: ${caseContext.players.find(p => p.id === caseContext.killerId)?.name || 'Desconocido'}

**⚠️ REGLA ABSOLUTA SOBRE MENCIONAR JUGADORES:**
- **NUNCA menciones SOLO al asesino en una pregunta, inconsistencia o descubrimiento**
- **SI mencionas al asesino, DEBES mencionar también a AL MENOS 2-3 OTROS JUGADORES**
- **SIEMPRE distribuye las menciones de manera equitativa entre TODOS los jugadores**
- **Ejemplo CORRECTO:** "Hemos recibido informes de que [Asesino], [Jugador 1] y [Jugador 2] fueron vistos en [lugar] durante el tiempo del crimen."
- **Ejemplo CORRECTO:** "¿Pueden [Asesino], [Jugador 1] y [Jugador 2] explicar por qué sus coartadas mencionan estar en lugares cercanos al arma?"
- **Ejemplo INCORRECTO:** "[Asesino], ¿puedes explicar tu coartada?" (SOLO menciona al asesino - PROHIBIDO)
- **Ejemplo INCORRECTO:** "Hemos encontrado evidencia que contradice la coartada de [Asesino]." (SOLO menciona al asesino - PROHIBIDO)
- **Si necesitas mencionar a un jugador específico, menciona también a otros 2-3 jugadores en la misma intervención**
- **En "targetedPlayers", SIEMPRE incluye al menos 3-4 jugadores, nunca solo 1 o 2**

**CONTEXTO DEL CASO:**
- Título: ${caseContext.caseTitle}
- Descripción: ${caseContext.caseDescription}
- Tipo: ${caseContext.caseType}
- Escenario: ${caseContext.scenario}
- Dificultad: ${caseContext.difficulty}
- Asesino: ${caseContext.players.find(p => p.id === caseContext.killerId)?.name || 'Desconocido'}

**INFORMACIÓN COMPLETA DE TODOS LOS JUGADORES:**
${allPlayersInfoText || playersInfo}
${historyInfo}
${avoidRepetitionInfo}
${creativeClueSuggestions}

**FASES DEL JUEGO:**
- FASE 1 (roundNumber 1): Motivo de sospecha - MOCKEADA (no se genera aquí)
- FASE 2 (roundNumber 2): Coartadas oficiales - MOCKEADA (no se genera aquí)
- FASE 3 (roundNumber 3): Preguntas de clarificación - Genera preguntas para aclarar detalles ambiguos sobre posiciones, acciones, relaciones entre jugadores, o comportamientos observados. NO preguntes sobre tiempos porque eso ya se cubrió en la ronda 2 (coartadas oficiales).
- FASE 4 (roundNumber 4): Evidencias generadas - Genera descubrimientos/pistas lógicas basadas en las fichas de los jugadores, como las coartadas, los motivos 
- FASE 5 (roundNumber 5): Contradicciones directas - Compara lo que dijeron diferentes jugadores y señala contradicciones (ej: "La coartada de Carlos dice que vio la luz encendida, pero Ana dice que estaba todo oscuro. ¿Quién está mintiendo?")
- FASE 6 (roundNumber 6): Pistas descubiertas - Genera más descubrimientos/pistas encontradas en la escena del crimen, cámaras, o evidencia física
- FASE 7 (roundNumber 7): Presión final - Haz preguntas que generen debates entre sospechosos, para que se den cuenta de las contradicciones y pistas que se han generado.
- FASE 8 (roundNumber 8): Revelar culpable - No se genera aquí, va directo a revelar

**TIPOS DE INTERVENCIONES DEL DETECTIVE:**
Puedes hacer 3 tipos de intervenciones (varía entre rondas):

1. **PREGUNTA (type: "question")**: 
   - Hacer una pregunta directa a los jugadores
   - Ejemplo: "¿Quién puede confirmar sus coartadas durante la hora del crimen?"
   - Fomenta la discusión y análisis

2. **INCONSISTENCIA (type: "inconsistency")**:
   - Señalar inconsistencias usando EVIDENCIA OBJETIVA (cámaras, testigos, evidencia física), NO citando directamente lo que dijeron los jugadores
   - **CRÍTICO: NO uses frases como "He notado que [jugador] dice..." o "[jugador] afirma que..." porque el jugador puede no haber dicho eso con tanto detalle**
   - Basarte en evidencia objetiva: cámaras de seguridad, testigos que vieron algo, evidencia física
   - **🚨 CRÍTICO - DISTRIBUCIÓN DE JUGADORES:**
     * NUNCA menciones SOLO al asesino
     * SI mencionas al asesino, DEBES mencionar también a AL MENOS 2-3 OTROS JUGADORES
     * Ejemplo CORRECTO: "Hemos recibido informes de que [Asesino], [Jugador 1] y [Jugador 2] fueron vistos en lugares diferentes a los que mencionaron en sus coartadas."
     * Ejemplo INCORRECTO: "Hemos recibido informes de que [Asesino] fue visto en [lugar] diferente a su coartada." (SOLO menciona al asesino - PROHIBIDO)
   - Dar oportunidad de defenderse
   - Menciona jugadores específicos por nombre, pero SIEMPRE incluye a varios jugadores, nunca solo uno

3. **DESCUBRIMIENTO (type: "discovery")**:
   - Revelar información nueva descubierta por la investigación que contradiga las coartadas
   - Ejemplos:
     * "Hemos descubierto que hubo un apagón de media hora durante el tiempo del crimen, y ninguno de ustedes mencionó nada."
     * "Nuestros forenses encontraron que el arma fue manipulada con guantes"
   - Los descubrimientos deben ser información que contradiga las coartadas de algunos jugadores
   - Debe permitir que los jugadores revisen sus fichas y vean si su coartada es contradictoria
   - Ejemplo de contradicción: Si alguien dice que vio TV pero hubo un apagón, su coartada es contradictoria
   - También puedes señalar contradicciones entre lo que dicen diferentes jugadores:
     * Ejemplo: "[Jugador A] dice que su discusión con [víctima] era pequeña (solo si esto se menciona en el motivo), pero [Jugador B] nos contó que escuchó gritos fuertes. ¿Quién exagera o quién miente?"

**REGLAS PARA LA INTERVENCIÓN SEGÚN LA FASE:**
1. **FASE 3 (roundNumber 3) - Preguntas de clarificación:**
   - Tipo: "question"
   - Enfócate en aclarar detalles ambiguos sobre posiciones, acciones, relaciones entre jugadores, o comportamientos observados
   - **CRÍTICO: NO preguntes sobre tiempos porque eso ya se cubrió en la ronda 2 (coartadas oficiales)**
   - **CRÍTICO: NO preguntes sobre qué vieron o escucharon porque eso probablemente ya se habló en la ronda 2 cuando se hablaron las coartadas**
   - Haz preguntas específicas que ayuden a entender mejor las relaciones y comportamientos, NO sobre detalles de las coartadas
   - Ejemplo: "¿Tenían alguna relación previa con la víctima que pueda ser relevante?"
   - Ejemplo: "¿Notaron algún comportamiento extraño en otros jugadores durante la noche?"

2. **FASE 4 (roundNumber 4) - Evidencias generadas:**
   - Tipo: "discovery"
   - Genera descubrimientos/pistas CREATIVAS y VARIADAS basadas en lo que los jugadores dijeron en sus coartadas
   - **🚨 CRÍTICO - CREATIVIDAD Y VARIEDAD:**
     * NO uses siempre los mismos tipos de pistas (cuchillo, apagón, lugar cerrado, guante)
     * Varía los tipos de evidencia: forense, tecnológica, testimonial, ambiental, etc.
     * Analiza las fichas de los jugadores y genera pistas ESPECÍFICAS basadas en sus actividades y ubicaciones
     * Sé CREATIVO: considera ADN, fibras, polen, registros electrónicos, patrones de comportamiento, etc.
     * Revisa la sección "SUGERENCIAS DE PISTAS CREATIVAS" más abajo para ideas variadas
   - **CRÍTICO: NO menciones nombres específicos de jugadores en el descubrimiento**
   - **CRÍTICO: El descubrimiento debe ser general, para que los jugadores lo relacionen con las coartadas**
   - **CRÍTICO: El descubrimiento debe hacer que los jugadores REVISEN las coartadas de otros. Ejemplos CREATIVOS:**
     * Si varios jugadores mencionaron leer → "Se encontraron marcas de dedos en un libro que estaba en [lugar]"
     * Si varios jugadores mencionaron cocinar → "El análisis de residuos en el fregadero revela que se lavaron utensilios después del crimen"
     * Si varios jugadores mencionaron escribir → "Se encontraron restos de tinta en [lugar] que no coincide con ningún documento de la víctima"
     * Si varios jugadores mencionaron teléfonos → "Los registros de llamadas muestran actividad inusual durante el tiempo del crimen"
     * Si varios jugadores mencionaron estar en jardín → "Se encontraron restos de tierra específica del jardín en [lugar]"
     * Si varios jugadores mencionaron estar en biblioteca → "Un libro fue movido de su posición original en la biblioteca"
     * "Se encontraron fibras de ropa específicas en la escena que no corresponden a la víctima"
     * "El análisis de ADN revela la presencia de una tercera persona en [lugar]"
     * "Los registros de seguridad muestran que una puerta fue abierta desde el interior"
     * "Se detectaron cambios de temperatura inusuales en [lugar] durante el tiempo del crimen"
   - **CRÍTICO: NUNCA digas "esto plantea dudas", "esto contradice", "esto pone en duda" o frases similares. Solo presenta el dato objetivo y deja que los jugadores se den cuenta, por ejemplo: "Hemos recibido informes de que en la cocina se escuchó un golpe fuerte durante el tiempo del crimen"**
   - **CRÍTICO: La descripción debe variar según la dificultad:**
     * FÁCIL: Descripción completa del descubrimiento con contexto (ej: "Hemos descubierto que en la cocina se encontró un cuchillo con restos de salsa que coincide con lo que Javier mencionó que estaba preparando. Sin embargo, la víctima fue encontrada en su oficina, lo que sugiere que Javier pudo haber estado en ese lugar en un momento crucial.")
     * NORMAL: Solo el descubrimiento básico, SIN interpretaciones ni sugerencias (ej: "Hemos descubierto que en la cocina se encontró un cuchillo con restos de salsa.") - Los jugadores deben relacionar esto con las coartadas que escucharon
     * DIFÍCIL: Descripción ambigua pero relevante (ej: "Hemos encontrado evidencia de que el teatro tenía marcas de manipulación durante el tiempo del crimen.")
   - Ejemplo CORRECTO: "Hemos descubierto que hubo un apagón de media hora durante el tiempo del crimen, y ninguno de ustedes mencionó nada."
   - Ejemplo CORRECTO: "En la escena del crimen se ha encontrado un guante de cocina."
   - Ejemplo CORRECTO: "Hemos descubierto que la chimenea del salón principal estaba apagada durante el momento del crimen."
   - Ejemplo INCORRECTO: "Hemos descubierto que la chimenea estaba apagada, lo que contradice la coartada de Laura" (NO mencionar nombres)
   - El descubrimiento debe ser información objetiva que los jugadores puedan relacionar con las coartadas que escucharon
   - Los descubrimientos pueden afectar tanto a inocentes como al culpable, pero sin hacer focus solo en el culpable

3. **FASE 5 (roundNumber 5) - Contradicciones directas:**
   - Tipo: "inconsistency" o "observation"
   - Señala contradicciones usando EVIDENCIA OBJETIVA basada en las COARTADAS que los jugadores dijeron
   - **CRÍTICO: Las inconsistencias deben ser basadas en OBJETOS DEJADOS EN LA ESCENA, PISTAS FÍSICAS, o cosas que los jugadores puedan relacionar con las coartadas que anotaron en sus cuadernos**
   - **CRÍTICO: NO uses frases como "He notado que [jugador] dice..." o "[jugador] afirma que..." porque el jugador puede no haber dicho eso con tanto detalle**
   - **CRÍTICO: Usa evidencia objetiva como: objetos encontrados en la escena, huellas, evidencia física que pueda relacionarse con las coartadas**
   - **🚨 CRÍTICO - DISTRIBUCIÓN DE JUGADORES:**
     * NUNCA hagas focus en un solo jugador, especialmente si es el asesino
     * DEBES mencionar a AL MENOS 3-4 JUGADORES en cada inconsistencia
     * SI mencionas al asesino, DEBES mencionar también a AL MENOS 2-3 OTROS JUGADORES
     * Ejemplo CORRECTO: "En la escena del crimen se encontró un objeto que relaciona a [Asesino], [Jugador 1], [Jugador 2] y [Jugador 3] con el lugar del crimen."
     * Ejemplo INCORRECTO: "Hemos encontrado evidencia que contradice la coartada de [Asesino]." (SOLO menciona al asesino - PROHIBIDO)
   - **CRÍTICO: La contradicción debe ser RELEVANTE y ÚTIL para la discusión. NO uses contradicciones vagas o que no aporten nada (ej: "se escucharon gritos" sin más contexto no es útil)**
   - **CRÍTICO: NUNCA digas "esto plantea dudas", "esto contradice", "esto pone en duda" o frases similares. Solo presenta el dato objetivo.**
   - **CRÍTICO: NUNCA asumas cosas que los jugadores no dijeron explícitamente. Solo puedes usar información de las FICHAS: coartadas (alibi, whereWas, whatDid) y motivos (whySuspicious). NO asumas que dijeron algo sobre ruidos, comportamientos, o reacciones a menos que esté explícitamente en su ficha.**
   - **CRÍTICO: La descripción debe variar según la dificultad:**
     * FÁCIL: Descripción completa con nombres (ej: "Hemos recibido informes de que la chimenea del salón principal estaba apagada durante el momento del crimen. Sin embargo, Clara mencionó que estaba cerca de la chimenea cuando ocurrió el asesinato.")
     * NORMAL: Solo el descubrimiento, SIN mencionar nombres (ej: "Hemos recibido informes de que la chimenea del salón principal estaba apagada durante el momento del crimen.")
     * DIFÍCIL: Descripción ambigua pero relevante
   - Ejemplos CORRECTOS basados en objetos/pistas físicas:
     * "En la escena del crimen se encontró un guante de cocina con restos de [sustancia]. Varios de ustedes mencionaron estar en la cocina."
     * "Hemos encontrado huellas dactilares en [objeto] que fue movido durante el crimen."
     * "Se encontró un objeto personal de [tipo] en la escena del crimen que no pertenece a la víctima."
   - Ejemplo INCORRECTO: "Algunos de ustedes mencionan que estaban en lugares distintos, pero hemos recibido informes de que se escucharon gritos. ¿Cómo explican esto?" (NO es relevante ni útil, no aporta nada concreto)
   - Ejemplo INCORRECTO: "Hemos recibido informes de que en la cocina se escuchó un golpe fuerte durante el tiempo del crimen. Sin embargo, el chef mencionó que no sabía si debería ir a ver qué sucedía. Esto es extraño, dado que estaba en la cocina donde supuestamente se escuchó el ruido." (NO asumas que el chef dijo algo sobre no saber si ir a ver - solo usa información de su ficha)
   - Ejemplo INCORRECTO: "He notado que Fernando dice que estaba en su oficina desde las 9:45pm hasta las 10:15pm, pero también afirma que estaba en la cocina a las 10:10pm" (NO citar directamente lo que dijo)
   - Ejemplo INCORRECTO: "Laura, mencionaste que estabas en el salón, pero tu coartada dice que estabas en el estudio" (NO hacer focus en un solo jugador ni citar directamente)
   - Usa la información completa de jugadores para encontrar contradicciones reales basadas en evidencia objetiva que sean RELEVANTES y ÚTILES

4. **FASE 6 (roundNumber 6) - Pistas descubiertas:**
   - Tipo: "discovery"
   - Genera descubrimientos/pistas CREATIVAS y VARIADAS encontradas en la escena del crimen basadas en las COARTADAS que los jugadores dijeron
   - **🚨 CRÍTICO - CREATIVIDAD Y VARIEDAD:**
     * NO uses siempre los mismos tipos de pistas (cuchillo, apagón, lugar cerrado, guante, huellas)
     * Varía los tipos de evidencia: forense, tecnológica, testimonial, ambiental, etc.
     * Analiza las fichas de los jugadores y genera pistas ESPECÍFICAS basadas en sus actividades y ubicaciones
     * Sé CREATIVO: considera ADN, fibras, polen, registros electrónicos, patrones de comportamiento, etc.
     * Revisa la sección "SUGERENCIAS DE PISTAS CREATIVAS" más abajo para ideas variadas
     * **NO repitas el mismo tipo de descubrimiento que en FASE 4** - Si en FASE 4 fue un objeto físico, en FASE 6 usa evidencia forense o tecnológica
   - **CRÍTICO: NO menciones nombres específicos de jugadores en el descubrimiento**
   - **CRÍTICO: El descubrimiento debe hacer que los jugadores REVISEN las coartadas de otros, similar a FASE 4**
   - **CRÍTICO: NUNCA digas "esto plantea dudas", "esto contradice", "esto pone en duda" o frases similares. Solo presenta el dato objetivo.**
   - **CRÍTICO: NUNCA asumas cosas que los jugadores no dijeron explícitamente. Solo puedes usar información de las FICHAS: coartadas (alibi, whereWas, whatDid) y motivos (whySuspicious).**
   - **CRÍTICO: La descripción debe variar según la dificultad (igual que FASE 4):**
     * FÁCIL: Descripción completa del descubrimiento con contexto
     * NORMAL: Solo el descubrimiento básico, SIN interpretaciones ni sugerencias
     * DIFÍCIL: Descripción ambigua pero relevante
   - Ejemplos de pistas CREATIVAS y VARIADAS: 
     * "Se encontraron fibras de ropa específicas en la escena que no corresponden a la víctima"
     * "El análisis de ADN revela la presencia de una tercera persona en [lugar]"
     * "Los registros de seguridad muestran que una puerta fue abierta desde el interior"
     * "Se detectaron cambios de temperatura inusuales en [lugar] durante el tiempo del crimen"
     * "El análisis de polen revela que alguien estuvo recientemente en [lugar específico]"
     * "Se encontraron marcas de arrastre que sugieren que algo pesado fue movido"
     * "Los registros muestran que un dispositivo electrónico fue desactivado justo antes del crimen"
   - Los descubrimientos deben ser información objetiva que los jugadores puedan relacionar con las coartadas que escucharon y anotaron
   - Los descubrimientos pueden afectar tanto a inocentes como al culpable, pero sin hacer focus solo en el culpable

5. **FASE 7 (roundNumber 7) - Presión final:**
   - Tipo: "question" o "observation"
   - Haz preguntas generales que inviten a todos a reflexionar sobre lo discutido
   - **🚨 CRÍTICO - DISTRIBUCIÓN DE JUGADORES:**
     * NUNCA hagas focus en un solo jugador, especialmente si es el asesino
     * Haz preguntas que involucren a TODOS los jugadores
     * Si necesitas mencionar jugadores específicos, menciona a AL MENOS 3-4 jugadores
     * NUNCA menciones solo al asesino en una pregunta
   - **CRÍTICO: NO repitas preguntas de la ronda 2 (coartadas oficiales). NO preguntes sobre confirmar ubicaciones o quién puede confirmar coartadas, eso ya se habló.**
   - **CRÍTICO: Evita preguntas que no tienen sentido en el gameplay (ej: "¿qué proyecto estabas trabajando?")**
   - **CRÍTICO: Enfócate en preguntas que inviten a ANALIZAR y REFLEXIONAR sobre todo lo discutido, no en repetir información**
   - Ejemplo CORRECTO: "Basándonos en todo lo discutido y los descubrimientos, ¿quién tiene la coartada más débil?"
   - Ejemplo CORRECTO: "Considerando todas las evidencias y contradicciones, uno de ustedes esta mintiendo"
   - Ejemplo INCORRECTO: "¿Quién puede confirmar su ubicación exacta durante el tiempo del crimen?" (YA se habló en ronda 2)
   - Ejemplo INCORRECTO: "[Asesino], ¿puedes explicar por qué tu coartada menciona el estudio si estabas en el salón?" (NO hacer focus en un solo jugador, especialmente si es el asesino - PROHIBIDO)

5. **REGLAS GENERALES:**
   - No debe revelar directamente quién es el asesino
   - **🚨 CRÍTICO - DISTRIBUCIÓN DE JUGADORES:**
     * NUNCA menciones SOLO al asesino en ninguna intervención
     * SI mencionas al asesino, DEBES mencionar también a AL MENOS 2-3 OTROS JUGADORES
     * En "targetedPlayers", SIEMPRE incluye al menos 3-4 jugadores, nunca solo 1 o 2
     * Distribuye las menciones de manera equitativa entre TODOS los jugadores
     * Si una ronda anterior mencionó al asesino, en esta ronda menciona a otros jugadores (preferiblemente sin mencionar al asesino)
   - **CRÍTICO: Debe ser COMPLETAMENTE DIFERENTE a las intervenciones anteriores. Revisa el historial y asegúrate de NO repetir:**
     * Preguntas similares o sobre los mismos temas
     * Descubrimientos sobre los mismos tipos de evidencia
     * Inconsistencias sobre los mismos jugadores o temas
     * Mismos tipos de intervención consecutivamente (varía entre question, discovery, inconsistency)
   - Si señalas inconsistencias o descubrimientos, incluye en "targetedPlayers" los IDs de los jugadores afectados (SIEMPRE al menos 3-4 jugadores)
   - Los descubrimientos deben ser información que los jugadores puedan verificar en sus fichas
   - **Varía los jugadores mencionados:** Si rondas anteriores mencionaron a ciertos jugadores, menciona a otros en esta ronda
   - **Varía los temas:** Si ya se habló de ubicaciones, habla de relaciones, comportamientos, o evidencia física diferente

**SUGERENCIAS:**
- Incluye 3-5 sugerencias de qué aspectos discutir
- Las sugerencias deben guiar la discusión sin ser demasiado específicas
- **🚨 CRÍTICO - DISTRIBUCIÓN DE JUGADORES:**
  * NUNCA hagas focus en un solo jugador o en interacciones específicas entre dos jugadores (especialmente si uno es el culpable)
  * NUNCA sugieras analizar solo al asesino
  * Las sugerencias deben ser GENERALES y aplicar a MÚLTIPLES jugadores (mínimo 3-4)
- **CRÍTICO: Las sugerencias deben ser GENERALES y aplicar a MÚLTIPLES jugadores**
- Ejemplos CORRECTOS: "Analicen las coartadas de cada uno", "Discutan quién tenía acceso al arma", "Verifiquen quién puede confirmar su ubicación", "Revisen las relaciones de todos con la víctima"
- Ejemplos INCORRECTOS: "Discutan las interacciones entre María y Carlos antes del crimen" (NO hacer focus en jugadores específicos), "Analicen el comportamiento de [jugador específico]" (NO hacer focus en uno solo), "Analicen la coartada de [Asesino]" (NUNCA hacer focus solo en el asesino - PROHIBIDO)

**FORMATO JSON ESPERADO:**
{
  "id": ${roundNumber},
  "title": "Título de la ronda (ej: 'Análisis de Coartadas', 'Inconsistencias Detectadas', 'Observaciones del Detective', etc.)",
  "type": "question" | "inconsistency" | "observation" | "discovery",
  "content": "Contenido principal: pregunta, inconsistencia señalada, observación, o descubrimiento. **IMPORTANTE:** Si es tipo 'discovery' y la dificultad es FÁCIL, incluye explicación completa. Si es NORMAL, sé más directo. Si es DIFÍCIL, sé ambiguo pero relevante. (ej: 'Cada uno de ustedes debe explicar el motivo por el que es sospechoso' o '¿Quién puede confirmar tu coartada?' o 'He notado que [jugador] dice que estaba en [lugar] pero...' o 'Hemos descubierto que hubo un apagón de media hora...')",
  "context": "Contexto adicional sobre por qué esta intervención es relevante ahora",
  "suggestions": [
    "Sugerencia 1 de qué discutir",
    "Sugerencia 2 de qué discutir",
    "Sugerencia 3 de qué discutir"
  ],
  "targetedPlayers": ["player-1", "player-2"], // IDs de jugadores mencionados o afectados (solo para inconsistencias, NO para descubrimientos)
  "discovery": {
    "description": "Descripción detallada del descubrimiento (solo si type es 'discovery'). **DEBE variar según dificultad:** FÁCIL = completa y explicativa, NORMAL = directa, DIFÍCIL = ambigua pero relevante",
    "implications": ["Implicación 1", "Implicación 2"] // Qué significa este descubrimiento (solo para FÁCIL, en normal y dificil, no)
  }
}

**CRÍTICO - REGLAS ABSOLUTAS:**
- El contenido debe estar en ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}
- Debe ser clara y específica
- Debe permitir que todos los jugadores participen
- **🚨 DISTRIBUCIÓN DE JUGADORES - REGLA ABSOLUTA:**
  * NUNCA menciones SOLO al asesino en ninguna intervención (pregunta, inconsistencia, descubrimiento)
  * SI mencionas al asesino, DEBES mencionar también a AL MENOS 2-3 OTROS JUGADORES
  * En "targetedPlayers", SIEMPRE incluye al menos 3-4 jugadores, nunca solo 1 o 2
  * Distribuye las menciones de manera equitativa entre TODOS los jugadores
  * Si una ronda anterior mencionó al asesino, en esta ronda menciona a otros jugadores (preferiblemente sin mencionar al asesino)
  * Ejemplo CORRECTO: "Hemos recibido informes sobre [Asesino], [Jugador 1] y [Jugador 2]..."
  * Ejemplo INCORRECTO: "[Asesino], ¿puedes explicar...?" (SOLO menciona al asesino - PROHIBIDO)
- **⚠️ EVITAR REPETICIONES - CRÍTICO:**
  * ANTES de generar, revisa TODO el historial de discusiones anteriores
  * NO repitas preguntas similares o sobre los mismos temas
  * NO repitas descubrimientos sobre los mismos tipos de evidencia
  * NO repitas inconsistencias sobre los mismos jugadores
  * Varía el tipo de intervención (question, discovery, inconsistency)
  * Varía los temas: si ya se habló de ubicaciones, habla de relaciones, comportamientos, o evidencia diferente
  * Varía los jugadores mencionados entre rondas
  * Si el historial muestra que ya se hizo una pregunta sobre "confirmar coartadas", NO hagas otra pregunta similar
  * Si el historial muestra que ya se descubrió algo sobre "apagón" o "luz", NO menciones problemas eléctricos similares
  * Si el historial muestra que ya se señaló una inconsistencia sobre un jugador específico, menciona a otros jugadores en esta ronda
- **NUNCA hagas focus en un solo jugador en preguntas o descubrimientos, especialmente si es el asesino**
- **NUNCA digas "esto contradice la coartada de algunos de ustedes" - deja que los jugadores descubran eso**
- **En descubrimientos (FASE 4 y FASE 6): NO menciones nombres, solo información objetiva. NO incluyas "targetedPlayers" ni "Jugadores mencionados" en descubrimientos.**
- **En descubrimientos (FASE 4 y FASE 6): La descripción DEBE variar según la dificultad (${caseContext.difficulty}):**
  * Si es FÁCIL: Descripción completa y explicativa con implicaciones claras
  * Si es NORMAL: Descripción más corta y directa, sin explicar tanto
  * Si es DIFÍCIL: Descripción ambigua pero relevante, que requiera más análisis
- **En contradicciones (FASE 5): DEBES incluir al menos 2-3 jugadores, NO uno solo**
- **En preguntas: Haz preguntas generales que inviten a todos, NO preguntas directas a un solo jugador**
- El JSON debe ser válido, sin errores
- **RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`
}
export default router;
