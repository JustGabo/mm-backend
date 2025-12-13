# Mystery Maker Backend

Backend API para Mystery Maker - Generador de casos de misterio interactivos.

## 🚀 Características

- ✅ Generación de casos iniciales con IA (OpenAI)
- ✅ Generación de rondas de investigación dinámicas
- ✅ Integración con Supabase para sospechosos y armas
- ✅ API REST con Express.js
- ✅ TypeScript para type safety
- ✅ Docker para deployment

## 📋 Requisitos

- Node.js 20+
- npm o pnpm
- Variables de entorno configuradas (ver `.env.example`)

## 🛠️ Instalación

```bash
# Instalar dependencias
npm install

# O con pnpm
pnpm install
```

## 🔧 Configuración

1. Copia el archivo de ejemplo:
```bash
cp .env.example .env
```

2. Configura las variables de entorno en `.env`:
```env
OPENAI_API_KEY=<your-openai-api-key>
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
PORT=3001
FRONTEND_URL=https://misterymaker.com
```

## 🏃 Desarrollo

```bash
# Modo desarrollo (con hot reload)
npm run dev

# O con pnpm
pnpm run dev
```

El servidor se iniciará en `http://localhost:3001`

## 🧪 Testing

```bash
# Ejecutar test de generación de caso
npm run test:case
```

## 📦 Build

```bash
# Compilar TypeScript
npm run build

# Iniciar servidor en producción
npm start
```

## 🐳 Docker

### Construir imagen

```bash
docker build -t mystery-maker-backend .
```

### Ejecutar contenedor

```bash
docker run -p 3001:3001 \
  -e OPENAI_API_KEY=<your-openai-api-key> \
  -e NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url> \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key> \
  -e FRONTEND_URL=https://misterymaker.com \
  mystery-maker-backend
```

### O usar docker-compose

```bash
docker-compose up -d
```

## 📡 API Endpoints

### Health Check
```
GET /api/health
```

### Generar Caso Inicial
```
POST /api/generate-initial-case
Content-Type: application/json

{
  "caseType": "asesinato",
  "suspects": 3,
  "clues": 8,
  "scenario": "mansion",
  "difficulty": "normal",
  "style": "realistic",
  "language": "es"
}
```

### Generar Ronda
```
POST /api/generate-round
Content-Type: application/json

{
  "roundNumber": 1,
  "caseContext": { ... },
  "decisionHistory": [],
  "language": "es"
}
```

## 🌐 CORS

El servidor está configurado para aceptar requests desde:
- `http://localhost:3000` (desarrollo)
- `https://misterymaker.com` (producción)
- `https://www.misterymaker.com` (producción)

Puedes configurar múltiples orígenes separados por comas en `FRONTEND_URL`.

## 📝 Variables de Entorno

| Variable | Requerido | Descripción |
|----------|-----------|-------------|
| `OPENAI_API_KEY` | ✅ | API key de OpenAI |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | URL de tu proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Clave anónima de Supabase |
| `PORT` | ❌ | Puerto del servidor (default: 3001) |
| `FRONTEND_URL` | ❌ | URL del frontend para CORS |
| `NODE_ENV` | ❌ | Entorno (development/production) |

## 🚢 Deployment

### VPS con Docker

1. Clonar repositorio
2. Configurar variables de entorno
3. Construir y ejecutar con Docker

```bash
docker build -t mystery-maker-backend .
docker run -d \
  --name mm-backend \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env \
  mystery-maker-backend
```

### Con Nginx (reverse proxy)

Ejemplo de configuración Nginx:

```nginx
server {
    listen 80;
    server_name api.misterymaker.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 📄 Licencia

MIT
