# 🔌 Integración del Frontend con el Backend

## Endpoint: `/api/generate-initial-case`

### Petición desde el Frontend

```typescript
// Ejemplo en TypeScript/React
async function generateInitialCase() {
  try {
    const response = await fetch('https://api.misterymaker.com/api/generate-initial-case', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        caseType: 'asesinato',
        suspects: 3,
        clues: 8,
        scenario: 'mansion',
        difficulty: 'normal',
        style: 'realistic',
        language: 'es'
      })
    });

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`);
    }

    const caseData = await response.json();
    return caseData;
  } catch (error) {
    console.error('Error generating case:', error);
    throw error;
  }
}
```

### Respuesta del Backend (JSON)

El backend retorna un objeto `InitialCaseResponse` con esta estructura:

```typescript
{
  caseTitle: string              // "El Misterio en la Mansión"
  caseDescription: string        // Descripción breve del caso
  victim: {
    name: string                 // "Ricardo Martínez"
    age: number                  // 50
    role: string                 // "Propietario de la mansión"
    description: string          // Descripción de personalidad
    causeOfDeath?: string        // "Golpe en la cabeza..."
    timeOfDeath?: string         // "Entre las 9:45pm y 10:15pm"
    discoveredBy?: string        // "El mayordomo James a las 6:30am"
    location?: string            // "En el salón principal..."
    bodyPosition?: string        // "Boca abajo..."
    visibleInjuries?: string     // "Herida profunda..."
    objectsAtScene?: string      // "Lámpara rota..."
    signsOfStruggle?: string     // "Silla volcada..."
  }
  suspects: [
    {
      id: string                 // "suspect-1"
      name: string               // "Sofía López"
      age: number                // 32
      role: string               // "Sumeller"
      description: string        // Descripción de personalidad
      motive: string             // Motivo para el crimen
      alibi: string              // Coartada con huecos
      timeGap?: string           // "Unos 20 minutos..."
      suspicious: boolean        // true
      photo: string              // URL de imagen de Supabase
      traits: string[]           // ["Celosa", "Conocimiento..."]
      lastSeen: string           // "Última vez vista..."
      gender?: string            // "female"
    }
  ]
  weapon?: {                     // Solo si caseType === 'asesinato'
    id: string                   // "weapon-1"
    name: string                 // "lampara rota"
    description: string          // Descripción del arma
    location: string             // "Junto al cuerpo..."
    photo: string                // URL de imagen de Supabase
    importance: 'high'
  }
  hiddenContext: {               // ⚠️ NO mostrar al usuario
    guiltyId: string             // "suspect-2" (ID del culpable)
    guiltyReason: string         // Razón detallada
    keyClues: string[]           // Pistas clave
    guiltyTraits: string[]       // Traits del culpable
  }
  config: {
    caseType: string             // "asesinato"
    totalClues: number           // 8
    scenario: string             // "mansion"
    difficulty: string           // "normal"
  }
}
```

### Ejemplo de Uso en React

```typescript
import { useState } from 'react';

interface InitialCaseResponse {
  caseTitle: string;
  caseDescription: string;
  victim: {
    name: string;
    age: number;
    role: string;
    description: string;
    causeOfDeath?: string;
    timeOfDeath?: string;
    discoveredBy?: string;
    location?: string;
    // ... otros campos
  };
  suspects: Array<{
    id: string;
    name: string;
    age: number;
    role: string;
    photo: string;
    motive: string;
    alibi: string;
    // ... otros campos
  }>;
  weapon?: {
    name: string;
    photo: string;
    // ... otros campos
  };
  hiddenContext: {
    guiltyId: string;
    guiltyReason: string;
    keyClues: string[];
    guiltyTraits: string[];
  };
  config: {
    caseType: string;
    totalClues: number;
    scenario: string;
    difficulty: string;
  };
}

function CaseGenerator() {
  const [loading, setLoading] = useState(false);
  const [caseData, setCaseData] = useState<InitialCaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generateCase = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('https://api.misterymaker.com/api/generate-initial-case', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caseType: 'asesinato',
          suspects: 3,
          clues: 8,
          scenario: 'mansion',
          difficulty: 'normal',
          style: 'realistic',
          language: 'es'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error al generar el caso');
      }

      const data = await response.json();
      setCaseData(data);
      
      // Guardar el guiltyId para validar acusación final
      // (pero NO mostrarlo al usuario)
      console.log('Culpable (oculto):', data.hiddenContext.guiltyId);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Generando caso...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!caseData) return <button onClick={generateCase}>Generar Caso</button>;

  return (
    <div>
      <h1>{caseData.caseTitle}</h1>
      <p>{caseData.caseDescription}</p>
      
      <h2>Víctima: {caseData.victim.name}</h2>
      <p>Edad: {caseData.victim.age}</p>
      <p>Rol: {caseData.victim.role}</p>
      {caseData.victim.causeOfDeath && (
        <p>Causa de muerte: {caseData.victim.causeOfDeath}</p>
      )}
      
      <h2>Sospechosos</h2>
      {caseData.suspects.map((suspect) => (
        <div key={suspect.id}>
          <img src={suspect.photo} alt={suspect.name} />
          <h3>{suspect.name}</h3>
          <p>{suspect.role}, {suspect.age} años</p>
          <p>Motivo: {suspect.motive}</p>
          <p>Coartada: {suspect.alibi}</p>
        </div>
      ))}
      
      {caseData.weapon && (
        <div>
          <h2>Arma</h2>
          <img src={caseData.weapon.photo} alt={caseData.weapon.name} />
          <p>{caseData.weapon.name}</p>
          <p>{caseData.weapon.description}</p>
        </div>
      )}
    </div>
  );
}
```

### Puntos Importantes

1. **URL del Backend**: 
   - Desarrollo: `http://localhost:3001/api/generate-initial-case`
   - Producción: `https://api.misterymaker.com/api/generate-initial-case`

2. **Tiempo de Respuesta**: 
   - Puede tardar 30-60 segundos (generación con OpenAI)
   - Implementa loading state y timeout si es necesario

3. **hiddenContext**: 
   - ⚠️ **NO mostrar al usuario**
   - Úsalo solo para validar la acusación final
   - Guárdalo en estado local o backend

4. **Manejo de Errores**:
   ```typescript
   if (!response.ok) {
     const errorData = await response.json();
     // errorData.error contiene el mensaje
     // errorData.details contiene detalles adicionales (solo en desarrollo)
   }
   ```

5. **CORS**: 
   - El backend ya está configurado para aceptar requests desde `misterymaker.com`
   - No deberías tener problemas de CORS

### Validación de Acusación Final

Cuando el usuario haga su acusación final, compara:

```typescript
// Usuario acusa a "suspect-2"
const userAccusation = "suspect-2";
const actualGuilty = caseData.hiddenContext.guiltyId;

if (userAccusation === actualGuilty) {
  // ¡Correcto!
} else {
  // Incorrecto
}
```

