# 🚀 Guía de Deployment - Mystery Maker Backend

## 📋 Checklist Pre-Deployment

- [x] ✅ CORS configurado para `misterymaker.com`
- [x] ✅ Dockerfile creado
- [x] ✅ docker-compose.yml configurado
- [x] ✅ Variables de entorno documentadas
- [x] ✅ Health check endpoint funcionando

## 🌐 Configuración para Producción

### Variables de Entorno Requeridas

Crea un archivo `.env` en tu servidor con:

```env
# OpenAI
OPENAI_API_KEY=<your-openai-api-key>

# Supabase
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-project-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>

# Servidor
PORT=3001
NODE_ENV=production

# Frontend (separado por comas para múltiples dominios)
FRONTEND_URL=https://misterymaker.com,https://www.misterymaker.com
```

## 🐳 Opción 1: Docker (Recomendado)

### Construir imagen

```bash
docker build -t mystery-maker-backend:latest .
```

### Ejecutar contenedor

```bash
docker run -d \
  --name mm-backend \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env \
  mystery-maker-backend:latest
```

### O usar docker-compose

```bash
docker-compose up -d
```

### Ver logs

```bash
docker logs -f mm-backend
```

## 📦 Opción 2: Sin Docker (Node.js directo)

### 1. En tu VPS

```bash
# Clonar repositorio
git clone <tu-repo-url>
cd mm-backend

# Instalar dependencias
npm ci --production

# Compilar TypeScript
npm run build

# Configurar variables de entorno
cp .env.example .env
nano .env  # Editar con tus valores

# Iniciar con PM2 (recomendado)
npm install -g pm2
pm2 start dist/server.js --name mm-backend
pm2 save
pm2 startup
```

## 🔒 Opción 3: Con Nginx como Reverse Proxy

### Configuración Nginx

Crea `/etc/nginx/sites-available/mystery-maker-backend`:

```nginx
server {
    listen 80;
    server_name api.misterymaker.com;

    # Redirección HTTPS (recomendado)
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.misterymaker.com;

    # Certificados SSL (usar Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/api.misterymaker.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.misterymaker.com/privkey.pem;

    # Configuración SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Headers de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy al backend
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts para OpenAI (puede tardar)
        proxy_read_timeout 120s;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
    }

    # Health check directo
    location /api/health {
        proxy_pass http://localhost:3001/api/health;
        access_log off;
    }
}
```

### Activar configuración

```bash
sudo ln -s /etc/nginx/sites-available/mystery-maker-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL con Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.misterymaker.com
```

## 🔍 Verificación Post-Deployment

### 1. Health Check

```bash
curl https://api.misterymaker.com/api/health
```

Debería retornar:
```json
{
  "status": "ok",
  "timestamp": "...",
  "service": "caselab-backend"
}
```

### 2. Test de CORS

Desde el navegador en `misterymaker.com`, ejecuta:

```javascript
fetch('https://api.misterymaker.com/api/health')
  .then(r => r.json())
  .then(console.log)
```

### 3. Test de Generación de Caso

```bash
curl -X POST https://api.misterymaker.com/api/generate-initial-case \
  -H "Content-Type: application/json" \
  -H "Origin: https://misterymaker.com" \
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

## 🔄 Actualizaciones

### Con Docker

```bash
# Pull cambios
git pull

# Reconstruir
docker build -t mystery-maker-backend:latest .

# Detener contenedor actual
docker stop mm-backend
docker rm mm-backend

# Iniciar nuevo contenedor
docker run -d \
  --name mm-backend \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file .env \
  mystery-maker-backend:latest
```

### Con PM2

```bash
git pull
npm run build
pm2 restart mm-backend
```

## 📊 Monitoreo

### Logs

```bash
# Docker
docker logs -f mm-backend

# PM2
pm2 logs mm-backend
```

### Métricas

- Health check: `/api/health`
- Tiempo de respuesta de OpenAI
- Errores en logs

## 🛡️ Seguridad

- ✅ CORS configurado solo para dominios permitidos
- ✅ Variables de entorno no expuestas
- ✅ SSL/TLS con Let's Encrypt (recomendado)
- ✅ Rate limiting (considerar implementar)
- ✅ Validación de input en endpoints

## 📝 Notas

- El servidor puede tardar hasta 60 segundos en responder (generación con OpenAI)
- Asegúrate de tener timeouts suficientes en Nginx/reverse proxy
- Considera implementar rate limiting para evitar abuso
- Monitorea el uso de la API de OpenAI para controlar costos


