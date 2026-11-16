/**
 * EKAGRA — Task Duration Estimation Service
 * 
 * Multi-layer duration intelligence for sovereign task scheduling:
 * 1. AI Duration Estimation with clarification loop.
 * 2. Secure API Key Management (AES-256-GCM encrypted at rest).
 * 3. Fallback to heuristic rules and speed learner.
 */

const crypto = require('node:crypto');
const config = require('../config');
const { getDatabase } = require('../db');
const { encryptApiKey, decryptApiKey, maskApiKey } = require('../utils/crypto');
const { callGeminiApi, testGeminiConnection } = require('./aiProviders/geminiProvider');

// In-memory sliding-window rate limiter per user (30 requests per minute)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 30;
const userRequestWindows = new Map();

function checkRateLimit(userId) {
  if (!userId) return true;
  const now = Date.now();
  const window = userRequestWindows.get(userId) || [];
  const validRequests = window.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (validRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false;
  }
  validRequests.push(now);
  userRequestWindows.set(userId, validRequests);
  return true;
}

// Global hooks for testing
let mockProviderFn = null;
let mockConnectionTestFn = null;

function setMockProvider(fn) {
  mockProviderFn = fn;
}

function resetMockProvider() {
  mockProviderFn = null;
}

function setMockConnectionTest(fn) {
  mockConnectionTestFn = fn;
}

function resetMockConnectionTest() {
  mockConnectionTestFn = null;
}

/**
 * Retrieve user's saved AI settings without ever exposing plaintext keys.
 */
function getUserAiSettingsSync(db, userId) {
  const row = db.prepare(`
    SELECT mode, provider, encrypted_api_key, key_hint, updated_at
    FROM user_ai_settings
    WHERE user_id = ?
  `).get(userId);

  const aiConfig = config.ai;

  if (!row) {
    return {
      hasSelection: false,
      mode: 'default',
      provider: 'gemini',
      hasKey: false,
      keyHint: null,
      defaultAvailable: aiConfig.isDefaultConfigured,
      defaultProvider: aiConfig.defaultProvider,
      isConfigured: aiConfig.isDefaultConfigured
    };
  }

  const hasKey = Boolean(row.encrypted_api_key);
  const isConfigured = row.mode === 'user_key' ? hasKey : aiConfig.isDefaultConfigured;

  return {
    hasSelection: true,
    mode: row.mode,
    provider: row.provider,
    hasKey,
    keyHint: row.key_hint || null,
    defaultAvailable: aiConfig.isDefaultConfigured,
    defaultProvider: aiConfig.defaultProvider,
    isConfigured
  };
}

async function getUserAiSettingsAsync(db, userId) {
  const row = await db.prepare(`
    SELECT mode, provider, encrypted_api_key, key_hint, updated_at
    FROM user_ai_settings
    WHERE user_id = ?
  `).get(userId);

  const aiConfig = config.ai;

  if (!row) {
    return {
      hasSelection: false,
      mode: 'default',
      provider: 'gemini',
      hasKey: false,
      keyHint: null,
      defaultAvailable: aiConfig.isDefaultConfigured,
      defaultProvider: aiConfig.defaultProvider,
      isConfigured: aiConfig.isDefaultConfigured
    };
  }

  const hasKey = Boolean(row.encrypted_api_key);
  const isConfigured = row.mode === 'user_key' ? hasKey : aiConfig.isDefaultConfigured;

  return {
    hasSelection: true,
    mode: row.mode,
    provider: row.provider,
    hasKey,
    keyHint: row.key_hint || null,
    defaultAvailable: aiConfig.isDefaultConfigured,
    defaultProvider: aiConfig.defaultProvider,
    isConfigured
  };
}

function getUserAiSettings(db, userId) {
  if (db && db.isTurso) {
    return getUserAiSettingsAsync(db, userId);
  }
  return getUserAiSettingsSync(db, userId);
}

/**
 * Save user AI settings with AES-256-GCM encryption for personal keys.
 */
function saveUserAiSettingsSync(db, userId, { mode, provider = 'gemini', apiKey = null }) {
  if (!userId) {
    throw new Error('User ID is required to save AI settings.');
  }
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM user_ai_settings WHERE user_id = ?').get(userId);
  const aiConfig = config.ai;

  let encryptedKey = existing ? existing.encrypted_api_key : null;
  let keyHint = existing ? existing.key_hint : null;

  if (typeof apiKey === 'string') {
    const trimmed = apiKey.trim();
    if (trimmed.length > 0) {
      encryptedKey = encryptApiKey(trimmed, aiConfig.encryptionSecret);
      keyHint = maskApiKey(trimmed);
    }
  }

  let selectedMode;
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
    selectedMode = 'user_key';
  } else if (mode === 'user_key' || mode === 'default') {
    selectedMode = mode;
  } else if (existing) {
    selectedMode = existing.mode;
  } else {
    selectedMode = 'default';
  }
  const selectedProvider = provider || (existing ? existing.provider : 'gemini');

  db.prepare(`
    INSERT INTO user_ai_settings (user_id, mode, provider, encrypted_api_key, key_hint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      mode = excluded.mode,
      provider = excluded.provider,
      encrypted_api_key = excluded.encrypted_api_key,
      key_hint = excluded.key_hint,
      updated_at = excluded.updated_at
  `).run(userId, selectedMode, selectedProvider, encryptedKey, keyHint, now, now);

  return getUserAiSettings(db, userId);
}

