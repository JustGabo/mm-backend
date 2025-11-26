# 🚀 Guía de Deployment en Render

## Configuración en Render

### Build Command
```bash
npm run build
```

### Start Command
```bash
npm start
```

### Variables de Entorno en Render

Configura estas variables en el dashboard de Render:

```
OPENAI_API_KEY=tu_clave_de_openai
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_clave_anonima
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://misterymaker.com,https://www.misterymaker.com
```

### Verificar Build

El build debe generar los archivos en `dist/` con las extensiones `.js` correctas.

Si hay errores de módulos no encontrados:

1. Verifica que el build se complete sin errores
2. Verifica que los archivos en `dist/services/` existan
3. Verifica que los imports tengan la extensión `.js`

## Solución al Error de Módulos

Si ves el error:
```
Cannot find module '/app/dist/services/suspect-service'
```

**Solución:**

1. Asegúrate de que todos los imports relativos tengan `.js`:
   - ✅ `from '../services/suspect-service.js'`
   - ❌ `from '../services/suspect-service'`

2. Verifica que `tsconfig.json` tenga:
   ```json
   {
     "compilerOptions": {
       "module": "Node16",
       "moduleResolution": "Node16"
     }
   }
   ```

3. Limpia y reconstruye:
   ```bash
   rm -rf dist/
   npm run build
   ```

## Verificación Post-Deploy

1. Health check: `https://tu-app.onrender.com/api/health`
2. Debe retornar: `{ status: 'ok', ... }`

