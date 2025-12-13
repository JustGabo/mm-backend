import { Router, Request, Response } from 'express';
import { SuspectService } from '../services/suspect-service.js';
import { WeaponService } from '../services/weapon-service.js';
import OpenAI from 'openai';

// Lazy initialization - solo crea el cliente cuando se necesite
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not defined');
  }

  openaiClient = new OpenAI({
    apiKey: apiKey,
  });
  
  return openaiClient;
}

const router = Router();

export interface ImpostorCaseGenerationRequest {
  caseType: string;
  suspects: number;
  clues: number;
  scenario: string;
  difficulty: string;
  style?: 'realistic' | 'pixel';
  language?: string;
  playerNames?: string[];
  playerGenders?: string[];
}

export interface ImpostorCaseResponse {
  caseTitle: string;
  caseDescription: string;
  victim: {
    name: string;
    age: number;
    role: string;
    description: string;
    causeOfDeath?: string;
    timeOfDeath?: string;
    timeOfDiscovery?: string;
    discoveredBy?: string;
    location?: string;
    bodyPosition?: string;
    visibleInjuries?: string;
    objectsAtScene?: string;
    signsOfStruggle?: string;
  };
  players: Array<{
    id: string;
    name: string;
    age: number;
    role: string;
    description: string;
    isKiller: boolean;
    alibi: string;
    location: string;
    whereWas: string;
    whatDid: string;
    suspiciousBehavior?: string;
    whySuspicious: string;
    additionalContext?: string;
    photo: string;
    traits: string[];
    gender?: string;
  }>;
  weapon?: {
    id: string;
    name: string;
    description: string;
    location: string;
    photo: string;
    importance: 'high';
  };
  hiddenContext: {
    killerId: string;
    killerReason: string;
    keyClues: string[];
    killerTraits: string[];
  };
  config: {
    caseType: string;
    totalClues: number;
    scenario: string;
    difficulty: string;
  };
}

