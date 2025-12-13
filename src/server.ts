import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

console.log('📦 Starting server initialization...');
// Cargar .env.local primero (si existe), luego .env
dotenv.config({ path: '.env.local' });
dotenv.config(); // .env tiene prioridad sobre .env.local
console.log('✅ Environment variables loaded');

console.log('🔧 Loading routes...');
// Importar rutas - puede fallar si hay errores en las importaciones
import { generateRoundRouter } from './routes/generate-round.js';
import { generateInitialCaseRouter } from './routes/generate-initial-case.js';
import { generateImpostorCaseRouter } from './routes/generate-impostor-case.js';
import { generateImpostorDiscussionRouter } from './routes/generate-impostor-discussion.js';
import { healthRouter } from './routes/health.js';
console.log('✅ Routes loaded successfully');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Configuration
// Normalizar URLs: remover barras finales y espacios
const normalizeUrl = (url: string): string => {
  return url.trim().replace(/\/+$/, ''); // Remover barras finales
};

const allowedOrigins: string[] = [];

// Agregar URLs desde FRONTEND_URL
if (process.env.FRONTEND_URL) {
  const urls = process.env.FRONTEND_URL.split(',').map(normalizeUrl);
  allowedOrigins.push(...urls);
}

// En producción, agregar dominios comunes del frontend
if (process.env.NODE_ENV === 'production') {
  const productionUrls = [
    'https://misterymaker.com',
    'https://www.misterymaker.com'
  ];
  productionUrls.forEach(url => {
    if (!allowedOrigins.includes(url)) {
      allowedOrigins.push(url);
    }
  });
}

// Si no hay URLs configuradas, usar localhost por defecto
if (allowedOrigins.length === 0) {
  allowedOrigins.push('http://localhost:3000');
}

const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Permitir requests sin origin (como Postman, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Normalizar el origin recibido (remover barra final)
    const normalizedOrigin = normalizeUrl(origin);
    
    // Verificar si el origin está permitido (comparación exacta o normalizada)
    if (allowedOrigins.includes(origin) || allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️  CORS blocked origin: ${origin}`);
      console.warn(`   Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Aplicar CORS antes que cualquier otra cosa
app.use(cors(corsOptions));

// Manejar preflight requests explícitamente
app.options('*', cors(corsOptions));

app.use(express.json());

// Health check
app.use('/api/health', healthRouter);

// API Routes
app.use('/api/generate-round', generateRoundRouter);
app.use('/api/generate-initial-case', generateInitialCaseRouter);
app.use('/api/generate-impostor-case', generateImpostorCaseRouter);
app.use('/api/generate-impostor-discussion', generateImpostorDiscussionRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📡 CORS enabled for: ${allowedOrigins.join(', ')}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
}).on('error', (err: Error) => {
  console.error('❌ Error starting server:', err.message);
  if (err.message.includes('EADDRINUSE')) {
    console.error(`   Port ${PORT} is already in use. Please use a different port or stop the process using it.`);
  }
  process.exit(1);
});

// Manejar errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('   Stack:', error.stack);
  process.exit(1);
});
