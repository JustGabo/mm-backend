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
import generateImpostorCaseRouter from './routes/generate-impostor-case.js';
import generateImpostorDiscussionRouter from './routes/generate-impostor-discussion.js';
import { healthRouter } from './routes/health.js';
console.log('✅ Routes loaded successfully');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS Configuration
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : ['http://localhost:3000'];

// En producción, agregar el dominio del frontend
if (process.env.NODE_ENV === 'production') {
  allowedOrigins.push('https://misterymaker.com');
  allowedOrigins.push('https://www.misterymaker.com');
}

const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Permitir requests sin origin (como Postman, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Verificar si el origin está permitido
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️  CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json());

// Health check
app.use('/api/health', healthRouter);

// API Routes
app.use('/api/generate-round', generateRoundRouter);
app.use('/api/generate-initial-case', generateInitialCaseRouter);
app.use(generateImpostorCaseRouter);
app.use(generateImpostorDiscussionRouter);

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