async function saveUserAiSettingsAsync(db, userId, { mode, provider = 'gemini', apiKey = null }) {
  if (!userId) {
    throw new Error('User ID is required to save AI settings.');
  }
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT * FROM user_ai_settings WHERE user_id = ?').get(userId);
  const aiConfig = config.ai;

  let encryptedKey = existing ? existing.encrypted_api_key : null;
  let keyHint = existing ? existing.key_hint : null;

  if (typeof apiKey === 'string') {
    const trimmed = apiKey.trim();
    if (trimmed.length > 0) {
      encryptedKey = encryptApiKey(trimmed, aiConfig.encryptionSecret);
      keyHint = maskApiKey(trimmed);
    }
  }

  let selectedMode;
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
    selectedMode = 'user_key';
  } else if (mode === 'user_key' || mode === 'default') {
    selectedMode = mode;
  } else if (existing) {
    selectedMode = existing.mode;
  } else {
    selectedMode = 'default';
  }
  const selectedProvider = provider || (existing ? existing.provider : 'gemini');

  await db.prepare(`
    INSERT INTO user_ai_settings (user_id, mode, provider, encrypted_api_key, key_hint, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      mode = excluded.mode,
      provider = excluded.provider,
      encrypted_api_key = excluded.encrypted_api_key,
      key_hint = excluded.key_hint,
      updated_at = excluded.updated_at
  `).run(userId, selectedMode, selectedProvider, encryptedKey, keyHint, now, now);

  return await getUserAiSettings(db, userId);
}

function saveUserAiSettings(db, userId, settings) {
  if (db && db.isTurso) {
    return saveUserAiSettingsAsync(db, userId, settings);
  }
  return saveUserAiSettingsSync(db, userId, settings);
}

/**
 * Delete personal API key and revert mode to default.
 */
