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

    const { language = 'es', playerNames: rawPlayerNames = [], playerGenders: rawPlayerGenders = [] } = body;

    // Normalizar playerNames: puede venir como array de strings o array de objetos { name, gender }
    const playerNames: string[] = rawPlayerNames.map((item: any) => {
      if (typeof item === 'string') {
        return item;
      } else if (item && typeof item === 'object' && item.name) {
        return item.name;
      }
      return String(item || '');
    });

    // Normalizar playerGenders: puede venir como array de strings o extraerse de los objetos
    const playerGenders: string[] = rawPlayerGenders.length > 0 
      ? rawPlayerGenders.map((item: any) => typeof item === 'string' ? item : String(item || ''))
      : rawPlayerNames.map((item: any) => {
          if (item && typeof item === 'object' && item.gender) {
            return item.gender;
          }
          return '';
        }).filter(g => g);

    // Obtener sospechosos reales desde Supabase
    console.log(`🔍 Fetching ${body.suspects} suspects from Supabase...`);
    if (playerGenders.length > 0) {
      console.log(`👥 Player genders provided: ${playerGenders.join(', ')}`);
    }
    
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
    
    // PRIMERO: Si hay nombres proporcionados, sobrescribirlos ANTES de hacer el matching
    if (parsedCase.players && playerNames && playerNames.length > 0) {
      console.log('🔧 Applying provided player names to players...');
      parsedCase.players = parsedCase.players.map((player: any, index: number) => {
        // Asegurar que name sea un string válido
        let name: string = player.name;
        if (typeof name === 'object' && name !== null) {
          name = (name as any).toString() || String(name);
          console.warn(`⚠️ Player ${index + 1} name was an object, converted to: "${name}"`);
        } else if (typeof name !== 'string') {
          name = String(name || '');
        }
        
        // Si hay un nombre proporcionado para este índice, usarlo
        if (playerNames[index]) {
          name = playerNames[index];
          console.log(`✅ Applied provided name for player-${index + 1}: "${name}"`);
        }
        
        return { ...player, name: name };
      });
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
   - **alibi**: Coartada COMPLETA EN PRIMERA PERSONA que DEBE incluir TODO: dónde estaba, qué estaba haciendo, con quién (si aplica), y HORAS ESPECÍFICAS. Formato: "Yo estaba en [ubicación específica] desde las [hora inicio] hasta las [hora fin], [qué estaba haciendo específicamente]. [Detalles adicionales: con quién hablaba, qué vio, qué escuchó, etc.]" - Si es el asesino, debe ser FALSA pero creíble y defendible. Ejemplo: "Yo estaba en la bodega del barco desde las 9:30pm hasta las 10:15pm, seleccionando vinos para la cena. Estuve hablando con el chef sobre los maridajes y revisando el inventario. No escuché nada fuera de lo normal."
   - **location**: (DEPRECADO - la información ya está en alibi) Mantener por compatibilidad pero puede ser una versión resumida del alibi
   - **whereWas**: (DEPRECADO - la información ya está en alibi) Mantener por compatibilidad pero puede ser una versión resumida del alibi
   - **whatDid**: (DEPRECADO - la información ya está en alibi) Mantener por compatibilidad pero puede ser una versión resumida del alibi
   - **suspiciousBehavior**: Comportamiento sospechoso EN PRIMERA PERSONA si aplica (ej: "Me vi nervioso porque...")
   - **whySuspicious**: Motivo por el que es sospechoso EN PRIMERA PERSONA (OBLIGATORIO para todos). **CRÍTICO: DEBE ser un motivo REAL, CREÍBLE, ESPECÍFICO y CONVINCENTE que justifique genuinamente por qué es sospechoso. NUNCA uses motivos vagos como "no tengo relación directa", "quizás mi presencia", "me siento incómodo", etc. - estos delatan inmediatamente que es inocente.** Ejemplos VÁLIDOS:
     * "Tuve una discusión acalorada con [víctima] hace dos días porque pensó que no entregué unos informes a tiempo y me amenazó con despedirme. [Un jugador] vio nuestra pelea (Esto debe aparecer tambien en el contexto adicional del jugador o jugadores que vieron la discusion)."
     * "Tengo un conflicto financiero con [víctima] relacionado con una deuda de $50,000 que me debe desde hace 6 meses. Le había amenazado con acciones legales la semana pasada."
     * "La víctima me acusó públicamente de robar dinero de la caja hace una semana, lo que me causó problemas con mi jefe. Estaba considerando demandarla por difamación, [Un jugador] me dijo que me apoyaria en el proceso (esto debe aparecer en el conexto adicional de la persona mencionada)."
     * "[Un jugador] dice que me vio salir de la escena del crimen a [hora comprometedora, pero no totalmente], pero solo estuve (excusa real si es inocente, inventada si es culpable)."
     * "Estaba cerca de la escena del crimen cuando ocurrió, y tengo un historial de conflictos con la víctima por [razón específica]."
     * "La víctima tenía información comprometedora sobre mí relacionada con [situación específica] que podría haber arruinado mi carrera."
     * **IMPORTANTE: Todos los jugadores (inocentes y asesino) DEBEN tener motivos REALES y CREÍBLES que los hagan genuinamente sospechosos. El objetivo es que TODOS tengan que demostrar por qué son inocentes.**
   - **additionalContext**: Contexto adicional MUY DETALLADO EN PRIMERA PERSONA (OBLIGATORIO para todos). **DEBE estar bien estructurado con TÍTULOS DE SECCIÓN en mayúsculas y doble salto de línea entre secciones para mejor legibilidad.** Para el ASESINO: debe incluir que es el asesino, dónde realmente estaba, su coartada falsa, testigos que pueden 'confirmar' su coartada, inconsistencias posibles y cómo explicarlas. Si descubrió el cuerpo, incluir por qué estaba ahí y cómo defenderse. Para los INOCENTES: DEBE incluir:
     * **RELACIONES CON OTROS JUGADORES**: Qué piensa de cada uno, si tiene conflictos, amistades, desconfianzas, etc. (mínimo 2-3 jugadores). **CRÍTICO: Usa los NOMBRES de los jugadores, NO sus roles (ej: "Tengo una buena relación con Sofía, pero he tenido discusiones con Carlos" en lugar de "Tengo una buena relación con el chef, pero he tenido discusiones con el empresario").**
     * **CONVERSACIONES Y ENCUENTROS**: Detalles de conversaciones que tuvo con otros jugadores (2-3 jugadores mínimo), qué hablaron, cuándo fue, si notó algo extraño. Si tuvo una conversación con otro jugador, AMBOS deben tener esa información en su additionalContext. **CRÍTICO: Usa los NOMBRES de los jugadores, NO sus roles.**
     * **GRUPOS DE CHAT/COMUNICACIÓN** (OPCIONAL - solo si tiene sentido en el contexto): Si hay un grupo de WhatsApp, Telegram, o similar donde varios jugadores están, incluir detalles específicos:
       - Mensajes que se enviaron en el grupo antes del crimen (fechas, horas aproximadas, contenido específico)
       - Si alguien dijo algo sobre la víctima (puede ser broma o serio, dependiendo del jugador)
       - Si alguien respondió de manera que pueda ser interpretada de diferentes formas
       - **IMPORTANTE**: NO siempre incluyas grupos de chat. Solo si tiene sentido en el contexto del caso (ej: si es un museo, puede haber un grupo del personal; si es un barco, puede haber un grupo de la tripulación). Si decides incluir uno, TODOS los jugadores involucrados deben tener esa información en su additionalContext con los mismos detalles (quién dijo qué, cuándo, cómo lo interpretaron). Si no tiene sentido en el contexto, NO incluyas grupos de chat.
     * **OBSERVACIONES SOSPECHOSAS**: Cosas que notó sobre otros jugadores que le parecieron sospechosas o extrañas (comportamientos, conversaciones, movimientos, discusiones con la víctima, etc.). **CRÍTICO: VARÍA las observaciones - NO siempre menciones al culpable como ansioso/nervioso. También menciona a otros sospechosos que parecían nerviosos, ansiosos, o comportándose de manera extraña. Distribuye las observaciones entre diferentes jugadores. Usa los NOMBRES de los jugadores, NO sus roles.**
     * **VISTAZOS Y MOMENTOS COMPARTIDOS**: Si vio a alguien en algún lugar específico, si compartió un momento con alguien, detalles de esos encuentros. **CRÍTICO: Usa los NOMBRES de los jugadores, NO sus roles.**
     * **RELACIONES PROFUNDAS**: Conexiones más profundas con algunos jugadores (trabajaron juntos antes, tienen historia, comparten secretos, etc.). **CRÍTICO: Usa los NOMBRES de los jugadores, NO sus roles.**
     * **TESTIGOS Y CONFIRMACIONES**: Quién puede confirmar su coartada, quién lo vio, con quién habló. **CRÍTICO: Usa los NOMBRES de los jugadores, NO sus roles.**
     * **QUÉ VIO/ESCUCHÓ**: Detalles específicos de lo que observó durante el tiempo del crimen
     * **INFORMACIÓN SOBRE LA VÍCTIMA**: Si la conocía, qué relación tenían, qué pensaba de ella, si tenía conflictos. **CRÍTICO: Usa el NOMBRE de la víctima, NO su rol.**
     * **EXPLICACIONES DE COMPORTAMIENTOS SOSPECHOSOS**: Si tiene comportamientos que podrían verse como sospechosos, si apoyó en algo malo a otro jugador, explicaciones detalladas
     * **DETALLES QUE INVOLUCREN A VARIOS JUGADORES**: Situaciones donde 2-3 jugadores estuvieron juntos (dependiendo el número de jugadores totales, el culpable puede estar incluido también), conversaciones grupales, momentos compartidos
     * **Formato OBLIGATORIO**: Usa TÍTULOS DE SECCIÓN en mayúsculas seguidos de dos puntos, y DOBLE salto de línea (dos líneas vacías) entre cada sección. Ejemplo:
       "RELACIONES CON OTROS JUGADORES:
       
       [texto sobre relaciones]
       
       
       CONVERSACIONES Y ENCUENTROS:
       
       [texto sobre conversaciones]
       
       
       OBSERVACIONES SOSPECHOSAS:
       
       [texto sobre observaciones - VARÍA entre diferentes jugadores, no siempre el culpable]
       
       
       [etc. con doble salto de línea entre cada sección]"
     * **CRÍTICO**: El additionalContext debe ser TAN DETALLADO como el del asesino para evitar diferencias visuales. Incluye suficientes conexiones entre personajes para generar preguntas y descubrimientos interesantes que involucren a varios sospechosos. Las conversaciones de grupo y mensajes deben estar documentadas en las fichas de TODOS los involucrados con los mismos detalles.
     * **CRÍTICO - CREATIVIDAD**: NO copies los ejemplos tal cual. Tómalos como INSPIRACIÓN y sé CREATIVO. Varía el contenido, las situaciones, los detalles. Cada caso debe ser único y diferente.

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
- Para este jugador inocente, debe incluir en su "additionalContext" (en una sección separada):
  
  Descubrimiento del cuerpo:
  
  Fui quien descubrí el cuerpo. Estaba en [lugar] porque [razón creíble].
  
  Qué me llamó la atención: [un ruido, un olor, algo fuera de lugar, una puerta abierta, etc.]
  
  Cómo encontré el cuerpo: [descripción detallada de cómo lo descubrió]
    
  Por qué estaba en ese lugar en ese momento: [razón específica y creíble]
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
  - **alibi**: Debe ser una coartada FALSA pero CREÍBLE que el asesino va a usar para mentir. Debe incluir dónde dice que estaba, qué dice que estaba haciendo, y HORAS ESPECÍFICAS. **CRÍTICO: Usa el NOMBRE del jugador, NO su rol (ej: "Estuve hablando con Sofía" en lugar de "Estuve hablando con el chef").** Ejemplo: "Yo estaba en la bodega del barco desde las 9:30pm hasta las 10:15pm, seleccionando vinos para la cena. Estuve hablando con [nombre del jugador] sobre los maridajes y revisando el inventario. No escuché nada fuera de lo normal."
  - **location**: (DEPRECADO - usar alibi) Versión resumida de la coartada falsa
  - **whereWas**: (DEPRECADO - usar alibi) Versión resumida de la coartada falsa
  - **whatDid**: (DEPRECADO - usar alibi) Versión resumida de la coartada falsa
  - **suspiciousBehavior**: Comportamiento que podría ser sospechoso y cómo explicarlo/defenderse
  - **whySuspicious**: Debe tener un motivo REAL y CREÍBLE que lo haga genuinamente sospechoso (igual que los inocentes)
  - **additionalContext**: Información CRÍTICA para el asesino en primera persona que DEBE incluir (con espacios entre secciones):
    * "Soy el asesino. Realmente estaba en [escena del crimen exacta] cuando cometí el crimen a las [hora aproximada]."
    
    Mi coartada falsa es: [coartada CON HORAS ESPECÍFICAS]. Debo usar esta coartada para defenderme.
    
    Testigos que pueden 'confirmar' mi coartada falsa: [nombres de otros jugadores que podrían haber visto algo relacionado, pero que no lo salva del todo]
    
    Inconsistencias que podría tener: [lista de posibles inconsistencias]. Cómo explicarlas: [explicaciones creíbles]
    
    HORAS IMPORTANTES: Llegué a [lugar de la coartada falsa] a las [hora], pero realmente cometí el crimen a las [hora real]. Puedo decir que llegué antes para justificar mi coartada, o que llegué después si me preguntan.
    ${discoveredByPlayerIndex === randomKillerIndex ? `
    
    IMPORTANTE: Yo fui quien 'descubrí' el cuerpo. Debo explicar por qué estaba ahí: [razón creíble como 'fui a buscar algo', 'escuché un ruido', 'necesitaba algo de la cocina', etc.]
    
    Cómo defenderme de ser sospechoso por haberlo descubierto: [estrategia de defensa como 'fui el primero en llegar porque estaba cerca', 'otros también podrían haberlo encontrado', 'fue casualidad que pasara por ahí', etc.]
    ` : ''}
    * También debe incluir relaciones con otros jugadores, conversaciones que tuvo (para mantener consistencia), y observaciones sobre otros jugadores (para no delatarse)
    * **CRÍTICO: Usa los NOMBRES de los jugadores, NO sus roles (ej: "Hablé con Sofía" en lugar de "Hablé con el chef").**
    * **Formato OBLIGATORIO**: Usa TÍTULOS DE SECCIÓN en mayúsculas seguidos de dos puntos, y DOBLE salto de línea (dos líneas vacías) entre cada sección, igual que los inocentes.
- Sus traits deben conectar sutilmente con el método del crimen

**REGLAS SOBRE LOS OTROS JUGADORES (INOCENTES):**
- Todos deben tener coartadas VERDADERAS
- **alibi**: Debe incluir TODO: dónde estaba, qué estaba haciendo, con quién (si aplica), y HORAS ESPECÍFICAS. Debe ser completo y detallado.
- **location**, **whereWas**, **whatDid**: (DEPRECADOS - la información ya está en alibi) Mantener por compatibilidad pero pueden ser versiones resumidas del alibi
- **whySuspicious**: Debe tener un motivo REAL, CREÍBLE y ESPECÍFICO que lo haga genuinamente sospechoso (nunca motivos vagos)
- **IMPORTANTE: Todos los INOCENTES DEBEN tener un campo "additionalContext" MUY DETALLADO con información estructurada (con espacios entre secciones):**
  * **Relaciones con otros jugadores**: Qué piensa de cada uno, si tiene conflictos, amistades, desconfianzas, etc. (mínimo 2-3 jugadores)
  * **Conversaciones y encuentros**: Detalles de conversaciones que tuvo con otros jugadores (mínimo 2-3 conversaciones con diferentes jugadores), qué hablaron, cuándo fue, si notó algo extraño. **CRÍTICO: Si un jugador tuvo una conversación con otro, AMBOS deben tener esa información en su additionalContext.**
  * **Observaciones sospechosas**: Cosas que notó sobre otros jugadores que le parecieron sospechosas o extrañas (comportamientos, conversaciones, movimientos, etc.) - mínimo 1-2 observaciones
  * **Vistazos y momentos compartidos**: Si vio a alguien en algún lugar específico, si compartió un momento con alguien, detalles de esos encuentros
  * **Relaciones profundas**: Conexiones más profundas con algunos jugadores (trabajaron juntos antes, tienen historia, comparten secretos, etc.)
  * **Testigos y confirmaciones**: Quién puede confirmar su coartada, quién lo vio, con quién habló
  * **Qué vio/escuchó**: Detalles específicos de lo que observó durante el tiempo del crimen
  * **Información sobre la víctima**: Si la conocía, qué relación tenían, qué pensaba de ella, si tenía conflictos
  * **Explicaciones de comportamientos sospechosos**: Si tiene comportamientos que podrían verse como sospechosos, explicaciones detalladas
  * **Detalles que involucren a varios jugadores**: Situaciones donde 2-3 jugadores estuvieron juntos, conversaciones grupales, momentos compartidos
  * **Formato**: Usa saltos de línea y espacios para separar las diferentes secciones para mejor legibilidad
- **Si un INOCENTE descubrió el cuerpo (discoveredBy = su nombre):**
  * Debe tener una razón creíble de por qué estaba en ese lugar en ese momento
  * Debe tener información sobre qué le llamó la atención (un ruido, un olor, algo fuera de lugar, etc.)
  * Debe tener detalles sobre cómo encontró el cuerpo (qué vio primero, cómo reaccionó, etc.)
  * Esta información DEBE estar en su "additionalContext"
  * Debe poder explicar por qué estaba ahí sin parecer sospechoso
- Algunos pueden tener comportamientos sospechosos pero son inocentes (deben tener explicación en primera persona)
- La diferencia está en las PISTAS SUTILES que solo apuntan al asesino real (player-${randomKillerIndex})
- **CRÍTICO: El "additionalContext" de los inocentes debe ser TAN DETALLADO como el del asesino para evitar que se note la diferencia. Debe incluir suficientes conexiones entre personajes para generar preguntas y descubrimientos interesantes que involucren a varios sospechosos.**

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
      "alibi": "Coartada COMPLETA EN PRIMERA PERSONA que incluye TODO: dónde estaba, qué estaba haciendo, con quién (si aplica), y HORAS ESPECÍFICAS. Ejemplo: 'Yo estaba en la zona de carga del museo desde las 9:00pm hasta las 10:30pm, organizando las cajas y hablando con algunos colegas sobre la logística del evento. Estuve revisando el material de la exposición y asegurándome de que todo estuviera en orden.'",
      "location": "Versión resumida del alibi (DEPRECADO - mantener por compatibilidad)",
      "whereWas": "Versión resumida del alibi (DEPRECADO - mantener por compatibilidad)",
      "whatDid": "Versión resumida del alibi (DEPRECADO - mantener por compatibilidad)",
      "suspiciousBehavior": "Comportamiento sospechoso EN PRIMERA PERSONA si aplica (opcional)",
      "whySuspicious": "Motivo REAL, CREÍBLE y ESPECÍFICO por el que es sospechoso EN PRIMERA PERSONA. NUNCA usar motivos vagos. Ejemplo: 'Tuve una discusión acalorada con [víctima] hace dos días porque pensó que no entregué unos informes a tiempo y me amenazó con despedirme. Varios testigos vieron nuestra pelea.'",
      "additionalContext": "Contexto adicional MUY DETALLADO EN PRIMERA PERSONA (OBLIGATORIO para todos), estructurado con TÍTULOS DE SECCIÓN en mayúsculas y DOBLE salto de línea entre secciones. Para el ASESINO: debe incluir que es el asesino, dónde realmente estaba, su coartada falsa, testigos que pueden 'confirmar' su coartada, inconsistencias posibles y cómo explicarlas. Si descubrió el cuerpo, incluir por qué estaba ahí y cómo defenderse. Para los INOCENTES: debe incluir RELACIONES CON OTROS JUGADORES (mínimo 2-3), CONVERSACIONES Y ENCUENTROS (mínimo 2-3 conversaciones - si dos jugadores hablaron, ambos deben tener esa info), GRUPOS DE CHAT/COMUNICACIÓN (OPCIONAL - solo si tiene sentido), OBSERVACIONES SOSPECHOSAS sobre otros jugadores (mínimo 1-2 - VARÍA entre diferentes jugadores, no siempre el culpable), VISTAZOS Y MOMENTOS COMPARTIDOS, RELACIONES PROFUNDAS, TESTIGOS Y CONFIRMACIONES, QUÉ VIO/ESCUCHÓ, INFORMACIÓN SOBRE LA VÍCTIMA, EXPLICACIONES DE COMPORTAMIENTOS SOSPECHOSOS, DETALLES QUE INVOLUCREN A VARIOS JUGADORES. Formato: TÍTULO EN MAYÚSCULAS seguido de dos puntos, luego doble salto de línea, luego el contenido. Ejemplo: 'RELACIONES CON OTROS JUGADORES:\n\n[contenido]\n\n\nCONVERSACIONES Y ENCUENTROS:\n\n[contenido]'",
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
- **🚨 CREATIVIDAD Y VARIEDAD - CRÍTICO:**
  * NO copies los ejemplos tal cual. Los ejemplos son solo INSPIRACIÓN.
  * Sé CREATIVO y ORIGINAL en cada caso.
  * Varía las situaciones, los detalles, las conexiones entre jugadores.
  * NO uses siempre los mismos patrones o estructuras.
  * Cada caso debe ser ÚNICO y DIFERENTE.
- **RESPONDE CON UN OBJETO JSON VÁLIDO siguiendo el formato del ejemplo anterior, pero siendo CREATIVO y NO copiando los ejemplos literalmente.**
`
}
export default router;
