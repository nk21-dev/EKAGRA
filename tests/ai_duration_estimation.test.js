const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const config = require('../server/config');
const { getDatabase } = require('../server/db');
const {
  setMockProvider,
  resetMockProvider,
  setMockConnectionTest,
  resetMockConnectionTest,
  testAiConnection,
  getUserAiSettings,
  saveUserAiSettings,
  deleteUserApiKey
} = require('../server/services/durationEstimationService');
const { testGeminiConnection, extractGeminiErrorDiagnostics, callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
const { encryptApiKey, decryptApiKey, maskApiKey } = require('../server/utils/crypto');

describe('EKAGRA AI Task Duration Estimation Suite', () => {
  let server;
  let baseUrl;
  let userAToken;
  let userBToken;
  let userAId;
  let userBId;
  let db;

  before(async () => {
    db = getDatabase();

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Register User A
    const resA = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI Estimator User A',
        email: `ai_user_a_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    const dataA = await resA.json();
    assert.equal(resA.status, 201);
    userAId = dataA.user.id;
    const cookiesA = resA.headers.getSetCookie ? resA.headers.getSetCookie() : [resA.headers.get('set-cookie')];
    userAToken = cookiesA.map((c) => c.split(';')[0]).join('; ');

    // Register User B
    const resB = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI Estimator User B',
        email: `ai_user_b_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    const dataB = await resB.json();
    assert.equal(resB.status, 201);
    userBId = dataB.user.id;
    const cookiesB = resB.headers.getSetCookie ? resB.headers.getSetCookie() : [resB.headers.get('set-cookie')];
    userBToken = cookiesB.map((c) => c.split(';')[0]).join('; ');
  });

  after(async () => {
    resetMockProvider();
    resetMockConnectionTest();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  afterEach(() => {
    resetMockProvider();
    resetMockConnectionTest();
  });

  test('1. Clear task receives a real/mocked provider estimate', async () => {
    setMockProvider(async ({ title, priority }) => {
      return {
        success: true,
        needs_clarification: false,
        clarifying_question: null,
        estimated_minutes: 45,
        confidence: 'high',
        estimate_reason: 'Reviewing textbook chapter 3 content and taking summary notes.',
        range: { min: 35, max: 60 },
        milestone_breakdown_recommended: false
      };
    });

    // Configure user A with a key
    await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        mode: 'user_key',
        provider: 'gemini',
        apiKey: 'test-gemini-fake-valid-key-abcdef'
      })
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Read chapter 3 of machine learning textbook',
        description: 'Focus on loss functions and gradient descent',
        priority: 'High'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.needs_clarification, false);
    assert.equal(data.estimated_minutes, 45);
    assert.equal(data.confidence, 'high');
    assert.ok(data.estimate_reason.length > 10);
    assert.deepEqual(data.range, { min: 35, max: 60 });
  });

  test('2. Vague task returns a clarification question and null duration', async () => {
    setMockProvider(async ({ title }) => {
      if (title.toLowerCase() === 'study') {
        return {
          success: true,
          needs_clarification: true,
          clarifying_question: 'What specific subject or chapter will you be studying?',
          estimated_minutes: null,
          confidence: null,
          estimate_reason: 'Task is too broad to estimate accurately without more detail.',
          range: null,
          milestone_breakdown_recommended: false
        };
      }
      return { success: true, needs_clarification: false, estimated_minutes: 30 };
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Study'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.needs_clarification, true);
    assert.equal(data.estimated_minutes, null);
    assert.equal(data.clarifying_question, 'What specific subject or chapter will you be studying?');
  });

  test('3. Clarification answer allows estimation to proceed', async () => {
    setMockProvider(async ({ title, clarificationAnswer }) => {
      if (clarificationAnswer && clarificationAnswer.includes('transformer')) {
        return {
          success: true,
          needs_clarification: false,
          clarifying_question: null,
          estimated_minutes: 60,
          confidence: 'high',
          estimate_reason: 'Studying transformer self-attention and working through diagrams.',
          range: { min: 45, max: 75 },
          milestone_breakdown_recommended: false
        };
      }
      return { success: true, needs_clarification: true, clarifying_question: 'What topic?' };
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Study',
        clarification_answer: 'Study transformer architecture and understand self-attention, with handwritten notes'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.needs_clarification, false);
    assert.equal(data.estimated_minutes, 60);
    assert.equal(data.confidence, 'high');
  });

  test('4. Empty task title is rejected', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: '   '
      })
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'EMPTY_TASK_TITLE');
  });

  test('5. Provider not configured produces a helpful setup response', async () => {
    // Register User C with no configuration
    const resC = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI User C',
        email: `ai_user_c_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    const dataC = await resC.json();
    const cookiesC = resC.headers.getSetCookie ? resC.headers.getSetCookie() : [resC.headers.get('set-cookie')];
    const userCToken = cookiesC.map((c) => c.split(';')[0]).join('; ');

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userCToken
      },
      body: JSON.stringify({
        title: 'Review flashcards'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.configured, false);
    assert.ok(data.error_code === 'PROVIDER_NOT_CONFIGURED' || data.error_code === 'DEFAULT_PROVIDER_NOT_CONFIGURED');
    assert.ok(data.message.includes('Settings') || data.message.includes('configured'));
  });

  test('6. Invalid API key produces a safe error without stack traces', async () => {
    setMockProvider(async () => {
      return {
        success: false,
        error_code: 'INVALID_API_KEY',
        message: 'Invalid or unauthorized Gemini API key. Please check your key in Settings.'
      };
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Build search query'
      })
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'INVALID_API_KEY');
    assert.equal(data.stack, undefined);
  });

  test('7. Provider timeout is handled gracefully', async () => {
    setMockProvider(async () => {
      return {
        success: false,
        error_code: 'PROVIDER_TIMEOUT',
        message: 'Gemini API request timed out after 30 seconds. Please enter duration manually.'
      };
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Translate document'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'PROVIDER_TIMEOUT');
    assert.equal(data.estimated_minutes, null);
  });

  test('8. Provider quota/rate limit is handled cleanly', async () => {
    setMockProvider(async () => {
      return {
        success: false,
        error_code: 'PROVIDER_RATE_LIMIT',
        message: 'Gemini API rate limit reached. Please wait a moment and try again.'
      };
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Review vocabulary'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'PROVIDER_RATE_LIMIT');
  });

  test('9. Malformed AI output is rejected', async () => {
    setMockProvider(async () => {
      return {
        success: false,
        error_code: 'INVALID_PROVIDER_RESPONSE',
        message: 'Provider returned malformed JSON.'
      };
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Code feature'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'INVALID_PROVIDER_RESPONSE');
  });

  test('10. Negative, non-finite, and unreasonable durations are rejected', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');

    // Test parser with negative duration
    const fakeNegativeResponse = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ needs_clarification: false, estimated_minutes: -30 }) }] } }]
      })
    });
    const resNegative = await callGeminiApi({
      apiKey: 'test-key',
      title: 'Workout',
      fetchImpl: fakeNegativeResponse
    });
    assert.equal(resNegative.success, false);
    assert.equal(resNegative.error_code, 'INVALID_PROVIDER_RESPONSE');

    // Test parser with unreasonable duration (> 1440 min)
    const fakeHugeResponse = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ needs_clarification: false, estimated_minutes: 50000 }) }] } }]
      })
    });
    const resHuge = await callGeminiApi({
      apiKey: 'test-key',
      title: 'Workout',
      fetchImpl: fakeHugeResponse
    });
    assert.equal(resHuge.success, false);
    assert.equal(resHuge.error_code, 'INVALID_PROVIDER_RESPONSE');
  });

  test('11. Existing manual duration is not silently overwritten (Frontend contract check)', () => {
    const jsContent = fs.readFileSync(path.resolve(__dirname, '../public/js/dashboard.js'), 'utf8');
    assert.ok(jsContent.includes('Replace with AI estimate'), 'Contains option to replace duration');
    assert.ok(jsContent.includes('Keep my duration'), 'Contains option to keep manual duration');
    assert.ok(jsContent.includes('currentVal && Number.isFinite(currentVal) && currentVal !== data.estimated_minutes'), 'Guards against overwriting manual duration without confirmation');
  });

  test('12. User can accept or ignore an estimate without accidentally saving a task', async () => {
    const initialTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?').get(userAId).count;

    setMockProvider(async () => ({
      success: true,
      needs_clarification: false,
      estimated_minutes: 30,
      estimate_reason: 'Testing estimate only'
    }));

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Only estimate this, do not save'
      })
    });

    assert.equal(res.status, 200);
    const finalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?').get(userAId).count;
    assert.equal(initialTasks, finalTasks, 'Database task count must not change when merely estimating');
  });

  test('13. Personal API key is encrypted at rest in the database', async () => {
    const rawPlainKey = 'test-gemini-secret-real-key-999988887777';
    saveUserAiSettings(db, userAId, {
      mode: 'user_key',
      provider: 'gemini',
      apiKey: rawPlainKey
    });

    const row = db.prepare('SELECT encrypted_api_key, key_hint FROM user_ai_settings WHERE user_id = ?').get(userAId);
    assert.ok(row.encrypted_api_key, 'Encrypted key must exist in DB');
    assert.notEqual(row.encrypted_api_key, rawPlainKey, 'Plaintext key must NEVER be stored');
    assert.ok(row.encrypted_api_key.includes(':'), 'Encrypted key format must follow iv:tag:ciphertext');

    // Decryption test with secret
    const decrypted = decryptApiKey(row.encrypted_api_key, config.ai.encryptionSecret);
    assert.equal(decrypted, rawPlainKey, 'Key must be decryptable with correct server secret');
  });

  test('14. API key never appears in plaintext in API responses', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      headers: { Cookie: userAToken }
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes('test-gemini-secret-real-key-999988887777'), false, 'Plaintext key must not appear in JSON response');
    assert.equal(text.includes('••••••••'), true, 'Masked key hint must be used instead');
  });

  test('15. User A cannot access or use User B\'s API key (Strict User Isolation)', async () => {
    // Configure User B with their own key
    const userBKey = 'test-gemini-userB-key-111122223333';
    saveUserAiSettings(db, userBId, {
      mode: 'user_key',
      provider: 'gemini',
      apiKey: userBKey
    });

    // Query AI settings as User A
    const resA = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      headers: { Cookie: userAToken }
    });
    const dataA = await resA.json();

    // Query AI settings as User B
    const resB = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      headers: { Cookie: userBToken }
    });
    const dataB = await resB.json();

    assert.notEqual(dataA.settings.keyHint, dataB.settings.keyHint);
    assert.equal(dataB.settings.keyHint, maskApiKey(userBKey));

    // Verify User A cannot delete User B's key
    const rowBBefore = db.prepare('SELECT encrypted_api_key FROM user_ai_settings WHERE user_id = ?').get(userBId);
    await fetch(`${baseUrl}/api/tasks/ai-settings/key`, {
      method: 'DELETE',
      headers: { Cookie: userAToken } // User A deletes their key
    });
    const rowBAfter = db.prepare('SELECT encrypted_api_key FROM user_ai_settings WHERE user_id = ?').get(userBId);
    assert.equal(rowBBefore.encrypted_api_key, rowBAfter.encrypted_api_key, 'User B key must be intact');
  });

  test('16. User settings persist after logout and login', async () => {
    // Save settings for User A
    await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        mode: 'user_key',
        provider: 'gemini',
        apiKey: 'test-gemini-persisted-key-555566667777'
      })
    });

    // User A logs out
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: userAToken }
    });

    // User A logs back in
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: db.prepare('SELECT email FROM users WHERE id = ?').get(userAId).email,
        password: 'Password123!'
      })
    });
    assert.equal(loginRes.status, 200);
    const newCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
    const newAToken = newCookies.map((c) => c.split(';')[0]).join('; ');

    // Check settings with new session
    const resCheck = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      headers: { Cookie: newAToken }
    });
    const dataCheck = await resCheck.json();
    assert.equal(dataCheck.settings.mode, 'user_key');
    assert.equal(dataCheck.settings.hasKey, true);
    assert.equal(dataCheck.settings.keyHint, maskApiKey('test-gemini-persisted-key-555566667777'));
  });

  test('17. Provider selection persists per user', async () => {
    saveUserAiSettings(db, userAId, { mode: 'user_key', provider: 'gemini' });
    saveUserAiSettings(db, userBId, { mode: 'default', provider: 'gemini' });

    const settingsA = getUserAiSettings(db, userAId);
    const settingsB = getUserAiSettings(db, userBId);

    assert.equal(settingsA.mode, 'user_key');
    assert.equal(settingsB.mode, 'default');
  });

  test('18. Default provider works only when correctly configured and enabled', async () => {
    // When default is disabled, default mode returns configuration error
    const settings = getUserAiSettings(db, userBId);
    if (!config.ai.isDefaultConfigured) {
      assert.equal(settings.defaultAvailable, false);
    }
  });

  test('19. Existing task creation and task progress tests still work', async () => {
    // Create a goal
    const goalId = `g-test-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO goals (id, user_id, title, description, priority, target_date, progress, created_at, updated_at)
      VALUES (?, ?, 'AI Test Goal', 'Testing', 'High', '2026-12-31', 0, ?, ?)
    `).run(goalId, userAId, now, now);

    // Create an inline task
    const createRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        goal_id: goalId,
        title: 'Task Created Alongside AI System',
        duration_minutes: 45
      })
    });
    assert.equal(createRes.status, 201);
    const createdData = await createRes.json();
    assert.equal(createdData.task.title, 'Task Created Alongside AI System');
    assert.equal(createdData.task.duration_minutes, 45);

    // Toggle task
    const toggleRes = await fetch(`${baseUrl}/api/tasks/${createdData.task.id}/toggle`, {
      method: 'PATCH',
      headers: { Cookie: userAToken }
    });
    assert.equal(toggleRes.status, 200);
    const toggledData = await toggleRes.json();
    assert.equal(toggledData.task.completed, true);
    assert.equal(toggledData.goalProgress.progress, 100);
  });

  test('20. Dark/light theme styles and modal containers exist in markup and CSS', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/views/dashboard.html'), 'utf8');
    const css = fs.readFileSync(path.resolve(__dirname, '../public/css/dashboard.css'), 'utf8');

    // HTML elements
    assert.ok(html.includes('id="aiProviderSelectModal"'), 'Provider modal in HTML');
    assert.ok(html.includes('id="aiSettingsCard"'), 'Settings card in HTML');
    assert.ok(html.includes('id="editTaskAiClarification"'), 'Clarification box in edit modal');
    assert.ok(html.includes('class="btn-ai-estimate-pill"'), 'AI Estimate button in HTML');

    // CSS selectors
    assert.ok(css.includes('.inline-ai-clarification-box'), 'Clarification box CSS');
    assert.ok(css.includes('.ai-provider-mode-selector'), 'Mode selector CSS');
    assert.ok(css.includes('.ai-status-ready'), 'Status badge ready CSS');
    assert.ok(css.includes('.ai-status-pending'), 'Status badge pending CSS');
    assert.ok(css.includes('.btn-ai-choice-btn'), 'Duration override choice button CSS');
  });

  test('21. Configured default model is gemini-3.8-flash', () => {
    assert.equal(config.ai.defaultModel, 'gemini-3.8-flash');
  });

  test('22. callGeminiApi uses gemini-3.8-flash and never falls back to gemini-1.5-flash', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    const requestedUrls = [];

    const mockFetch = async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      needs_clarification: false,
                      clarifying_question: null,
                      estimated_minutes: 45,
                      confidence: 'high',
                      estimate_reason: 'Testing with configured model',
                      range: { min: 30, max: 60 },
                      milestone_breakdown_recommended: false
                    })
                  }
                ]
              }
            }
          ]
        })
      };
    };

    const result = await callGeminiApi({
      apiKey: 'test-secret-key-12345',
      title: 'Solve dynamic programming problem',
      fetchImpl: mockFetch
    });

    assert.equal(result.success, true);
    assert.equal(result.estimated_minutes, 45);
    assert.equal(requestedUrls.length, 1, 'Exactly one request must be made');
    assert.ok(requestedUrls[0].includes('models/gemini-3.8-flash:generateContent'), 'Request must target gemini-3.8-flash');
    assert.equal(requestedUrls.some((u) => u.includes('gemini-1.5-flash')), false, 'Must never target or fall back to gemini-1.5-flash');
  });

  test('23. Model unavailable / 404 returns MODEL_NOT_FOUND error explaining model needs updating without exposing keys', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    const secretKey = 'SECRET_REAL_GEMINI_KEY_789';

    const mock404Fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        error: {
          code: 404,
          message: 'models/gemini-3.8-flash is not found for API version v1beta, or is not supported for generateContent.',
          status: 'NOT_FOUND'
        }
      })
    });

    const result = await callGeminiApi({
      apiKey: secretKey,
      title: 'Test task',
      model: 'gemini-3.8-flash',
      fetchImpl: mock404Fetch
    });

    assert.equal(result.success, false);
    assert.equal(result.error_code, 'MODEL_NOT_FOUND');
    assert.ok(result.message.includes('update the configured AI model'), 'Explains model needs updating');
    assert.equal(result.message.includes(secretKey), false, 'API key must not be exposed in error message');
    assert.equal(JSON.stringify(result).includes(secretKey), false, 'API key must not be exposed anywhere in result object');
  });

  test('24. Transient error detection, Retry-After parsing, and backoff delay calculation', () => {
    const {
      isTransientError,
      parseRetryAfter,
      calculateBackoffDelay
    } = require('../server/services/aiProviders/geminiProvider');

    // Transient detection
    assert.equal(isTransientError(503, {}, 'Service Unavailable'), true);
    assert.equal(isTransientError(502, {}, 'Bad Gateway'), true);
    assert.equal(isTransientError(504, {}, 'Gateway Timeout'), true);
    assert.equal(isTransientError(500, {}, 'Internal Server Error'), true);
    assert.equal(
      isTransientError(400, {}, 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.'),
      true
    );
    assert.equal(
      isTransientError(200, { error: { message: 'The model is overloaded. Please try again later.' } }, ''),
      true
    );
    assert.equal(isTransientError(429, {}, 'Too many requests'), true);

    // Non-transient detection
    assert.equal(isTransientError(401, {}, 'API key not valid'), false);
    assert.equal(isTransientError(403, {}, 'The caller does not have permission'), false);
    assert.equal(isTransientError(404, {}, 'Model not found'), false);
    assert.equal(isTransientError(400, {}, 'Invalid JSON payload'), false);
    assert.equal(isTransientError(429, { error: { message: 'Quota exceeded for billing account' } }, 'billing quota exhausted'), false);

    // parseRetryAfter
    assert.equal(parseRetryAfter({ headers: { 'retry-after': '3' } }, {}), 3000);
    assert.equal(parseRetryAfter({ headers: { get: () => '2.5' } }, {}), 2500);
    assert.equal(
      parseRetryAfter(null, { error: { details: [{ retryDelay: '4.5s' }] } }),
      4500
    );
    assert.equal(parseRetryAfter(null, null), null);

    // calculateBackoffDelay with retryAfterMs
    const capped = calculateBackoffDelay(1, 15000, { maxDelayMs: 6000 });
    assert.equal(capped, 6000, 'Must be capped at maxDelayMs');

    const respected = calculateBackoffDelay(1, 2000, { minDelayMs: 1000, maxDelayMs: 6000 });
    assert.equal(respected, 2000, 'Must respect retryAfterMs');

    // calculateBackoffDelay exponential increase
    const delayAttempt1 = calculateBackoffDelay(1, null, { initialDelayMs: 1500, maxDelayMs: 6000 });
    assert.ok(delayAttempt1 >= 1500 && delayAttempt1 <= 2000, 'Attempt 1 delay should be around 1.5s - 2.0s');

    const delayAttempt2 = calculateBackoffDelay(2, null, { initialDelayMs: 1500, maxDelayMs: 6000 });
    assert.ok(delayAttempt2 >= 3000 && delayAttempt2 <= 3500, 'Attempt 2 delay should increase (around 3.0s - 3.5s)');
  });

  test('25. Transient high-demand error (503) succeeds on retry attempt 2', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    let callCount = 0;
    const delaysPassed = [];

    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 503,
          headers: { 'retry-after': '1.5' },
          json: async () => ({
            error: {
              code: 503,
              message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
              status: 'UNAVAILABLE'
            }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      needs_clarification: false,
                      clarifying_question: null,
                      estimated_minutes: 40,
                      confidence: 'high',
                      estimate_reason: 'Estimated successfully after transient retry',
                      range: { min: 30, max: 50 },
                      milestone_breakdown_recommended: false
                    })
                  }
                ]
              }
            }
          ]
        })
      };
    };

    const mockSleep = async (ms) => {
      delaysPassed.push(ms);
    };

    const result = await callGeminiApi({
      apiKey: 'test-transient-key',
      title: 'Fix edge case in parser',
      fetchImpl: mockFetch,
      sleepImpl: mockSleep,
      maxAttempts: 3
    });

    assert.equal(result.success, true);
    assert.equal(result.estimated_minutes, 40);
    assert.equal(callCount, 2, 'Should succeed on attempt 2 without continuing to attempt 3');
    assert.equal(delaysPassed.length, 1, 'Should have slept exactly once between attempt 1 and 2');
    assert.equal(delaysPassed[0], 1500, 'Should respect Retry-After 1.5s (1500ms)');
  });

  test('26. Exhausted retries when provider remains busy (stops at 3 attempts, returns friendly message)', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    let callCount = 0;
    const delaysPassed = [];
    const secretKey = 'TOP_SECRET_RETRY_KEY_456';

    const mockFetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 503,
        json: async () => ({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
            status: 'UNAVAILABLE'
          }
        })
      };
    };

    const mockSleep = async (ms) => {
      delaysPassed.push(ms);
    };

    const result = await callGeminiApi({
      apiKey: secretKey,
      title: 'Analyze database query performance',
      fetchImpl: mockFetch,
      sleepImpl: mockSleep,
      maxAttempts: 3
    });

    assert.equal(result.success, false);
    assert.equal(result.error_code, 'PROVIDER_TEMPORARILY_BUSY');
    assert.ok(result.message.includes('experiencing high demand and is temporarily busy'), 'Returns friendly overload message');
    assert.ok(result.message.includes('try again in a few moments, or enter duration manually'), 'Instructs user on next action');
    assert.equal(callCount, 3, 'Must stop at exactly 3 attempts (no infinite loop)');
    assert.equal(delaysPassed.length, 2, 'Must back off twice for 3 attempts');
    assert.equal(JSON.stringify(result).includes(secretKey), false, 'Must never leak API key in result');
  });

  test('27. Non-retryable errors (401 invalid key, 404 model not found) do not retry', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');

    // Case A: 401 Unauthorized
    let callCount401 = 0;
    const result401 = await callGeminiApi({
      apiKey: 'invalid-key-xyz',
      title: 'Non-retryable test',
      fetchImpl: async () => {
        callCount401++;
        return {
          ok: false,
          status: 401,
          json: async () => ({
            error: {
              code: 401,
              message: 'API key not valid. Please pass a valid API key.',
              status: 'UNAUTHENTICATED'
            }
          })
        };
      },
      maxAttempts: 3
    });

    assert.equal(result401.success, false);
    assert.equal(result401.error_code, 'INVALID_API_KEY');
    assert.equal(callCount401, 1, '401 must fail immediately on attempt 1 without retrying');

    // Case B: 404 Model Not Found
    let callCount404 = 0;
    const result404 = await callGeminiApi({
      apiKey: 'valid-format-key',
      title: 'Non-retryable test',
      fetchImpl: async () => {
        callCount404++;
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 404,
              message: 'models/some-invalid-model was not found',
              status: 'NOT_FOUND'
            }
          })
        };
      },
      maxAttempts: 3
    });

    assert.equal(result404.success, false);
    assert.equal(result404.error_code, 'MODEL_NOT_FOUND');
    assert.equal(callCount404, 1, '404 must fail immediately on attempt 1 without retrying');
  });

  test('28. Retry delay respects Retry-After header with upper bound cap and never logs secrets', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    const secretKey = 'SUPER_SECRET_KEY_999';
    const delays = [];

    // Mock an excessive Retry-After header (e.g. 120 seconds)
    const mockExcessiveRetryAfter = async () => ({
      ok: false,
      status: 503,
      headers: { 'retry-after': '120' },
      json: async () => ({
        error: {
          code: 503,
          message: `Internal backend error with key=${secretKey}`,
          status: 'UNAVAILABLE'
        }
      })
    });

    const result = await callGeminiApi({
      apiKey: secretKey,
      title: 'Bounded retry test',
      fetchImpl: mockExcessiveRetryAfter,
      sleepImpl: async (ms) => delays.push(ms),
      maxAttempts: 3,
      maxDelayMs: 5000
    });

    assert.equal(result.success, false);
    assert.equal(result.error_code, 'PROVIDER_TEMPORARILY_BUSY');
    assert.ok(delays.every((d) => d <= 5000), 'All retry delays must be capped by maxDelayMs');
    assert.equal(JSON.stringify(result).includes(secretKey), false, 'Secret must never be leaked');
  });

  test('29. Study -> clarification -> CSS flow combines context and estimates duration', async () => {
    // Step 1: User enters 'Study'
    setMockProvider(async ({ title, clarificationAnswer }) => {
      if (!clarificationAnswer) {
        return {
          success: true,
          needs_clarification: true,
          clarifying_question: 'What specific subject or chapter will you be studying?',
          estimated_minutes: null,
          confidence: null,
          estimate_reason: 'Task is too broad to estimate accurately without more detail.',
          range: null,
          milestone_breakdown_recommended: false
        };
      }
      // Step 2: Follow-up with clarification 'CSS'
      assert.equal(clarificationAnswer.toLowerCase(), 'css');
      return {
        success: true,
        needs_clarification: false,
        clarifying_question: null,
        estimated_minutes: 45,
        confidence: 'high',
        estimate_reason: 'Studying CSS styling, selectors, and layout techniques.',
        range: { min: 30, max: 60 },
        milestone_breakdown_recommended: false
      };
    });

    // Initial request: 'Study'
    const res1 = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Study'
      })
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.equal(data1.needs_clarification, true);
    assert.ok(data1.clarifying_question.length > 5);

    // Follow-up request: 'Study' + clarification 'CSS'
    const res2 = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Study',
        clarification_answer: 'CSS'
      })
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.needs_clarification, false);
    assert.equal(data2.estimated_minutes, 45);
    assert.equal(data2.confidence, 'high');
  });

  test('30. Generic clarification flow handles multiple task categories with unified context in prompt', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    const categories = [
      { title: 'Workout', clarify: 'Leg day squats and lunges', expectedMin: 50 },
      { title: 'Code', clarify: 'Implement JWT refresh token endpoint', expectedMin: 90 },
      { title: 'Cook', clarify: 'Vegetable lasagna from scratch', expectedMin: 75 },
      { title: 'Write', clarify: 'Blog post draft on distributed caching', expectedMin: 60 }
    ];

    for (const cat of categories) {
      let promptSent = '';
      const mockFetch = async (url, options) => {
        const body = JSON.parse(options.body);
        promptSent = body.contents[0].parts[0].text;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        needs_clarification: false,
                        clarifying_question: null,
                        estimated_minutes: cat.expectedMin,
                        confidence: 'high',
                        estimate_reason: `Estimated for ${cat.title} (${cat.clarify})`,
                        range: { min: cat.expectedMin - 15, max: cat.expectedMin + 20 },
                        milestone_breakdown_recommended: false
                      })
                    }
                  ]
                }
              }
            ]
          })
        };
      };

      const result = await callGeminiApi({
        apiKey: 'test-category-key',
        title: cat.title,
        clarificationAnswer: cat.clarify,
        fetchImpl: mockFetch
      });

      assert.equal(result.success, true);
      assert.equal(result.needs_clarification, false);
      assert.equal(result.estimated_minutes, cat.expectedMin);

      // Verify prompt combines original title and clarification into unified context
      assert.ok(promptSent.includes(cat.title), `Prompt must include original title ${cat.title}`);
      assert.ok(promptSent.includes(cat.clarify), `Prompt must include clarification answer ${cat.clarify}`);
      assert.ok(promptSent.includes('UNIFIED CONTEXT ANALYSIS'), 'Prompt must instruct unified context analysis');
      assert.ok(promptSent.includes('Do NOT treat the clarification answer as a separate or unrelated task'), 'Must preserve unified context');
    }
  });

  test('31. Gemini timeout (30s default) is handled as transient error with bounded retry (succeeds on attempt 2)', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    let callCount = 0;
    const delays = [];

    const mockFetch = async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      needs_clarification: false,
                      clarifying_question: null,
                      estimated_minutes: 30,
                      confidence: 'medium',
                      estimate_reason: 'Estimated on attempt 2 after initial timeout',
                      range: { min: 20, max: 40 },
                      milestone_breakdown_recommended: false
                    })
                  }
                ]
              }
            }
          ]
        })
      };
    };

    const result = await callGeminiApi({
      apiKey: 'test-timeout-key',
      title: 'Debug memory leak',
      fetchImpl: mockFetch,
      sleepImpl: async (ms) => delays.push(ms),
      timeoutMs: 30000,
      maxTimeoutRetries: 1
    });

    assert.equal(result.success, true);
    assert.equal(result.estimated_minutes, 30);
    assert.equal(callCount, 2, 'Exactly 2 calls made (1 timeout + 1 successful retry)');
    assert.equal(delays.length, 1, 'Backed off once between attempts');
  });

  test('32. Exhausted timeout stops at at most one additional attempt (bounded budget) and returns clear message', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    let callCount = 0;
    const delays = [];

    const mockFetchAlwaysTimeout = async () => {
      callCount++;
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    const result = await callGeminiApi({
      apiKey: 'test-exhausted-timeout-key',
      title: 'Complex calculation',
      fetchImpl: mockFetchAlwaysTimeout,
      sleepImpl: async (ms) => delays.push(ms),
      timeoutMs: 30000,
      maxAttempts: 3,
      maxTimeoutRetries: 1
    });

    assert.equal(result.success, false);
    assert.equal(result.error_code, 'PROVIDER_TIMEOUT');
    assert.ok(result.message.includes('timed out after 30 seconds'), 'Indicates 30 seconds timeout');
    assert.ok(result.message.includes('Please enter duration manually'), 'Instructs user to enter duration manually');
    assert.equal(callCount, 2, 'Must stop after at most 1 additional timeout attempt (2 total calls, avoiding multiplied waits)');
    assert.equal(delays.length, 1, 'Only backed off once');
  });

  test('33. Task form data is preserved and no duplicate task is created when estimation fails', async () => {
    // Check initial task count in db
    const initialCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?').get(userAToken ? userAId : '1').count;

    setMockProvider(async () => {
      return {
        success: false,
        error_code: 'PROVIDER_TIMEOUT',
        message: 'Gemini API request timed out after 30 seconds. Please enter duration manually.'
      };
    });

    const res = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Study',
        description: 'Web styling with flexbox and grid',
        priority: 'High',
        due_date: '2026-10-31'
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'PROVIDER_TIMEOUT');

    // Confirm database task count is UNCHANGED (estimation must never auto-save a task)
    const afterCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?').get(userAId).count;
    assert.equal(afterCount, initialCount, 'Estimation failure must not create any task records in database');
  });

  test('34. Configurable request timeout is loaded from config and used', () => {
    assert.equal(typeof config.ai.requestTimeoutMs, 'number');
    assert.ok(config.ai.requestTimeoutMs >= 10000, 'Configured request timeout should be at least 10s');
    assert.equal(config.ai.requestTimeoutMs, 30000, 'Default request timeout is 30000ms (30s)');
  });

  test('35. Save a new key, replace an existing key, and remove key with masked responses', async () => {
    const rawKey1 = 'test-gemini-alpha-first-key-1234567890TestA';
    const rawKey2 = 'test-gemini-beta-replacement-key-987654321B';

    // 1. Save new key
    const saveRes1 = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        mode: 'user_key',
        provider: 'gemini',
        apiKey: rawKey1
      })
    });
    assert.equal(saveRes1.status, 200);
    const saveData1 = await saveRes1.json();
    assert.equal(saveData1.success, true);
    assert.equal(saveData1.settings.hasKey, true);
    assert.equal(saveData1.settings.keyHint, 'test••••••••estA');
    assert.equal(JSON.stringify(saveData1).includes(rawKey1), false, 'Plaintext key must never be in API response');

    // 2. Replace with a second key
    const saveRes2 = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        mode: 'user_key',
        provider: 'gemini',
        apiKey: rawKey2
      })
    });
    assert.equal(saveRes2.status, 200);
    const saveData2 = await saveRes2.json();
    assert.equal(saveData2.success, true);
    assert.equal(saveData2.settings.hasKey, true);
    assert.equal(saveData2.settings.keyHint, 'test••••••••321B');
    assert.equal(JSON.stringify(saveData2).includes(rawKey2), false, 'Plaintext key must never be in API response');

    // Verify DB stored encrypted key for key2
    const row = db.prepare('SELECT encrypted_api_key, key_hint FROM user_ai_settings WHERE user_id = ?').get(userAId);
    assert.ok(row.encrypted_api_key);
    assert.equal(row.key_hint, 'test••••••••321B');
    const decrypted = decryptApiKey(row.encrypted_api_key, config.ai.encryptionSecret);
    assert.equal(decrypted, rawKey2);

    // 3. Remove key
    const delRes = await fetch(`${baseUrl}/api/tasks/ai-settings/key`, {
      method: 'DELETE',
      headers: { Cookie: userAToken }
    });
    assert.equal(delRes.status, 200);
    const delData = await delRes.json();
    assert.equal(delData.success, true);
    assert.equal(delData.settings.hasKey, false);
    assert.equal(delData.settings.keyHint, null);

    // Verify DB row has null encrypted key
    const rowAfter = db.prepare('SELECT encrypted_api_key, key_hint FROM user_ai_settings WHERE user_id = ?').get(userAId);
    assert.equal(rowAfter.encrypted_api_key, null);
    assert.equal(rowAfter.key_hint, null);
  });

  test('36. AES-256-GCM encryption at rest verification in database', () => {
    const testSecret = 'secret_test_key_for_db_verification_123';
    const plain = 'test-gemini-secret-at-rest-verification-key';
    const encrypted = encryptApiKey(plain, testSecret);

    // Format must be ivHex:authTagHex:ciphertextHex (3 colon-separated hex segments)
    const segments = encrypted.split(':');
    assert.equal(segments.length, 3, 'Must contain 3 colon-separated segments');
    assert.equal(segments[0].length, 24, 'IV must be 12 bytes = 24 hex characters');
    assert.equal(segments[1].length, 32, 'Auth tag must be 16 bytes = 32 hex characters');
    assert.ok(segments[2].length > 0, 'Ciphertext must be non-empty');

    // Plaintext never appears in raw encrypted string
    assert.equal(encrypted.includes(plain), false, 'Encrypted payload must not contain plaintext string');

    // Successfully decrypts back to original
    const decrypted = decryptApiKey(encrypted, testSecret);
    assert.equal(decrypted, plain, 'Decryption must match original plaintext');
  });

  test('37. Strict Cross-User Isolation: User A and User B cannot access each other keys', async () => {
    const keyUserA = 'test-gemini-userA-isolated-key-AAAA1111';
    const keyUserB = 'test-gemini-userB-isolated-key-BBBB2222';

    // Save key for User A
    await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({ mode: 'user_key', apiKey: keyUserA })
    });

    // Save key for User B
    await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userBToken
      },
      body: JSON.stringify({ mode: 'user_key', apiKey: keyUserB })
    });

    // User A fetches settings
    const resA = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'GET',
      headers: { Cookie: userAToken }
    });
    const dataA = await resA.json();
    assert.equal(dataA.settings.keyHint, 'test••••••••1111');
    assert.equal(JSON.stringify(dataA).includes('2222'), false);

    // User B fetches settings
    const resB = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'GET',
      headers: { Cookie: userBToken }
    });
    const dataB = await resB.json();
    assert.equal(dataB.settings.keyHint, 'test••••••••2222');
    assert.equal(JSON.stringify(dataB).includes('1111'), false);

    // User A deletes their key
    await fetch(`${baseUrl}/api/tasks/ai-settings/key`, {
      method: 'DELETE',
      headers: { Cookie: userAToken }
    });

    // User A now has no key, but User B is completely untouched
    const checkB = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'GET',
      headers: { Cookie: userBToken }
    });
    const dataCheckB = await checkB.json();
    assert.equal(dataCheckB.settings.hasKey, true);
    assert.equal(dataCheckB.settings.keyHint, 'test••••••••2222');
  });

  test('38. POST /api/tasks/ai-settings/test-connection endpoint returns SUCCESS for valid connection', async () => {
    setMockConnectionTest(async ({ userId, apiKey, provider }) => {
      return {
        success: true,
        status: 'SUCCESS',
        model: 'gemini-3.8-flash',
        latencyMs: 142,
        message: 'Connection verified! Gemini (gemini-3.8-flash) is connected and responding (142ms).',
        diagnostics: null
      };
    });

    const res = await fetch(`${baseUrl}/api/tasks/ai-settings/test-connection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userBToken // User B has saved key
      }
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, 'SUCCESS');
    assert.equal(data.model, 'gemini-3.8-flash');
    assert.equal(data.latencyMs, 142);
    assert.ok(data.message.includes('Connection verified'));
  });

  test('39. Connection test handles HTTP 401/403, 429, 503, and timeout error mappings accurately', async () => {
    // 1. HTTP 401 / 403 Invalid key
    const mockFetch401 = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          code: 401,
          message: 'API_KEY_INVALID: API key not valid. Please pass a valid API key.',
          status: 'UNAUTHENTICATED'
        }
      })
    });
    const result401 = await testGeminiConnection({
      apiKey: 'test-gemini-invalid-key-test-123',
      fetchImpl: mockFetch401
    });
    assert.equal(result401.success, false);
    assert.equal(result401.status, 'INVALID_KEY');
    assert.equal(result401.error_code, 'INVALID_API_KEY');
    assert.ok(result401.message.includes('Invalid or unauthorized Gemini API key'));

    // 2. HTTP 429 Free Tier / Daily Quota Exceeded
    const mockFetch429 = async () => ({
      ok: false,
      status: 429,
      headers: {
        get: (h) => (h.toLowerCase() === 'retry-after' ? '3600' : null)
      },
      json: async () => ({
        error: {
          code: 429,
          message: 'Resource has been exhausted (e.g. check quota).',
          status: 'RESOURCE_EXHAUSTED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
              violations: [
                {
                  quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                  quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'
                }
              ]
            },
            {
              '@type': 'type.googleapis.com/google.rpc.RetryInfo',
              retryDelay: '3600s'
            }
          ]
        }
      })
    });
    const result429 = await testGeminiConnection({
      apiKey: 'test-gemini-quota-exhausted-key-test-123',
      fetchImpl: mockFetch429
    });
    assert.equal(result429.success, false);
    assert.equal(result429.status, 'QUOTA_EXCEEDED');
    assert.equal(result429.error_code, 'PROVIDER_QUOTA_EXHAUSTED');
    assert.ok(result429.message.includes('free-tier daily quota is currently exhausted') || result429.message.includes('quota is currently unavailable'));
    assert.equal(result429.diagnostics.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
    assert.equal(result429.diagnostics.retryDelay, '3600s');

    // 3. HTTP 503 Provider Temporarily Overloaded
    const mockFetch503 = async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: 503,
          message: 'The model is overloaded. Please try again later.',
          status: 'UNAVAILABLE'
        }
      })
    });
    const result503 = await testGeminiConnection({
      apiKey: 'test-gemini-busy-key-test-123',
      fetchImpl: mockFetch503
    });
    assert.equal(result503.success, false);
    assert.equal(result503.status, 'TEMPORARILY_UNAVAILABLE');
    assert.equal(result503.error_code, 'PROVIDER_TEMPORARILY_BUSY');
    assert.ok(result503.message.includes('high demand') || result503.message.includes('temporarily unavailable'));

    // 4. Request Timeout
    const mockFetchTimeout = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };
    const resultTimeout = await testGeminiConnection({
      apiKey: 'test-gemini-timeout-key-test-123',
      fetchImpl: mockFetchTimeout
    });
    assert.equal(resultTimeout.success, false);
    assert.equal(resultTimeout.status, 'TIMEOUT');
    assert.equal(resultTimeout.error_code, 'PROVIDER_TIMEOUT');
    assert.ok(resultTimeout.message.includes('timed out'));
  });

  test('40. Safe error diagnostics and logging never leaks raw API keys', () => {
    const rawApiKey = 'test-gemini-super-secret-key-val-1234567890';
    const errorWithUrlAndKey = {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: `Request to https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${rawApiKey} failed with invalid parameter.`
      }
    };

    const diagnostics = extractGeminiErrorDiagnostics(errorWithUrlAndKey, { status: 400 }, rawApiKey);
    assert.equal(diagnostics.message.includes(rawApiKey), false, 'Diagnostics message must never contain raw API key');
    assert.ok(diagnostics.message.includes('[REDACTED]'), 'Sanitized message contains redacted token');
  });

  test('41. AI Settings UI markup contains dedicated section, masked key, modal, and helper link', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/views/dashboard.html'), 'utf8');

    // Section card & overview
    assert.ok(html.includes('id="aiSettingsCard"'), 'Settings card exists');
    assert.ok(html.includes('id="aiKeyStatusPill"'), 'Key status pill exists');
    assert.ok(html.includes('id="aiSettingsSavedKeyVal"'), 'Saved key display exists');
    assert.ok(html.includes('id="openAiKeyModalBtn"'), 'Open modal button exists');
    assert.ok(html.includes('id="testAiConnectionBtn"'), 'Test connection button exists');
    assert.ok(html.includes('id="removeAiKeyBtn"'), 'Remove key button exists');
    assert.ok(html.includes('id="aiSettingsFeedbackMsg"'), 'Feedback message banner exists');

    // Separate modal form
    assert.ok(html.includes('id="aiKeyModal"'), 'aiKeyModal container exists');
    assert.ok(html.includes('id="modalGeminiApiKey"'), 'Modal password input exists');
    assert.ok(html.includes('type="password"'), 'Input has password type');
    assert.ok(html.includes('id="toggleModalKeyEyeBtn"'), 'Show/hide key toggle eye exists');
    assert.ok(html.includes('id="saveModalAiKeyBtn"'), 'Save API key button exists');
    assert.ok(html.includes('https://aistudio.google.com/apikey'), 'Helper link to Google AI Studio exists');
  });

  test('42. Diagnostics: Google AI Studio Quota Exhaustion extraction and live connection check', async () => {
    // Test extraction logic on exact Gemini 3.8 Flash Free Tier error shape
    const geminiFreeTierQuotaError = {
      error: {
        code: 429,
        message: 'Resource has been exhausted (e.g. check quota).',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [
              {
                quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
                quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                quotaValue: '20'
              }
            ]
          },
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'RATE_LIMIT_EXCEEDED',
            domain: 'googleapis.com',
            metadata: {
              consumer: 'projects/1056525793086',
              quota_limit: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
              quota_limit_value: '20',
              quota_metric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
              service: 'generativelanguage.googleapis.com'
            }
          },
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '46834s'
          }
        ]
      }
    };

    const diagnostics = extractGeminiErrorDiagnostics(geminiFreeTierQuotaError, { status: 429 }, 'fake-key');
    assert.equal(diagnostics.status, 'RESOURCE_EXHAUSTED');
    assert.equal(diagnostics.errorSubtype, 'FREE_TIER_DAILY_LIMIT');
    assert.equal(diagnostics.quotaMetric, 'generativelanguage.googleapis.com/generate_content_free_tier_requests');
    assert.equal(diagnostics.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
    assert.equal(diagnostics.retryDelay, '46834s');
    assert.equal(diagnostics.reason, 'RATE_LIMIT_EXCEEDED');
    assert.ok(diagnostics.metadata);

    // Optional Live test (if live key available in environment)
    const envKey = process.env.GEMINI_API_KEY;
    if (envKey && envKey.trim()) {
      console.log('\n[Live Provider Test] Testing actual live Gemini endpoint with configured key...');
      const liveResult = await testGeminiConnection({
        apiKey: envKey.trim(),
        model: 'gemini-3.8-flash',
        timeoutMs: 10000
      });
      console.log(`[Live Provider Test Result] Status: ${liveResult.status}, Success: ${liveResult.success}, Message: ${liveResult.message}`);
      if (liveResult.status === 'QUOTA_EXCEEDED') {
        console.log(`[Live Provider Diagnostic] Live key accurately identified as QUOTA_EXCEEDED (${liveResult.diagnostics?.quotaId || 'FreeTier limit'})`);
      }
    } else {
      console.log('\n[Live Provider Test] No live GEMINI_API_KEY in environment; mock verified.');
    }
  });

  test('43. Regression: Remove-then-re-add key lifecycle, first-time save, invalid input rejection, and UI contracts', async () => {
    // A. First-time save for a brand new user who never configured a key
    const resNew = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Brand New User AI',
        email: `brand_new_ai_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    assert.equal(resNew.status, 201);
    const newUserData = await resNew.json();
    const cookiesNew = resNew.headers.getSetCookie ? resNew.headers.getSetCookie() : [resNew.headers.get('set-cookie')];
    const newUserToken = cookiesNew.map((c) => c.split(';')[0]).join('; ');
    const newUserId = newUserData.user.id;

    // Check initial settings: hasKey must be false, row does not exist yet
    const initialGet = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      headers: { Cookie: newUserToken }
    });
    const initialData = await initialGet.json();
    assert.equal(initialData.settings.hasKey, false);
    assert.equal(initialData.settings.keyHint, null);

    // Save key for the first time
    const rawKeyFirst = 'test-gemini-brand-new-user-initial-key-12345';
    const firstSaveRes = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newUserToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: rawKeyFirst })
    });
    assert.equal(firstSaveRes.status, 200);
    const firstSaveData = await firstSaveRes.json();
    assert.equal(firstSaveData.success, true);
    assert.equal(firstSaveData.settings.hasKey, true);
    assert.equal(firstSaveData.settings.keyHint, 'test••••••••2345');
    assert.equal(JSON.stringify(firstSaveData).includes(rawKeyFirst), false, 'No plaintext key returned');

    // Verify DB encrypted at rest
    const dbRow1 = db.prepare('SELECT encrypted_api_key, key_hint, mode FROM user_ai_settings WHERE user_id = ?').get(newUserId);
    assert.ok(dbRow1.encrypted_api_key);
    assert.equal(dbRow1.mode, 'user_key');
    assert.equal(decryptApiKey(dbRow1.encrypted_api_key, config.ai.encryptionSecret), rawKeyFirst);

    // B. Remove key
    const removeRes = await fetch(`${baseUrl}/api/tasks/ai-settings/key`, {
      method: 'DELETE',
      headers: { Cookie: newUserToken }
    });
    assert.equal(removeRes.status, 200);
    const removeData = await removeRes.json();
    assert.equal(removeData.settings.hasKey, false);
    assert.equal(removeData.settings.keyHint, null);

    // Verify DB has cleared key
    const dbRowRemoved = db.prepare('SELECT encrypted_api_key, key_hint, mode FROM user_ai_settings WHERE user_id = ?').get(newUserId);
    assert.equal(dbRowRemoved.encrypted_api_key, null);
    assert.equal(dbRowRemoved.key_hint, null);

    // C. CRITICAL BUG REGRESSION: Re-add new key after removal
    const rawKeyReAdd = 'test-gemini-re-added-gemini-key-9876543210XYZ';
    const reAddRes = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newUserToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: rawKeyReAdd })
    });
    assert.equal(reAddRes.status, 200);
    const reAddData = await reAddRes.json();
    assert.equal(reAddData.success, true);
    assert.equal(reAddData.settings.hasKey, true);
    assert.equal(reAddData.settings.keyHint, 'test••••••••0XYZ');
    assert.equal(JSON.stringify(reAddData).includes(rawKeyReAdd), false, 'No plaintext key in response');

    // Verify DB row was successfully updated with re-added key
    const dbRowReAdded = db.prepare('SELECT encrypted_api_key, key_hint, mode FROM user_ai_settings WHERE user_id = ?').get(newUserId);
    assert.ok(dbRowReAdded.encrypted_api_key);
    assert.equal(dbRowReAdded.mode, 'user_key');
    assert.equal(dbRowReAdded.key_hint, 'test••••••••0XYZ');
    assert.equal(decryptApiKey(dbRowReAdded.encrypted_api_key, config.ai.encryptionSecret), rawKeyReAdd);

    // D. Invalid input handling: empty string or whitespace key must be rejected with 400
    const emptySaveRes = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: newUserToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: '   ' })
    });
    assert.equal(emptySaveRes.status, 400);
    const emptySaveData = await emptySaveRes.json();
    assert.equal(emptySaveData.success, false);
    assert.ok(emptySaveData.message.includes('valid'));

    // E. Confirm HTML DOM structure: aiProviderSelectModal is properly closed and not nesting aiKeyModal
    const html = fs.readFileSync(path.resolve(__dirname, '../public/views/dashboard.html'), 'utf8');
    const providerModalIndex = html.indexOf('id="aiProviderSelectModal"');
    const keyModalIndex = html.indexOf('id="aiKeyModal"');
    assert.ok(providerModalIndex > 0);
    assert.ok(keyModalIndex > providerModalIndex);

    // Verify aiProviderSelectModal closes before aiKeyModal opens
    const betweenModals = html.substring(providerModalIndex, keyModalIndex);
    const openDivs = (betweenModals.match(/<div/g) || []).length;
    const closeDivs = (betweenModals.match(/<\/div>/g) || []).length;
    assert.equal(openDivs, closeDivs, 'All divs in aiProviderSelectModal must be balanced and closed before aiKeyModal');

    // Confirm button has click handler
    assert.ok(html.includes('id="saveModalAiKeyBtn"'));
    assert.ok(html.includes('onclick="handleSaveAiKeyFromModal(event)"'), 'Save button must have working click handler');
  });

  test('44. Regression: Granular error categories (unsupported key type, permission denied, invalid key), active updated key usage, and auth headers', async () => {
    // A. Verify newly saved key is immediately used without using stale key or fallback
    let testedKeyPassed = null;
    let authHeaderPassed = null;
    let urlPassed = null;

    setMockConnectionTest(async ({ apiKey }) => {
      testedKeyPassed = apiKey;
      return { success: true, status: 'SUCCESS', model: 'gemini-3.8-flash' };
    });

    // 1. Save Key 1
    const key1 = 'test-gemini-first-saved-key-11111111111111111';
    await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: key1 })
    });

    await fetch(`${baseUrl}/api/tasks/ai-settings/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken }
    });
    assert.equal(testedKeyPassed, key1, 'Test connection must use the user first saved key');

    // 2. Change to Key 2
    const key2 = 'test-gemini-second-updated-key-2222222222222222';
    await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: key2 })
    });

    await fetch(`${baseUrl}/api/tasks/ai-settings/test-connection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken }
    });
    assert.equal(testedKeyPassed, key2, 'Test connection must immediately use the newly updated key (no stale key)');

    resetMockConnectionTest();

    // B. Header and endpoint verification: request uses x-goog-api-key header and correct model
    const mockCaptureFetch = async (url, options) => {
      urlPassed = url;
      authHeaderPassed = options?.headers?.['x-goog-api-key'];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ needs_clarification: false, estimated_minutes: 30, confidence: 'high', estimate_reason: 'Captured header test' }) }] } }]
        })
      };
    };

    const callResult = await callGeminiApi({
      apiKey: key2,
      title: 'Check headers passed',
      fetchImpl: mockCaptureFetch
    });
    assert.equal(callResult.success, true);
    assert.equal(authHeaderPassed, key2, 'Must include x-goog-api-key header');
    assert.ok(urlPassed.includes('/v1beta/models/gemini-3.8-flash:generateContent'), 'Must use v1beta generateContent endpoint with gemini-3.8-flash');

    // C. Error Category 1: UNSUPPORTED_KEY_TYPE (Gemini Auth Key / OAuth access token format)
    const mockAuthKeyResponse = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          code: 401,
          message: 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project.',
          status: 'UNAUTHENTICATED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED',
              metadata: {
                method: 'google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent',
                service: 'generativelanguage.googleapis.com'
              }
            }
          ]
        }
      })
    });

    const mockOauthAuthKey = ('A' + 'Q.') + 'MockAuthKeyFormat1234567890Test';
    const testConnUnsupported = await testGeminiConnection({
      apiKey: mockOauthAuthKey,
      fetchImpl: mockAuthKeyResponse
    });
    assert.equal(testConnUnsupported.success, false);
    assert.equal(testConnUnsupported.status, 'UNSUPPORTED_KEY_TYPE');
    assert.equal(testConnUnsupported.error_code, 'UNSUPPORTED_KEY_TYPE');
    assert.ok(testConnUnsupported.message.includes('Unsupported credential type'));
    assert.equal(testConnUnsupported.diagnostics.reason, 'ACCESS_TOKEN_TYPE_UNSUPPORTED');
    assert.equal(testConnUnsupported.diagnostics.code, 401);

    const callUnsupported = await callGeminiApi({
      apiKey: mockOauthAuthKey,
      title: 'Run task with auth key',
      fetchImpl: mockAuthKeyResponse
    });
    assert.equal(callUnsupported.success, false);
    assert.equal(callUnsupported.error_code, 'UNSUPPORTED_KEY_TYPE');
    assert.ok(callUnsupported.message.includes('Unsupported credential type'));

    // D. Error Category 2: PERMISSION_DENIED (Project access denied / disabled / restricted)
    const mockDeniedResponse = async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: 403,
          message: 'Your project has been denied access. Please contact support.',
          status: 'PERMISSION_DENIED'
        }
      })
    });

    const testConnDenied = await testGeminiConnection({
      apiKey: key2,
      fetchImpl: mockDeniedResponse
    });
    assert.equal(testConnDenied.success, false);
    assert.equal(testConnDenied.status, 'PERMISSION_DENIED');
    assert.equal(testConnDenied.error_code, 'PERMISSION_DENIED');
    assert.ok(testConnDenied.message.includes('denied access'));
    assert.equal(testConnDenied.diagnostics.code, 403);
    assert.equal(testConnDenied.diagnostics.status, 'PERMISSION_DENIED');

    const callDenied = await callGeminiApi({
      apiKey: key2,
      title: 'Run task with denied project key',
      fetchImpl: mockDeniedResponse
    });
    assert.equal(callDenied.success, false);
    assert.equal(callDenied.error_code, 'PERMISSION_DENIED');
    assert.ok(callDenied.message.includes('denied access'));

    // E. Error Category 3: PERMISSION_DENIED via API_KEY_SERVICE_BLOCKED
    const mockBlockedResponse = async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: 403,
          message: 'The Generative Language API has not been used in project or it is disabled.',
          status: 'PERMISSION_DENIED',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_SERVICE_BLOCKED'
            }
          ]
        }
      })
    });

    const testConnBlocked = await testGeminiConnection({
      apiKey: key2,
      fetchImpl: mockBlockedResponse
    });
    assert.equal(testConnBlocked.success, false);
    assert.equal(testConnBlocked.status, 'PERMISSION_DENIED');
    assert.equal(testConnBlocked.error_code, 'PERMISSION_DENIED');

    // F. Error Category 4: INVALID_API_KEY (Malformed key with API_KEY_INVALID)
    const mockInvalidKeyResponse = async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'API_KEY_INVALID'
            }
          ]
        }
      })
    });

    const testConnInvalid = await testGeminiConnection({
      apiKey: 'test-gemini-fake-bad-key',
      fetchImpl: mockInvalidKeyResponse
    });
    assert.equal(testConnInvalid.success, false);
    assert.equal(testConnInvalid.status, 'INVALID_KEY');
    assert.equal(testConnInvalid.error_code, 'INVALID_API_KEY');

    const callInvalid = await callGeminiApi({
      apiKey: 'test-gemini-fake-bad-key',
      title: 'Run task with bad key',
      fetchImpl: mockInvalidKeyResponse
    });
    assert.equal(callInvalid.success, false);
    assert.equal(callInvalid.error_code, 'INVALID_API_KEY');

    // G. Verify HTTP status mapping in POST /api/tasks/estimate-duration
    setMockProvider(async () => ({
      success: false,
      error_code: 'UNSUPPORTED_KEY_TYPE',
      message: 'Unsupported credential type.'
    }));
    const resEstUnsupported = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken },
      body: JSON.stringify({ title: 'Task test unsupported' })
    });
    assert.equal(resEstUnsupported.status, 401);

    setMockProvider(async () => ({
      success: false,
      error_code: 'PERMISSION_DENIED',
      message: 'Your project has been denied access.'
    }));
    const resEstDenied = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken },
      body: JSON.stringify({ title: 'Task test denied' })
    });
    assert.equal(resEstDenied.status, 403);
  });

  test('45. Input validation accepts any valid key format without hardcoded prefix assumptions, rejects empty keys, and preserves distinct error categories', async () => {
    // 1. Prefix-free input validation: AQ key saves and encrypts cleanly
    const aqKey = ('A' + 'Q.') + 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789Test';
    const saveAqRes = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: aqKey })
    });
    assert.equal(saveAqRes.status, 200);
    const saveAqData = await saveAqRes.json();
    assert.equal(saveAqData.success, true);
    assert.equal(saveAqData.settings.hasKey, true);
    assert.equal(saveAqData.settings.keyHint, ('A' + 'Q.') + 'A••••••••Test');

    // Verify database row is AES-256-GCM encrypted and decrypts to original
    const aqRow = db.prepare('SELECT encrypted_api_key, key_hint FROM user_ai_settings WHERE user_id = ?').get(userAId);
    assert.ok(aqRow.encrypted_api_key);
    assert.equal(decryptApiKey(aqRow.encrypted_api_key, config.ai.encryptionSecret), aqKey);

    // 2. Custom/alphanumeric key prefix also saves without restriction
    const customKey = 'custom_prefix_9999888877776666';
    const saveCustomRes = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: customKey })
    });
    assert.equal(saveCustomRes.status, 200);
    const saveCustomData = await saveCustomRes.json();
    assert.equal(saveCustomData.success, true);
    assert.equal(saveCustomData.settings.keyHint, 'cust••••••••6666');

    // 3. Empty or whitespace-only keys are strictly rejected with 400
    const emptyRes = await fetch(`${baseUrl}/api/tasks/ai-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userAToken },
      body: JSON.stringify({ mode: 'user_key', apiKey: '   ' })
    });
    assert.equal(emptyRes.status, 400);

    // 4. Test provider error distinction:
    // Category: UNSUPPORTED_KEY_TYPE
    const diagUnsupported = extractGeminiErrorDiagnostics({
      error: {
        code: 401,
        message: 'Request had invalid authentication credentials. Expected OAuth 2 access token.',
        status: 'UNAUTHENTICATED',
        details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }]
      }
    }, { status: 401 }, customKey);
    assert.equal(diagUnsupported.errorSubtype, 'UNSUPPORTED_KEY_TYPE');
    assert.equal(diagUnsupported.code, 401);

    // Category: PERMISSION_DENIED
    const diagDenied = extractGeminiErrorDiagnostics({
      error: {
        code: 403,
        message: 'Your project has been denied access.',
        status: 'PERMISSION_DENIED'
      }
    }, { status: 403 }, customKey);
    assert.equal(diagDenied.errorSubtype, 'PERMISSION_DENIED');
    assert.equal(diagDenied.code, 403);

    // Category: INVALID_KEY
    const diagInvalid = extractGeminiErrorDiagnostics({
      error: {
        code: 400,
        message: 'API key not valid.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }]
      }
    }, { status: 400 }, customKey);
    assert.equal(diagInvalid.errorSubtype, 'INVALID_KEY');

    // Category: QUOTA_EXHAUSTED
    const diagQuota = extractGeminiErrorDiagnostics({
      error: {
        code: 429,
        message: 'Resource exhausted.',
        status: 'RESOURCE_EXHAUSTED'
      }
    }, { status: 429 }, customKey);
    assert.equal(diagQuota.errorSubtype, 'QUOTA_EXHAUSTED');

    // Category: TEMPORARY_OVERLOAD
    const diagOverload = extractGeminiErrorDiagnostics({
      error: {
        code: 503,
        message: 'Model is overloaded.',
        status: 'UNAVAILABLE'
      }
    }, { status: 503 }, customKey);
    assert.equal(diagOverload.errorSubtype, 'TEMPORARY_OVERLOAD');
  });

  test('46. Responsiveness, bounded total timeout (~15s), retry limits, distinct error messages, and manual fallback', async () => {
    const { callGeminiApi } = require('../server/services/aiProviders/geminiProvider');
    const dashboardJs = fs.readFileSync(path.resolve(__dirname, '../public/js/dashboard.js'), 'utf8');

    // 46a. Fast failure on HTTP 429 quota exhaustion (zero retries, safe timing metrics)
    let callCount429 = 0;
    const result429 = await callGeminiApi({
      apiKey: 'test-quota-key-429',
      title: 'Analyze algorithm',
      fetchImpl: async () => {
        callCount429++;
        return {
          ok: false,
          status: 429,
          json: async () => ({
            error: {
              code: 429,
              message: 'Resource has been exhausted (e.g. check quota).',
              status: 'RESOURCE_EXHAUSTED'
            }
          })
        };
      },
      totalTimeoutMs: 15000
    });

    assert.equal(result429.success, false);
    assert.equal(result429.error_code, 'PROVIDER_QUOTA_EXHAUSTED');
    assert.ok(result429.message.toLowerCase().includes('quota') || result429.message.toLowerCase().includes('rate limit'), 'Explains quota or rate limit reached');
    assert.equal(callCount429, 1, 'HTTP 429 quota exhaustion must fail fast on attempt 1 without retrying');
    assert.ok(result429.timings, 'Result must include safe timing metrics');
    assert.equal(typeof result429.timings.totalElapsedMs, 'number');
    assert.equal(result429.timings.attempts.length, 1);
    assert.equal(result429.timings.attempts[0].status, 429);

    // 46b. Transient HTTP 503: At most one retry when budget permits, and stops if budget exhausted
    let callCount503 = 0;
    const delays503 = [];
    const result503 = await callGeminiApi({
      apiKey: 'test-transient-503',
      title: 'Design distributed cache',
      fetchImpl: async () => {
        callCount503++;
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: {
              code: 503,
              message: 'This model is temporarily unavailable.',
              status: 'UNAVAILABLE'
            }
          })
        };
      },
      sleepImpl: async (ms) => delays503.push(ms),
      maxAttempts: 2,
      totalTimeoutMs: 15000
    });

    assert.equal(result503.success, false);
    assert.equal(callCount503, 2, 'Must attempt at most one retry for transient 503 (total 2 attempts)');
    assert.equal(delays503.length, 1, 'Must back off exactly once');
    assert.ok(result503.message.toLowerCase().includes('unavailable'), 'Explains provider is temporarily unavailable');
    assert.ok(result503.timings.retryDelayMs > 0, 'Records retry delay timing');

    // 46c. Transient HTTP 503 stops immediately when remaining time budget is insufficient
    let callCountBudget = 0;
    const resultBudget = await callGeminiApi({
      apiKey: 'test-budget-key',
      title: 'Fast task',
      fetchImpl: async () => {
        callCountBudget++;
        return {
          ok: false,
          status: 503,
          json: async () => ({
            error: { code: 503, message: 'Unavailable', status: 'UNAVAILABLE' }
          })
        };
      },
      maxAttempts: 2,
      totalTimeoutMs: 1000 // Small budget: attempt 1 delay (~1.5s) exceeds remaining budget
    });

    assert.equal(resultBudget.success, false);
    assert.equal(callCountBudget, 1, 'Must NOT retry when remaining time budget cannot accommodate backoff');

    // 46d. Bounded timeout return and accurate error code
    const resultTimeout = await callGeminiApi({
      apiKey: 'test-timeout-bounded',
      title: 'Long computation',
      fetchImpl: async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      },
      timeoutMs: 15000,
      totalTimeoutMs: 15000,
      maxTimeoutRetries: 0
    });

    assert.equal(resultTimeout.success, false);
    assert.equal(resultTimeout.error_code, 'PROVIDER_TIMEOUT');
    assert.ok(resultTimeout.message.includes('Please enter duration manually'), 'Suggests manual duration entry');
    assert.ok(resultTimeout.timings, 'Returns safe timings on timeout');

    // 46e. Distinct error messages: No universal "temporarily busy" collapse
    assert.notEqual(result429.error_code, 'PROVIDER_TEMPORARILY_BUSY');
    assert.notEqual(resultTimeout.error_code, 'PROVIDER_TEMPORARILY_BUSY');

    // 46f. Frontend responsiveness & usability contracts in dashboard.js
    assert.ok(dashboardJs.includes('btn._isEstimating'), 'Frontend must have in-flight estimation flag');
    assert.ok(dashboardJs.includes('btn.disabled = true'), 'Frontend must disable button immediately on click');
    assert.ok(dashboardJs.includes('⏳ Estimating...'), 'Frontend must display immediate loading state');
    assert.ok(dashboardJs.includes('focusManualDurationInput'), 'Frontend must provide manual duration focus helper');
    assert.ok(dashboardJs.includes('Enter Duration Manually'), 'Frontend must display explicit manual duration entry option');
    assert.ok(dashboardJs.includes('clientController.abort'), 'Frontend must have client-side safety abort timeout');

    // 46g. AI estimation must never persist a task
    const taskCountBefore = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?').get(userAId).count;
    const estRes = await fetch(`${baseUrl}/api/tasks/estimate-duration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userAToken
      },
      body: JSON.stringify({
        title: 'Transient failure task',
        description: 'Should not be saved to tasks table',
        priority: 'High'
      })
    });
    const estData = await estRes.json();
    assert.ok(estData);
    const taskCountAfter = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE user_id = ?').get(userAId).count;
    assert.equal(taskCountAfter, taskCountBefore, 'AI estimation must never create or persist tasks to the database');
  });
});