function deleteUserApiKeySync(db, userId) {
  if (!userId) {
    throw new Error('User ID is required to delete API key.');
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_ai_settings (user_id, mode, provider, encrypted_api_key, key_hint, created_at, updated_at)
    VALUES (?, 'default', 'gemini', NULL, NULL, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      mode = 'default',
      encrypted_api_key = NULL,
      key_hint = NULL,
      updated_at = excluded.updated_at
  `).run(userId, now, now);

  return getUserAiSettings(db, userId);
}

async function deleteUserApiKeyAsync(db, userId) {
  if (!userId) {
    throw new Error('User ID is required to delete API key.');
  }
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO user_ai_settings (user_id, mode, provider, encrypted_api_key, key_hint, created_at, updated_at)
    VALUES (?, 'default', 'gemini', NULL, NULL, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      mode = 'default',
      encrypted_api_key = NULL,
      key_hint = NULL,
      updated_at = excluded.updated_at
  `).run(userId, now, now);

  return await getUserAiSettings(db, userId);
}

function deleteUserApiKey(db, userId) {
  if (db && db.isTurso) {
    return deleteUserApiKeyAsync(db, userId);
  }
  return deleteUserApiKeySync(db, userId);
}

/**
 * Resolve provider and API key according to strict precedence rules.
 */
function resolveProviderCredentialsSync(db, userId, explicitKey = null) {
  const aiConfig = config.ai;

  if (explicitKey && typeof explicitKey === 'string' && explicitKey.trim().length > 0) {
    return {
      provider: 'gemini',
      apiKey: explicitKey.trim(),
      source: 'explicit_header'
    };
  }

  if (!userId) {
    if (aiConfig.isDefaultConfigured) {
      return {
        provider: aiConfig.defaultProvider,
        apiKey: aiConfig.geminiApiKey,
        source: 'default_server'
      };
    }
    return null;
  }

  const row = db.prepare('SELECT * FROM user_ai_settings WHERE user_id = ?').get(userId);

  if (row && row.mode === 'user_key') {
    if (!row.encrypted_api_key) {
      return {
        error_code: 'MISSING_PERSONAL_KEY',
        message: 'Personal API key mode is selected, but no API key is saved. Please add your key in Settings.'
      };
    }
    try {
      const decryptedKey = decryptApiKey(row.encrypted_api_key, aiConfig.encryptionSecret);
      return {
        provider: row.provider || 'gemini',
        apiKey: decryptedKey,
        source: 'user_encrypted_key'
      };
    } catch (err) {
      return {
        error_code: 'KEY_DECRYPTION_ERROR',
        message: 'Failed to decrypt personal API key. Please update your key in Settings.'
      };
    }
  }

  if (row && row.mode === 'default') {
    if (aiConfig.isDefaultConfigured) {
      return {
        provider: aiConfig.defaultProvider,
        apiKey: aiConfig.geminiApiKey,
        source: 'default_server'
      };
    }
    return {
      error_code: 'DEFAULT_PROVIDER_NOT_CONFIGURED',
      message: 'The EKAGRA default AI provider is not enabled on this server. Please provide your own Gemini API key in Settings.'
    };
  }

  if (!row) {
    if (aiConfig.isDefaultConfigured) {
      return {
        provider: aiConfig.defaultProvider,
        apiKey: aiConfig.geminiApiKey,
        source: 'default_server'
      };
    }
    return {
      error_code: 'PROVIDER_NOT_CONFIGURED',
      message: 'AI duration estimation is not configured yet. Please configure an AI provider in Settings to begin estimation.'
    };
  }

  return null;
}

async function resolveProviderCredentialsAsync(db, userId, explicitKey = null) {
  const aiConfig = config.ai;

  if (explicitKey && typeof explicitKey === 'string' && explicitKey.trim().length > 0) {
    return {
      provider: 'gemini',
      apiKey: explicitKey.trim(),
      source: 'explicit_header'
    };
  }

  if (!userId) {
    if (aiConfig.isDefaultConfigured) {
      return {
        provider: aiConfig.defaultProvider,
        apiKey: aiConfig.geminiApiKey,
        source: 'default_server'
      };
    }
    return null;
  }

  const row = await db.prepare('SELECT * FROM user_ai_settings WHERE user_id = ?').get(userId);

  if (row && row.mode === 'user_key') {
    if (!row.encrypted_api_key) {
      return {
        error_code: 'MISSING_PERSONAL_KEY',
        message: 'Personal API key mode is selected, but no API key is saved. Please add your key in Settings.'
      };
    }
    try {
      const decryptedKey = decryptApiKey(row.encrypted_api_key, aiConfig.encryptionSecret);
      return {
        provider: row.provider || 'gemini',
        apiKey: decryptedKey,
        source: 'user_encrypted_key'
      };
    } catch (err) {
      return {
        error_code: 'KEY_DECRYPTION_ERROR',
        message: 'Failed to decrypt personal API key. Please update your key in Settings.'
      };
    }
  }

  if (row && row.mode === 'default') {
    if (aiConfig.isDefaultConfigured) {
      return {
        provider: aiConfig.defaultProvider,
        apiKey: aiConfig.geminiApiKey,
        source: 'default_server'
      };
    }
    return {
      error_code: 'DEFAULT_PROVIDER_NOT_CONFIGURED',
      message: 'The EKAGRA default AI provider is not enabled on this server. Please provide your own Gemini API key in Settings.'
    };
  }

  if (!row) {
    if (aiConfig.isDefaultConfigured) {
      return {
        provider: aiConfig.defaultProvider,
        apiKey: aiConfig.geminiApiKey,
        source: 'default_server'
      };
    }
    return {
      error_code: 'PROVIDER_NOT_CONFIGURED',
      message: 'AI duration estimation is not configured yet. Please configure an AI provider in Settings to begin estimation.'
    };
  }

  return null;
}

function resolveProviderCredentials(db, userId, explicitKey = null) {
  if (db && db.isTurso) {
    return resolveProviderCredentialsAsync(db, userId, explicitKey);
  }
  return resolveProviderCredentialsSync(db, userId, explicitKey);
}

/**
 * Main duration estimation entry point.
 */
async function estimateTaskDuration({
  userId,
  title,
  description = '',
  priority = 'Medium',
  clarificationAnswer = null,
  clarificationHistory = [],
  userApiKey = null,
  db = null
}) {
  const database = db || getDatabase();

  // 1. Validate task title
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) {
    return {
      success: false,
      configured: true,
      error_code: 'EMPTY_TASK_TITLE',
      message: 'Task title is required for duration estimation.',
      needs_clarification: false,
      estimated_minutes: null
    };
  }

  // 2. Check user rate limit
  if (userId && !checkRateLimit(userId)) {
    return {
      success: false,
      configured: true,
      error_code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many estimation requests. Please wait a moment before trying again.',
      needs_clarification: false,
      estimated_minutes: null
    };
  }

  // 3. Resolve provider & API key
  const creds = await resolveProviderCredentials(database, userId, userApiKey);

  if (!creds || creds.error_code) {
    const isKeyMissing = !creds || creds.error_code === 'MISSING_PERSONAL_KEY' || creds.error_code === 'PROVIDER_NOT_CONFIGURED' || creds.error_code === 'DEFAULT_PROVIDER_NOT_CONFIGURED';
    return {
      success: false,
      configured: false,
      code: isKeyMissing ? 'API_KEY_MISSING' : (creds ? creds.error_code : 'PROVIDER_NOT_CONFIGURED'),
      error_code: creds ? creds.error_code : 'PROVIDER_NOT_CONFIGURED',
      message: 'Please provide your Gemini API key in Settings to use AI Estimate.',
      needs_clarification: false,
      estimated_minutes: null
    };
  }

  // 4. Check if mock provider is active (for automated unit/integration tests)
  if (typeof mockProviderFn === 'function') {
    try {
      const mockResult = await mockProviderFn({
        apiKey: creds.apiKey,
        title: cleanTitle,
        description: (description || '').trim(),
        priority,
        clarificationAnswer: clarificationAnswer ? String(clarificationAnswer).trim() : null,
        clarificationHistory: Array.isArray(clarificationHistory) ? clarificationHistory : [],
        provider: creds.provider
      });
      return {
        provider: creds.provider,
        configured: true,
        needs_clarification: false,
        estimated_minutes: null,
        confidence: 'medium',
        reasoning: 'Mock reasoning',
        suggested_time_slot: null,
        clarification_prompt: null,
        error: null,
        ...mockResult
      };
    } catch (err) {
      return {
        success: false,
        configured: true,
        error_code: 'PROVIDER_ERROR',
        message: err.message || 'Mock provider error.',
        needs_clarification: false,
        estimated_minutes: null
      };
    }
  }

  // 5. Live AI Call via Gemini Provider
  const aiConfig = config.ai;
  return await callGeminiApi({
    apiKey: creds.apiKey,
    title: cleanTitle,
    description: (description || '').trim(),
    priority,
    clarificationAnswer: clarificationAnswer ? String(clarificationAnswer).trim() : null,
    clarificationHistory: Array.isArray(clarificationHistory) ? clarificationHistory : [],
    model: aiConfig.defaultModel,
    timeoutMs: aiConfig.interactiveTimeoutMs
  });
}