router.post('/api/generate-impostor-case', async (req: Request, res: Response) => {
  try {
    console.log('API Route: generate-impostor-case called');
    
    const body: ImpostorCaseGenerationRequest = req.body;
    console.log('Request body:', body);
    
    // Validate required fields
    if (!body.caseType || !body.suspects || !body.clues || !body.scenario || !body.difficulty) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { language = 'es', playerNames = [], playerGenders = [] } = body;

    // Obtener sospechosos reales desde Supabase
    console.log(`🔍 Fetching ${body.suspects} suspects from Supabase...`);
    console.log(`👥 Player genders provided: ${playerGenders.join(', ')}`);
    
    const selectedSuspects = await SuspectService.getSuspectsForScene({
      count: body.suspects,
      scene: body.scenario,
      style: body.style,
      preferredGenders: playerGenders.length > 0 ? playerGenders : undefined,
    });
    
    console.log(`✅ Found ${selectedSuspects.length} suspects from Supabase`);

    // Seleccionar arma para casos de asesinato
    let selectedWeapon = null;
    if (body.caseType === 'asesinato') {
      console.log(`🔫 Selecting murder weapon...`);
      selectedWeapon = await WeaponService.selectWeapon({
        scene: body.scenario,
        style: body.style,
        preferSpecific: true
      });
      console.log(`✅ Selected weapon: ${selectedWeapon?.name?.es}`);
    }

    // Generar número aleatorio para el asesino
    const randomKillerIndex = Math.floor(Math.random() * body.suspects) + 1;
    console.log(`🎲 Random killer suggestion: player-${randomKillerIndex}`);
    
    // Decidir quién descubrió el cuerpo
    const discoveredByIsKiller = Math.random() < 0.3;
    const discoveredByPlayerIndex = discoveredByIsKiller 
      ? randomKillerIndex 
      : Math.floor(Math.random() * body.suspects) + 1;
    console.log(`🔍 Body discovered by: player-${discoveredByPlayerIndex} (${discoveredByIsKiller ? 'ASESINO' : 'INOCENTE'})`);

    // Crear prompt para OpenAI
    const prompt = createImpostorCasePrompt(
      body, 
      selectedSuspects, 
      selectedWeapon, 
      language, 
      randomKillerIndex, 
      playerNames, 
      playerGenders, 
      discoveredByPlayerIndex
    );

    console.log('🤖 Calling OpenAI for impostor case generation...');
    
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Crea casos de misterio tipo impostor (como Among Us). Idioma: ${language === 'es' ? 'ESPAÑOL' : 'INGLÉS'}. El asesino es FIJO (player-X indicado). Cada jugador tiene información personal (coartada, ubicación, qué hizo). Uno es el asesino con coartada falsa. Responde SOLO JSON válido.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    console.log('✅ OpenAI response received');

    // Parsear respuesta
    let parsedCase: ImpostorCaseResponse;
    try {
      parsedCase = JSON.parse(response);
    } catch (parseError) {
      const cleanedResponse = response
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      parsedCase = JSON.parse(cleanedResponse);
    }
    
    // Asignar URLs reales de Supabase a los jugadores
    if (parsedCase.players && selectedSuspects) {
      console.log('🔧 Matching players to Supabase photos...');
      
      const remaining = [...selectedSuspects];
      const usedIds = new Set<string>();

      function scoreMatch(gen: any, orig: any): number {
        let score = 0;
        const genRole = (gen.role || '').toString().toLowerCase().trim();
        const origOccEs = (orig.occupation?.es || orig.occupation || '').toString().toLowerCase().trim();
        const origOccEn = (orig.occupation?.en || '').toString().toLowerCase().trim();
        
        if (genRole && (genRole === origOccEs || genRole === origOccEn)) score += 5;
        else if (genRole && (origOccEs.includes(genRole) || genRole.includes(origOccEs))) score += 3;

        if (gen.gender && orig.gender && gen.gender === orig.gender) score += 2;

        if (typeof gen.age === 'number' && typeof orig.approx_age === 'number') {
          const diff = Math.abs(gen.age - orig.approx_age);
          if (diff <= 1) score += 2;
          else if (diff <= 3) score += 1;
        }

        return score;
      }

      parsedCase.players = parsedCase.players.map((gen) => {
        let best = null as any;
        let bestScore = -1;
        
        remaining.forEach((orig) => {
          if (usedIds.has(orig.id)) return;
          const s = scoreMatch(gen, orig);
          if (s > bestScore) {
            best = orig;
            bestScore = s;
          }
        });

        if (!best) {
          best = remaining.find((o) => !usedIds.has(o.id));
        }

        if (best?.id) usedIds.add(best.id);

        if (best?.image_url) {
          console.log(`✅ Matched "${gen.name}" → ${best.occupation?.es}`);
          return { ...gen, photo: best.image_url };
        }
        return gen;
      });
    }

    // Preservar URL del arma
    if (selectedWeapon && parsedCase.weapon) {
      console.log(`✅ Assigning weapon photo: ${selectedWeapon.image_url}`);
      parsedCase.weapon.photo = selectedWeapon.image_url;
    }

    // Agregar información de configuración
    parsedCase.config = {
      caseType: body.caseType,
      totalClues: body.clues,
      scenario: body.scenario,
      difficulty: body.difficulty,
    };

    console.log('✅ Impostor case generated successfully');
    console.log(`   Killer: ${parsedCase.hiddenContext.killerId}`);
    console.log(`   Players: ${parsedCase.players.length}`);

    res.json(parsedCase);
    
  } catch (error) {
    console.error('Error in generate-impostor-case API:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    res.status(500).json({
      error: 'Failed to generate impostor case',
      details: errorMessage,
    });
  }
});

