const path = require('node:path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

const DEFAULT_INSECURE_SECRET = 'ekagra_default_secret_one_focus_many_goals';
const DETERMINISTIC_VERCEL_JWT_SECRET = 'ekagra_vercel_deterministic_jwt_secret_2026_production';

function validateProductionSecrets() {
  const isProduction = (process.env.NODE_ENV || 'development') === 'production';
  if (!isProduction) return;

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret === DEFAULT_INSECURE_SECRET || jwtSecret.length < 16) {
    if (process.env.VERCEL) {
      console.warn('[Security Warning] JWT_SECRET not configured on Vercel; using deterministic serverless fallback secret.');
      return;
    }
    throw new Error('[Security Exception] In production mode, JWT_SECRET must be explicitly set to a strong secret (at least 16 characters).');
  }

  const aiSecret = process.env.AI_KEY_ENCRYPTION_SECRET || process.env.AI_ENCRYPTION_SECRET;
  if (!aiSecret && (!jwtSecret || jwtSecret === DEFAULT_INSECURE_SECRET)) {
    if (process.env.VERCEL) {
      console.warn('[Security Warning] AI encryption secret not configured on Vercel; using deterministic fallback.');
      return;
    }
    throw new Error('[Security Exception] In production mode, AI_KEY_ENCRYPTION_SECRET (or AI_ENCRYPTION_SECRET) must be explicitly configured.');
  }
}

validateProductionSecrets();

function loadEmailConfig() {
  // Re-read .env to ensure any runtime file updates are captured
  dotenv.config({ path: envPath });
  return {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'EKAGRA Security <onboarding@resend.dev>',
  };
}

function loadAiConfig() {
  dotenv.config({ path: envPath });
  const isProduction = (process.env.NODE_ENV || 'development') === 'production';
  const defaultProvider = process.env.AI_DEFAULT_PROVIDER || 'gemini';
  const defaultEnabled = process.env.AI_DEFAULT_ENABLED === 'true';
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.AI_PROVIDER_KEY || '';
  const configuredAiSecret = process.env.AI_KEY_ENCRYPTION_SECRET || process.env.AI_ENCRYPTION_SECRET;
  
  if (isProduction && !configuredAiSecret && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_INSECURE_SECRET)) {
    if (process.env.VERCEL) {
      console.warn('[Security Warning] AI encryption secret fallback on Vercel.');
    } else {
      throw new Error('[Security Exception] In production mode, AI_KEY_ENCRYPTION_SECRET (or AI_ENCRYPTION_SECRET) must be explicitly configured.');
    }
  }

  const encryptionSecret = configuredAiSecret || process.env.JWT_SECRET || (process.env.VERCEL ? DETERMINISTIC_VERCEL_JWT_SECRET : DEFAULT_INSECURE_SECRET);
  const defaultModel = process.env.AI_MODEL || 'gemini-3.8-flash';
  const requestTimeoutMs = parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 30000;
  const interactiveTimeoutMs = parseInt(process.env.AI_INTERACTIVE_TIMEOUT_MS, 10) || 15000;

  return {
    defaultProvider,
    defaultEnabled,
    geminiApiKey,
    encryptionSecret,
    defaultModel,
    requestTimeoutMs,
    interactiveTimeoutMs,
    isDefaultConfigured: Boolean(defaultEnabled && geminiApiKey)
  };
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || (process.env.VERCEL ? DETERMINISTIC_VERCEL_JWT_SECRET : DEFAULT_INSECURE_SECRET),
  jwtExpiresIn: '7d',
  cookieMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  dbPath: process.env.DB_PATH 
    ? path.resolve(__dirname, '..', process.env.DB_PATH)
    : path.resolve(__dirname, '../data/ekagra.sqlite'),
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL || null,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || null,
  get email() {
    return loadEmailConfig();
  },
  loadEmailConfig,
  get ai() {
    return loadAiConfig();
  },
  loadAiConfig,
};

module.exports = config;