/**
 * Dedicated test-connection endpoint service.
 */
async function testAiConnection({ userId, userApiKey = null, db = null }) {
  const database = db || getDatabase();
  const aiConfig = config.ai;

  try {
    let apiKeyToTest = null;
    let provider = 'gemini';
    let source = 'user_encrypted_key';

    if (userApiKey && typeof userApiKey === 'string' && userApiKey.trim()) {
      apiKeyToTest = userApiKey.trim();
      source = 'explicit_key';
    } else {
      const creds = await resolveProviderCredentials(database, userId, userApiKey);
      if (creds && creds.apiKey) {
        apiKeyToTest = creds.apiKey;
        provider = creds.provider || 'gemini';
        source = creds.source;
      } else if (creds && creds.error_code) {
        return {
          success: false,
          status: creds.error_code === 'KEY_DECRYPTION_ERROR' ? 'KEY_DECRYPTION_ERROR' : 'NOT_CONFIGURED',
          error_code: creds.error_code,
          message: creds.message,
          diagnostics: null
        };
      }
    }

    if (!apiKeyToTest) {
      return {
        success: false,
        status: 'NOT_CONFIGURED',
        error_code: 'PROVIDER_NOT_CONFIGURED',
        message: 'No Gemini API key is configured. Please add an API key in Settings.',
        diagnostics: null
      };
    }

    // Hook for mock testing
    if (typeof mockConnectionTestFn === 'function') {
      return mockConnectionTestFn({
        userId,
        apiKey: apiKeyToTest,
        provider,
        source
      });
    }

    return await testGeminiConnection({
      apiKey: apiKeyToTest,
      model: aiConfig.defaultModel,
      timeoutMs: 15000
    });
  } catch (err) {
    return {
      success: false,
      status: 'PROVIDER_ERROR',
      error_code: 'CONNECTION_TEST_FAILED',
      message: err.message || 'Connection test failed unexpectedly.',
      diagnostics: null
    };
  }
}

module.exports = {
  estimateTaskDuration,
  testAiConnection,
  getUserAiSettings,
  saveUserAiSettings,
  deleteUserApiKey,
  resolveProviderCredentials,
  setMockProvider,
  resetMockProvider,
  setMockConnectionTest,
  resetMockConnectionTest,
  checkRateLimit
};
