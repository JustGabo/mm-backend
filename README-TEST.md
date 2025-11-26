# Test de Generación de Caso Inicial

## Prerequisitos

1. **Variables de entorno configuradas** - Crea un archivo `.env` en la raíz del proyecto con:

```env
OPENAI_API_KEY=tu_clave_de_openai
NEXT_PUBLIC_SUPABASE_URL=tu_url_de_supabase
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_clave_anonima_de_supabase
PORT=3001
FRONTEND_URL=http://localhost:3000  # Opcional: solo necesario si hay un frontend
```

2. **Servidor corriendo** - El servidor debe estar iniciado antes de ejecutar el test.

## Cómo ejecutar el test

### Opción 1: Dos terminales

**Terminal 1** - Inicia el servidor:
```bash
npm run dev
```

**Terminal 2** - Ejecuta el test:
```bash
npm run test:case
```

### Opción 2: Usar el script manualmente

Si prefieres hacer la petición manualmente con curl:

```bash
curl -X POST http://localhost:3001/api/generate-initial-case \
  -H "Content-Type: application/json" \
  -d '{
    "caseType": "asesinato",
    "suspects": 3,
    "clues": 8,
    "scenario": "mansion",
    "difficulty": "normal",
    "style": "realistic",
    "language": "es"
  }'
```

## Qué verifica el test

El test verifica que:
- ✅ El servidor esté corriendo y responda
- ✅ El endpoint `/api/generate-initial-case` funcione correctamente
- ✅ Se genere un caso con todos los campos requeridos
- ✅ Los sospechosos tengan fotos de Supabase
- ✅ El caso tenga un culpable oculto asignado

## Resultado esperado

El test debe mostrar:
- Título del caso generado
- Información de la víctima
- Lista de sospechosos (con el culpable marcado)
- Detalles del caso
- Un archivo `test-response.json` con la respuesta completa