// Función createImpostorCasePrompt (copiar desde el archivo original)
function createImpostorCasePrompt(
  request: ImpostorCaseGenerationRequest,
  selectedSuspects: any[],
  selectedWeapon: any,
  language: string,
  randomKillerIndex: number,
  playerNames: string[],
  playerGenders: string[],
  discoveredByPlayerIndex: number
): string {
  // ... (copiar toda la función createImpostorCasePrompt del archivo original)
  // Esta función es muy larga, así que cópiala completa desde app/api/generate-impostor-case/route.ts
  // líneas 265-512
  const { caseType, suspects, clues, scenario, difficulty } = request

  const suspectsInfo = selectedSuspects.map(s => `
- Género: ${s.gender}
- Edad aproximada: ${s.approx_age}
- Ocupación: ${language === 'es' ? s.occupation?.es : s.occupation?.en || s.occupation}
- Tags: ${s.tags?.join(', ') || 'sin tags'}
- URL de imagen: ${s.image_url}
`).join('\n')

  const weaponInfo = selectedWeapon ? `
**ARMA HOMICIDA:**
- Nombre: ${language === 'es' ? selectedWeapon.name.es : selectedWeapon.name.en}
- Tags: ${selectedWeapon.tags?.join(', ') || 'sin tags'}
- URL de imagen: ${selectedWeapon.image_url}
` : ''

  const namesInfo = playerNames.length > 0 
    ? `\n**NOMBRES DE JUGADORES PROPORCIONADOS:**\n${playerNames.map((name, i) => {
        const gender = playerGenders[i] || 'unknown'
        return `- Player ${i + 1}: ${name} (${gender === 'male' ? 'hombre' : gender === 'female' ? 'mujer' : 'desconocido'})`
      }).join('\n')}\n\nUsa estos nombres EXACTOS para los jugadores en el orden proporcionado. Si hay más jugadores que nombres, genera nombres apropiados para los restantes basándote en el género y ocupación de cada uno.`
    : '\n**NOMBRES:** Genera nombres apropiados para todos los jugadores basándote en el género y ocupación de cada uno.\n'
  
  const gendersInfo = playerGenders.length > 0
    ? `\n**GÉNEROS DE JUGADORES PROPORCIONADOS:**\n${playerGenders.map((gender, i) => `- Player ${i + 1}: ${gender}`).join('\n')}\n\nUsa estos géneros EXACTOS para los jugadores en el orden proporcionado. Si hay más jugadores que géneros, asigna géneros apropiados basándote en la ocupación y otros factores.\n`
    : '\n**GÉNEROS:** Asigna géneros apropiados a todos los jugadores basándote en la ocupación y otros factores.\n'

  return `
Genera un caso de misterio tipo "IMPOSTOR" (como Among Us) con la siguiente configuración:

**CONFIGURACIÓN:**
- Tipo de caso: ${caseType}
- Número de jugadores: ${suspects}
- Número total de pistas: ${clues}
- Escenario: ${scenario}
- Dificultad: ${difficulty}

**JUGADORES DE SUPABASE:**
${suspectsInfo}
${namesInfo}
${gendersInfo}

**REGLAS PARA JUGADORES - PRIMERA PERSONA Y CONTEXTO:**
1. Usa EXACTAMENTE los géneros, edades y ocupaciones proporcionados
2. ${playerNames.length > 0 ? 'Usa los nombres proporcionados cuando estén disponibles, genera nombres apropiados para los restantes' : 'Genera nombres que coincidan con el género'}
3. Usa EXACTAMENTE las URLs de imagen proporcionadas como campo "photo"
4. **IMPORTANTE: TODA LA INFORMACIÓN DEBE ESTAR EN PRIMERA PERSONA** - El jugador está leyendo su propia información
5. Cada jugador debe tener información personal completa y detallada:
   - **isKiller**: true para UNO SOLO (player-${randomKillerIndex}), false para todos los demás
   - **description**: Descripción de personalidad EN PRIMERA PERSONA (ej: "Soy una persona...", "Tengo...")
   - **alibi**: Coartada detallada EN PRIMERA PERSONA CON HORAS ESPECÍFICAS (ej: "Yo estaba en la cocina desde las 9:30pm hasta las 10:15pm...", "Estuve en el salón principal entre las 9:45pm y las 10:00pm...") - Si es el asesino, debe ser FALSA pero creíble y defendible. DEBE incluir horas específicas o rangos de tiempo.
   - **location**: Dónde estaba durante el crimen (en primera persona: "Estaba en...")
   - **whereWas**: Descripción detallada EN PRIMERA PERSONA de dónde estaba con contexto Y HORAS (ej: "Yo estaba en el salón principal, cerca de la ventana que da al jardín, desde aproximadamente las 9:40pm hasta las 10:10pm...")
   - **whatDid**: Qué estaba haciendo EN PRIMERA PERSONA con detalles específicos Y HORAS (ej: "Estaba conversando con [nombre] sobre... desde las 9:50pm hasta las 10:05pm", "Estaba revisando... entre las 9:45pm y las 10:00pm")
   - **suspiciousBehavior**: Comportamiento sospechoso EN PRIMERA PERSONA si aplica (ej: "Me vi nervioso porque...")
- **whySuspicious**: Motivo por el que es sospechoso EN PRIMERA PERSONA (OBLIGATORIO para todos). **DEBE ser un motivo REAL, CREÍBLE y ESPECÍFICO que justifique por qué es sospechoso.** Ejemplos:
  * "Tuve una discusión acalorada con [víctima] hace dos días porque pensó que no entregué unos informes a tiempo y me amenazó con despedirme."
  * "Estaba cerca de la escena del crimen (en la cocina buscando hielo) cuando ocurrió el crimen, y no tengo testigos que puedan confirmarlo."
  * "Tengo un conflicto financiero con [víctima] relacionado con [razón específica: dinero, herencia, deuda, etc.]."
  * "La víctima me acusó públicamente de [razón específica] hace una semana, lo que me causó problemas."
  * "Tenía acceso exclusivo al [lugar/arma] que se usó en el crimen."
  * **CRÍTICO: TODOS los jugadores (inocentes y asesino) DEBEN tener motivos REALES y CREÍBLES. NO uses motivos vagos como "me siento incómoda con la tensión" - debe ser algo específico y concreto.**
  * Este motivo debe ser creíble y permitir defensa. Para el asesino, debe ser un motivo que pueda explicar pero que también pueda ser contradicho por descubrimientos posteriores.
   - **additionalContext**: Contexto adicional MUY DETALLADO EN PRIMERA PERSONA (OBLIGATORIO para todos los jugadores). Para el ASESINO: debe incluir que es el asesino, dónde realmente estaba, su coartada falsa, testigos que pueden 'confirmar' su coartada, inconsistencias posibles y cómo explicarlas. Si descubrió el cuerpo, incluir por qué estaba ahí y cómo defenderse. Para los INOCENTES: debe incluir relaciones con otros jugadores si aplica, testigos que pueden confirmar coartada si aplica, detalles específicos sobre ubicación y actividades, qué vieron/escucharon, observaciones sobre otros jugadores, información sobre la víctima si la conocían.. Debe ser tan detallado como el del asesino para evitar diferencias visuales.

**VÍCTIMA - DETALLES COMPLETOS:**
Crea una víctima con TODOS estos campos:
- Nombre, edad, rol/profesión
- Descripción BREVE de su personalidad (1-2 oraciones máximo)
${caseType === 'asesinato' ? `- **causeOfDeath**: Causa de muerte específica y detallada (relacionada con el arma: ${language === 'es' ? selectedWeapon?.name.es : selectedWeapon?.name.en || 'arma genérica'})` : ''}
- **timeOfDeath**: Hora de muerte estimada
- **discoveredBy**: DEBE ser "player-${discoveredByPlayerIndex}" CON LA HORA (ej: "player-${discoveredByPlayerIndex}, la sumeller a las 11:00pm")
- **location**: Ubicación exacta y detallada
- **bodyPosition**: Descripción detallada de la posición del cuerpo
- **visibleInjuries**: Heridas visibles específicas
- **objectsAtScene**: Objetos específicos encontrados en la escena
- **signsOfStruggle**: Señales de lucha detalladas

**IMPORTANTE - QUIEN DESCUBRIÓ EL CUERPO:**
- El campo "discoveredBy" DEBE ser "player-${discoveredByPlayerIndex}" CON LA HORA
- **CRÍTICO: CUALQUIERA puede ser el culpable, incluso quien descubrió el cuerpo. NO asumas que quien descubrió el cuerpo es inocente.**
${discoveredByPlayerIndex === randomKillerIndex ? `
- ⚠️ **EL ASESINO (player-${randomKillerIndex}) ES QUIEN DESCUBRIÓ EL CUERPO**
- Para el asesino, esto es CRÍTICO y debe incluir en su "additionalContext":
  * "IMPORTANTE: Yo fui quien 'descubrí' el cuerpo. Debo explicar por qué estaba ahí: [razón creíble como 'fui a buscar algo', 'escuché un ruido', etc.]"
  * "Si me preguntan por qué descubrí el cuerpo, debo decir: [explicación creíble]"
  * "Cómo defenderme de ser sospechoso por haberlo descubierto: [estrategia de defensa como 'fui el primero en llegar porque estaba cerca', 'otros también podrían haberlo encontrado', etc.]"
` : `
- **UN INOCENTE (player-${discoveredByPlayerIndex}) ES QUIEN DESCUBRIÓ EL CUERPO**
- Para este jugador inocente, debe incluir en su "additionalContext" o "whatDid":
  * "Fui quien descubrí el cuerpo. Estaba en [lugar] porque [razón creíble]"
  * "Qué me llamó la atención: [un ruido, un olor, algo fuera de lugar, una puerta abierta, etc.]"
  * "Cómo encontré el cuerpo: [descripción detallada de cómo lo descubrió]"
  * "Mi reacción: [cómo reaccioné al encontrarlo]"
  * "Por qué estaba en ese lugar en ese momento: [razón específica y creíble]"
`}

${caseType === 'asesinato' && selectedWeapon ? `
**ARMA (SOLO PARA ASESINATO):**
Incluye el arma con:
- Nombre: "${language === 'es' ? selectedWeapon.name.es : selectedWeapon.name.en}"
- Descripción detallada del arma
- Ubicación donde se encontró
- Importancia: "high"
- Photo: "${selectedWeapon.image_url}"
` : ''}

**ASESINO FIJO - OBLIGATORIO:**
🎲 **EL ASESINO DEBE SER: player-${randomKillerIndex}**

⚠️ **ESTO NO ES UNA SUGERENCIA - ES OBLIGATORIO:**
- El asesino para este caso ES: player-${randomKillerIndex}
- NO elijas otro jugador diferente
- El asesino queda FIJO desde esta primera generación

**REGLAS SOBRE EL ASESINO (player-${randomKillerIndex}) - CRÍTICO:**
- Debe tener motivo fuerte y creíble
- Debe tener conexión lógica con la víctima
- Debe tener acceso al arma o escena del crimen
- **IMPORTANTE: El asesino SABE que es el asesino y debe tener información REAL sobre el crimen:**
  - **isKiller**: true (debe estar marcado como asesino)
  - **alibi**: Debe ser una coartada FALSA pero CREÍBLE que el asesino va a usar para mentir (ej: "Yo estaba en la bodega eligiendo vinos para la cena y no escuché nada")
  - **location**: Debe indicar dónde REALMENTE estaba (la escena del crimen) - información REAL para el asesino (ej: "Estaba en la cocina del barco, junto a la nevera, donde cometí el crimen")
  - **whereWas**: Descripción detallada de dónde REALMENTE estaba durante el crimen (escena del crimen) - información REAL para el asesino
  - **whatDid**: Qué REALMENTE estaba haciendo (cometiendo el crimen) - información REAL para el asesino (ej: "Estaba cometiendo el asesinato con el hacha en la cocina")
  - **suspiciousBehavior**: Comportamiento que podría ser sospechoso y cómo explicarlo/defenderse
  - **additionalContext**: Información CRÍTICA para el asesino en primera persona que DEBE incluir:
    * "Soy el asesino. Realmente estaba en [escena del crimen exacta] cuando cometí el crimen a las [hora aproximada]."
    * "Mi coartada falsa es: [coartada CON HORAS ESPECÍFICAS]. Debo usar esta coartada para defenderme."
    * "Testigos que pueden 'confirmar' mi coartada falsa: [nombres de otros jugadores que podrían haber visto algo relacionado]"
    * "Inconsistencias que podría tener: [lista de posibles inconsistencias]. Cómo explicarlas: [explicaciones creíbles]"
    * "HORAS IMPORTANTES: Llegué a [lugar de la coartada falsa] a las [hora], pero realmente cometí el crimen a las [hora real]. Puedo decir que llegué antes para justificar mi coartada, o que llegué después si me preguntan."
    ${discoveredByPlayerIndex === randomKillerIndex ? `
    * "IMPORTANTE: Yo fui quien 'descubrí' el cuerpo. Debo explicar por qué estaba ahí: [razón creíble como 'fui a buscar algo', 'escuché un ruido', 'necesitaba algo de la cocina', etc.]"
    * "Cómo defenderme de ser sospechoso por haberlo descubierto: [estrategia de defensa como 'fui el primero en llegar porque estaba cerca', 'otros también podrían haberlo encontrado', 'fue casualidad que pasara por ahí', etc.]"
    ` : ''}
- Sus traits deben conectar sutilmente con el método del crimen

**REGLAS SOBRE LOS OTROS JUGADORES (INOCENTES):**
- Todos deben tener coartadas VERDADERAS
- Deben tener ubicaciones y actividades claras EN PRIMERA PERSONA
  - **DEBEN tener información MUY DETALLADA en primera persona CON HORAS:**
    - Detalles específicos de dónde estaban CON HORAS ESPECÍFICAS (qué vieron, qué escucharon, con quién hablaron, a qué hora)
    - Testigos o personas que pueden confirmar su coartada si aplica Y LAS HORAS 
    - Contexto adicional sobre sus relaciones con otros jugadores, si aplica
    - Información suficiente para responder preguntas específicas y defenderse
    - Si no recuerdan bien la hora exacta, pueden tener incertidumbre (ej: "Creo que era alrededor de las 9:50pm, pero no estoy completamente seguro porque estaba distraído")
- **IMPORTANTE: Todos los INOCENTES DEBEN tener un campo "additionalContext" con información detallada:**
  * Relaciones con otros jugadores (qué piensan de ellos, si tienen conflictos, etc.)
  * Testigos que pueden confirmar su coartada (nombres específicos de otros jugadores) si aplica, no es obligatorio
  * Detalles específicos sobre su ubicación y actividades
  * Información sobre qué vieron o escucharon durante el tiempo del crimen
  * Cualquier detalle que pueda ser útil para defenderse o hacer acusaciones
  * Si tienen comportamientos sospechosos, explicaciones detalladas
  * Información sobre la víctima (si la conocían, qué relación tenían, etc.)
  * Observaciones sobre otros jugadores que podrían ser relevantes
- **Si un INOCENTE descubrió el cuerpo (discoveredBy = su nombre):**
  * Debe tener una razón creíble de por qué estaba en ese lugar en ese momento
  * Debe tener información sobre qué le llamó la atención (un ruido, un olor, algo fuera de lugar, etc.)
  * Debe tener detalles sobre cómo encontró el cuerpo (qué vio primero, cómo reaccionó, etc.)
  * Esta información DEBE estar en su "additionalContext"
  * Debe poder explicar por qué estaba ahí sin parecer sospechoso
- Algunos pueden tener comportamientos sospechosos pero son inocentes (deben tener explicación en primera persona)
- La diferencia está en las PISTAS SUTILES que solo apuntan al asesino real (player-${randomKillerIndex})
- **CRÍTICO: El "additionalContext" de los inocentes debe ser TAN DETALLADO como el del asesino para evitar que se note la diferencia**

**CONTEXTO OCULTO (hiddenContext):**
En el objeto "hiddenContext" incluye:
- "killerId": ID del jugador asesino (player-${randomKillerIndex})
- "killerReason": Razón detallada de por qué es el asesino (2-3 oraciones)
- "keyClues": Array de 3-5 pistas clave que apuntan al asesino
- "killerTraits": Array de traits del asesino que conectan con el crimen

**FORMATO JSON ESPERADO:**
{
  "caseTitle": "Título del caso",
  "caseDescription": "Descripción breve del contexto del caso",
  "victim": {
    "name": "Nombre",
    "age": 45,
    "role": "Profesión",
    "description": "Descripción breve de personalidad (1-2 oraciones)",
    "causeOfDeath": "Causa específica",
    "timeOfDeath": "Entre 9:45pm y 10:15pm",
    "discoveredBy": "Sofía, la sumeller a las 11:00pm",
    "location": "Ubicación exacta",
    "bodyPosition": "Descripción de la posición",
    "visibleInjuries": "Heridas visibles",
    "objectsAtScene": "Objetos encontrados",
    "signsOfStruggle": "Señales de lucha"
  },
  "players": [
    {
      "id": "player-1",
      "name": "Nombre del jugador",
      "age": 35,
      "role": "Ocupación exacta de Supabase",
      "description": "Descripción de personalidad EN PRIMERA PERSONA (ej: Soy una persona...)",
      "isKiller": false,
      "alibi": "Coartada detallada EN PRIMERA PERSONA CON HORAS ESPECÍFICAS (ej: Yo estaba en la cocina desde las 9:30pm hasta las 10:15pm... Estuve en el salón entre las 9:45pm y las 10:00pm...)",
      "location": "Dónde estaba durante el crimen (en primera persona)",
      "whereWas": "Descripción detallada EN PRIMERA PERSONA de dónde estaba con contexto específico Y HORAS (ej: Yo estaba en el salón principal, cerca de la ventana, desde aproximadamente las 9:40pm hasta las 10:10pm)",
      "whatDid": "Qué estaba haciendo EN PRIMERA PERSONA con detalles específicos Y HORAS (ej: Estaba conversando con [nombre] sobre... desde las 9:50pm hasta las 10:05pm)",
      "suspiciousBehavior": "Comportamiento sospechoso EN PRIMERA PERSONA si aplica (opcional)",
      "whySuspicious": "Motivo por el que es sospechoso EN PRIMERA PERSONA (ej: 'Tuve una discusión con la víctima hace dos días', 'Estaba cerca del lugar del crimen', 'Tengo un conflicto con alguien relacionado', etc.). Este motivo debe ser creíble y permitir defensa.",
      "additionalContext": "Contexto adicional MUY DETALLADO EN PRIMERA PERSONA (OBLIGATORIO para todos). Para el ASESINO: debe incluir que es el asesino, dónde realmente estaba, su coartada falsa, testigos que pueden 'confirmar' su coartada, inconsistencias posibles y cómo explicarlas. Si descubrió el cuerpo, incluir por qué estaba ahí y cómo defenderse. Para los INOCENTES: debe incluir relaciones con otros jugadores, testigos que pueden confirmar coartada, detalles específicos sobre ubicación y actividades, qué vieron/escucharon, observaciones sobre otros jugadores, información sobre la víctima si la conocían, explicaciones de comportamientos sospechosos. Debe ser tan detallado como el del asesino para evitar diferencias visuales.",
      "photo": "URL de Supabase",
      "traits": ["trait1", "trait2", "trait3"],
      "gender": "male/female"
    }
  ],
  ${caseType === 'asesinato' ? `"weapon": {
    "id": "weapon-1",
    "name": "${language === 'es' ? selectedWeapon?.name.es : selectedWeapon?.name.en || 'arma'}",
    "description": "Descripción detallada",
    "location": "Donde se encontró",
    "photo": "${selectedWeapon?.image_url || ''}",
    "importance": "high"
  },` : ''}
  "hiddenContext": {
    "killerId": "player-${randomKillerIndex}",
    "killerReason": "Razón detallada de por qué player-${randomKillerIndex} es el asesino (2-3 oraciones)",
    "keyClues": ["pista1 que conecta con player-${randomKillerIndex}", "pista2 que conecta con player-${randomKillerIndex}", "pista3 sutil"],
    "killerTraits": ["trait que conecta con el crimen", "trait que da una pista sutil"]
  }
}

**CRÍTICO - LEER ATENTAMENTE:**
- ⚠️ **EL ASESINO OBLIGATORIAMENTE ES: player-${randomKillerIndex}**
- ⚠️ **NO cambies este ID bajo ninguna circunstancia**
- El asesino (player-${randomKillerIndex}) tiene una coartada FALSA pero debe poder defenderse
- Todos los jugadores deben tener información suficiente para responder preguntas
- El JSON debe ser válido, sin errores
- Todos los strings en una sola línea
- **RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior.**
`
}
export default router;
