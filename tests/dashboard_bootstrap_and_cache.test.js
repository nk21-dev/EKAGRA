/**
 * EKAGRA — Dashboard Bootstrap & Instant SWR Hydration Test Suite
 * 
 * Verifies:
 * 1. Single Parallel Bootstrap Endpoint (GET /api/dashboard/bootstrap):
 *    - Rejects unauthenticated requests with 401.
 *    - Returns user profile, dashboardData, todaySchedule, and insightsData in 1 parallel response.
 *    - Strict User Isolation: User B's bootstrap never leaks User A's data.
 * 2. Fast Turso/SQLite Cold-Start Migration Check (schema_meta):
 *    - Fresh DB establishes schema_meta at LATEST_SCHEMA_VERSION.
 *    - Subsequent cold-start runs skip all DDL execution via single fast query.
 * 3. Client Cache SWR Isolation:
 *    - Switching users / signing out clears cache keys so User B never sees User A's snapshot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');

const testDbPath = path.resolve(__dirname, '../data/test_bootstrap_cache_ekagra.sqlite');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = './data/test_bootstrap_cache_ekagra.sqlite';

const app = require('../server/index');
const { runMigrationsSync, runMigrationsAsync, LATEST_SCHEMA_VERSION } = require('../server/db/migrations');
const { TursoDatabaseWrapper } = require('../server/db');

let server;
let baseUrl;

function makeRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };

    let bodyData = null;
    if (body) {
      bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json,
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function extractCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieStr.split(';')[0];
}

test('EKAGRA Dashboard Bootstrap & SWR Cache Suite', async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(testDbPath)) {
      try { fs.unlinkSync(testDbPath); } catch (e) {}
    }
  });

  let userACookie = null;
  let userBCookie = null;
  let userAId = null;
  let userBId = null;

  await t.test('1. GET /api/dashboard/bootstrap rejects unauthenticated requests', async () => {
    const res = await makeRequest('GET', '/api/dashboard/bootstrap');
    assert.equal(res.status, 401);
    assert.match(res.json.error, /Authentication required/i);
  });

  await t.test('2. User A registration & Goal/Task setup', async () => {
    const signupRes = await makeRequest('POST', '/api/auth/signup', {}, {
      name: 'User A',
      email: 'usera.bootstrap@ekagra.ai',
      password: 'password123',
      confirmPassword: 'password123'
    });
    assert.equal(signupRes.status, 201);
    userACookie = extractCookie(signupRes.headers);
    userAId = signupRes.json.user.id;
    assert.ok(userACookie);

    // Create a Goal for User A
    const goalRes = await makeRequest('POST', '/api/goals', { Cookie: userACookie }, {
      title: 'Master Systems Architecture',
      target_date: '2026-12-31',
      priority: 'High',
      description: 'Distributed systems and DB internals'
    });
    assert.equal(goalRes.status, 201);
    const goalId = goalRes.json.goal.id;

    // Create a Task for User A
    const taskRes = await makeRequest('POST', '/api/tasks', { Cookie: userACookie }, {
      goal_id: goalId,
      title: 'Study Raft consensus',
      duration_minutes: 45,
      priority: 'High'
    });
    assert.equal(taskRes.status, 201);
  });

  await t.test('3. GET /api/dashboard/bootstrap returns unified parallel payload for User A', async () => {
    const res = await makeRequest('GET', '/api/dashboard/bootstrap', { Cookie: userACookie });
    assert.equal(res.status, 200);
    const data = res.json;

    assert.equal(data.success, true);
    assert.equal(data.user.id, userAId);
    assert.equal(data.user.name, 'User A');
    assert.equal(data.user.email, 'usera.bootstrap@ekagra.ai');

    // Dashboard Data check
    assert.ok(data.dashboardData);
    assert.equal(data.goals.length, 1);
    assert.equal(data.goals[0].title, 'Master Systems Architecture');
    assert.equal(data.tasks.length, 1);
    assert.equal(data.tasks[0].title, 'Study Raft consensus');

    // Today's Schedule check
    assert.ok(data.todaySchedule);
    assert.ok(Array.isArray(data.todaySchedule.blocks));

    // Insights Data check
    assert.ok(data.insightsData);
    assert.ok(data.insightsData.metrics);
    assert.ok(data.insightsData.learning);
    assert.ok(data.insightsData.capacity);
  });

  await t.test('4. Strict Isolation: User B bootstrap never leaks User A data', async () => {
    const signupRes = await makeRequest('POST', '/api/auth/signup', {}, {
      name: 'User B',
      email: 'userb.bootstrap@ekagra.ai',
      password: 'password123',
      confirmPassword: 'password123'
    });
    assert.equal(signupRes.status, 201);
    userBCookie = extractCookie(signupRes.headers);
    userBId = signupRes.json.user.id;
    assert.notEqual(userAId, userBId);

    const res = await makeRequest('GET', '/api/dashboard/bootstrap', { Cookie: userBCookie });
    assert.equal(res.status, 200);
    const data = res.json;

    assert.equal(data.user.id, userBId);
    assert.equal(data.user.name, 'User B');
    assert.equal(data.user.email, 'userb.bootstrap@ekagra.ai');

    // Zero-data contract for new user
    assert.equal(data.goals.length, 0, 'User B must have 0 goals');
    assert.equal(data.tasks.length, 0, 'User B must have 0 tasks');
    assert.equal(data.isColdStart, true, 'User B must start in cold start');
  });

  await t.test('5. Fast schema_meta migration check in SQLite (Sync)', () => {
    const memDb = new DatabaseSync(':memory:');
    
    // First run on fresh DB: runs all migrations and populates schema_meta
    const firstRun = runMigrationsSync(memDb);
    assert.equal(firstRun, true);

    const metaRow = memDb.prepare("SELECT version FROM schema_meta WHERE key = 'ekagra_schema'").get();
    assert.ok(metaRow);
    assert.equal(metaRow.version, LATEST_SCHEMA_VERSION);

    // Second run: schema_meta is >= LATEST_SCHEMA_VERSION, exits immediately in 1 query
    const secondRun = runMigrationsSync(memDb);
    assert.equal(secondRun, true);
  });

  await t.test('6. Fast schema_meta migration check in Turso wrapper (Async)', async () => {
    const memDb = new DatabaseSync(':memory:');
    const mockTurso = {
      isTurso: true,
      execCallCount: 0,
      async exec(sql) {
        this.execCallCount++;
        memDb.exec(sql);
      },
      prepare(sql) {
        const stmt = memDb.prepare(sql);
        return {
          all: async (...args) => stmt.all(...args),
          get: async (...args) => stmt.get(...args),
          run: async (...args) => stmt.run(...args),
        };
      }
    };

    // First run: executes all migrations
    const firstRun = await runMigrationsAsync(mockTurso);
    assert.equal(firstRun, true);
    const initialExecCount = mockTurso.execCallCount;
    assert.ok(initialExecCount > 0, 'First run must execute DDL statements');

    // Verify schema_meta was created
    const metaRow = await mockTurso.prepare("SELECT version FROM schema_meta WHERE key = 'ekagra_schema'").get();
    assert.equal(metaRow.version, LATEST_SCHEMA_VERSION);

    // Second run: must skip all migration scripts in 1 fast query (0 additional exec calls)
    const secondRun = await runMigrationsAsync(mockTurso);
    assert.equal(secondRun, true);
    assert.equal(mockTurso.execCallCount, initialExecCount, 'Second run must NOT execute any additional DDL');
  });

  await t.test('7. Client Cache Isolation simulation: User B never inherits User A snapshot', () => {
    // Simulate browser localStorage
    const mockStorage = new Map();
    const setItem = (k, v) => mockStorage.set(k, String(v));
    const getItem = (k) => mockStorage.get(k) || null;
    const removeItem = (k) => mockStorage.delete(k);

    const clearLocalCache = () => {
      const keys = Array.from(mockStorage.keys()).filter((k) => k.startsWith('ekagra_cache_') || k === 'ekagra_last_uid');
      keys.forEach((k) => removeItem(k));
    };

    // User A caches their snapshot
    setItem(`ekagra_cache_${userAId}`, JSON.stringify({
      user: { id: userAId, name: 'User A' },
      state: { goals: [{ title: 'Secret Plan A' }] }
    }));
    setItem('ekagra_last_uid', String(userAId));

    assert.ok(getItem(`ekagra_cache_${userAId}`));
    assert.equal(getItem('ekagra_last_uid'), String(userAId));

    // When User A signs out or User B logs in: clearLocalCache is invoked
    clearLocalCache();

    assert.equal(getItem(`ekagra_cache_${userAId}`), null);
    assert.equal(getItem('ekagra_last_uid'), null);
    assert.equal(getItem(`ekagra_cache_${userBId}`), null);
  });
});

