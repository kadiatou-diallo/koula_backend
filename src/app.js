import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import userRoutes from './routes/userRoutes.js';
import PastTransactionRoute from './routes/pastTransaction.routes.js';
import TransactionRoute  from './routes/transactionRoutes.js';
import RecentTransactionRoutes from './routes/recentTransactionRoutes.js';
import AccountLines from './routes/accountLines.js';
import AccountTypes from './routes/accoutTypeRoutes.js';
import cronHandler from '../api/cron.js';
import partner from './routes/partnerBalanceRoutes.js';
import cumulRoutes from './routes/cumulRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import dateRangeRoutes from './routes/dateRange.routes.js';

const app = express();

const allowedOrigins = [
  'https://koula.telly-tech.com',
  'https://sayfoulaye.org',
  'https://fancy-voice-ad1a.kadiatoutelly685.workers.dev',
  'https://koula-backend.vercel.app',
  'https://app-tellytech-oair.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8082',
  'http://localhost:8081',
  'http://172.20.10.2:8082',
  'https://sparkling-glade-3839.pages.dev',
  'https://koula-backend-eight.vercel.app'
];

const corsOptions = {
  origin: (origin, callback) => {
    console.log('🔍 CORS origin:', origin);

    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) return callback(null, true);

    const isVercel = /^https:\/\/[\w-]+\.vercel\.app$/.test(origin);
    if (isVercel) return callback(null, true);

    console.warn('❌ CORS bloqué:', origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Set-Cookie'],
  maxAge: 86400,
  optionsSuccessStatus: 204,  
};

// ── 1. CORS middleware
app.use(cors(corsOptions));

// ── 2. Preflight OPTIONS — court-circuit AVANT tout le reste
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.set({
      'Access-Control-Allow-Origin':      req.headers.origin || '*',
      'Access-Control-Allow-Methods':     'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers':     'Content-Type,Authorization,X-Requested-With,Accept,Origin',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age':           '86400',
    });
    return res.status(204).end();
  }
  next();
});

// ── 3. OPTIONS global (sécurité double)
app.options('*', cors(corsOptions));

// ── 4. Helmet — après CORS
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── 5. Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 5000 : 10000,
  message: { success: false, message: 'Limite atteinte. Veuillez patienter.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health' || req.method === 'OPTIONS',
});
app.use('/api/', limiter);

// ── 6. Parsers
app.use(express.json({ limit: '10mb', strict: true }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── 7. Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Origin: ${req.headers.origin}`);
  next();
});

// ── Routes
app.post('/api/cron/reset', (req, res) => cronHandler(req, res));

app.get('/', (req, res) => res.json({ message: 'SBK API Server', status: 'OK', version: '1.0.0' }));

app.get('/api/health', (req, res) => res.json({
  status: 'OK',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  environment: process.env.NODE_ENV || 'development',
}));

app.get('/api/test-cors', (req, res) => res.json({
  message: 'CORS OK',
  origin: req.headers.origin,
  timestamp: new Date().toISOString(),
}));

app.get('/api/debug-env', (req, res) => res.json({
  NODE_ENV: process.env.NODE_ENV,
  origin: req.headers.origin,
  timestamp: new Date().toISOString(),
}));

app.use('/api/users',           userRoutes);
app.use('/api/transactions',    TransactionRoute);
app.use('/api/transactions',    PastTransactionRoute);
app.use('/api/transactions', dateRangeRoutes);   // ← AJOUT
app.use('/api/recent',          RecentTransactionRoutes);
app.use('/api/account-lines',   AccountLines);
app.use('/api/accountype',      AccountTypes);
app.use('/api/partner-balance', partner);
app.use('/api/cumul', cumulRoutes);
app.use('/api/notifications', notificationRoutes);


app.get('/api/test-auth', (req, res) => res.json({
  message: 'Route accessible',
  auth: req.headers.authorization ? 'Token présent' : 'Pas de token',
}));

// ── 404
app.use('*', (req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({ success: false, message: 'Route non trouvée', path: req.path });
});

// ── Erreurs globales
app.use((err, req, res, next) => {
  console.error('❌ Erreur serveur:', err);

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ success: false, message: 'Format JSON invalide' });
  }

  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Erreur serveur interne' : err.message,
  });
});

export default app;