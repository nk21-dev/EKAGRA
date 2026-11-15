const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const config = require('./config');
const { getDatabase, ensureMigrations } = require('./db');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const goalRoutes = require('./routes/goalRoutes');
const routineRoutes = require('./routes/routineRoutes');
const taskRoutes = require('./routes/taskRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const insightRoutes = require('./routes/insightRoutes');
const appRoutes = require('./routes/appRoutes');

const app = express();

// Trust reverse proxy (Vercel, Render, Cloudflare, etc.)
app.set('trust proxy', 1);

// Initialize DB and migrations
getDatabase();

// Cold-start migration middleware (safe, idempotent, runs only once)
app.use(async (req, res, next) => {
  try {
    const db = getDatabase();
    if (db) {
      await ensureMigrations(db);
    }
    next();
  } catch (err) {
    console.error('[Cold-Start Migration Error]', err);
    next(err);
  }
});

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Middlewares
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static assets from public folder
app.use(express.static(path.resolve(__dirname, '../public')));
app.use('/assets', express.static(path.resolve(__dirname, '../public/assets')));

// Serve root assets (style.css, app.js, images, etc.)
app.use('/style.css', express.static(path.resolve(__dirname, '../style.css')));
app.use('/app.js', express.static(path.resolve(__dirname, '../app.js')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/routines', routineRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/insights', insightRoutes);

// Page Routes (HTML Views & Navigation)
app.use('/', appRoutes);

// 404 Handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }
  if (req.accepts('html')) {
    return res.status(404).redirect('/');
  }
  res.status(404).json({ error: 'Endpoint not found.' });
});

// Central Error Handler
app.use((err, req, res, next) => {
  console.error('[EKAGRA Server Error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Internal server error.',
  });
});

if (require.main === module && !process.env.VERCEL) {
  const server = app.listen(config.port, () => {
    console.log(`\n======================================================`);
    console.log(`🌿 EKAGRA — One Focus. Many Goals.`);
    console.log(`🚀 Server active on ${config.appUrl}`);
    console.log(`🔐 Authentication: /login | /signup | /forgot-password`);
    console.log(`📊 Dashboard placeholder: /dashboard (protected)`);
    console.log(`======================================================\n`);
  });

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}

module.exports = app;
