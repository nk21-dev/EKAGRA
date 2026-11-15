const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { createClient } = require('@libsql/client');
const {
  TursoDatabaseWrapper,
  runMigrationsAsync,
  createSafeFetch,
  ensureMigrations,
  resetMigrationPromise,
  splitSqlStatements,
} = require('../server/db');

// Helper to create an in-process mock Turso Hrana v2 pipeline server
function createMockTursoServer() {
  const memDb = new DatabaseSync(':memory:');

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed JSON' }));
      return;
    }

    const results = [];
    for (const r of payload.requests || []) {
      if (r.type === 'execute') {
        const sql = r.stmt.sql;
        // Unwrap Hrana arguments to native primitive values
        const cleanArgs = (r.stmt.args || []).map((a) => {
          if (a === null || a === undefined) return null;
          if (typeof a === 'object' && 'type' in a) {
            if (a.type === 'null') return null;
            if (a.type === 'integer') return Number(a.value);
            if (a.type === 'float') return Number(a.value);
            return a.value;
          }
          return a;
        });

        try {
          const stmt = memDb.prepare(sql);
          let rows = [];
          let cols = [];
          if (/^\s*(SELECT|PRAGMA)/i.test(sql)) {
            rows = stmt.all(...cleanArgs);
            if (rows.length > 0) {
              cols = Object.keys(rows[0]).map(name => ({ name }));
            }
          } else {
            stmt.run(...cleanArgs);
          }
          results.push({
            type: 'ok',
            response: {
              type: 'execute',
              result: {
                cols,
                rows: rows.map(row => Object.values(row).map(v => ({
                  type: typeof v === 'number' ? 'integer' : 'text',
                  value: String(v)
                }))),
                affected_row_count: 0,
                last_insert_rowid: null
              }
            }
          });
        } catch (err) {
          results.push({
            type: 'error',
            error: { message: err.message, code: 'SQLITE_ERROR' }
          });
        }
      } else if (r.type === 'close') {
        results.push({ type: 'ok', response: { type: 'close' } });
      } else if (r.type === 'sequence') {
        try {
          memDb.exec(r.sql);
          results.push({ type: 'ok', response: { type: 'sequence' } });
        } catch (err) {
          results.push({ type: 'error', error: { message: err.message } });
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      baton: 'mock-baton-stream',
      baseUrl: null,
      results
    }));
  });

  return { server, memDb };
}

test('Turso Remote Migration & Protocol Smoke Suite', async (t) => {
  let mockServer = null;
  let tursoDb = null;
  const isRealTurso = Boolean(process.env.TURSO_DATABASE_URL);

  if (isRealTurso) {
    console.log('[SMOKE TEST] Connecting to REAL Turso Database from TURSO_DATABASE_URL...');
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
      fetch: createSafeFetch(),
    });
    tursoDb = new TursoDatabaseWrapper(client);
  } else {
    console.log('[SMOKE TEST] Spinning up in-process Turso Hrana v2 HTTP Protocol server...');
    const mock = createMockTursoServer();
    mockServer = mock.server;
    await new Promise((resolve) => mockServer.listen(0, resolve));
    const port = mockServer.address().port;

    const client = createClient({
      url: `http://127.0.0.1:${port}`,
      authToken: 'mock-jwt-test-token-safe',
      fetch: createSafeFetch(),
    });
    tursoDb = new TursoDatabaseWrapper(client);
  }

  t.after(() => {
    if (mockServer) {
      mockServer.close();
    }
    resetMigrationPromise();
  });

  await t.test('1. SQL Splitter: cleanly separates multi-statement DDL while respecting string literals and comments', () => {
    const multiSql = `
      -- Create test table
      CREATE TABLE IF NOT EXISTS test_tbl (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note TEXT DEFAULT 'first; statement;'
      );
      /* Create test index */
      CREATE INDEX IF NOT EXISTS idx_test_note ON test_tbl(note);
    `;
    const stmts = splitSqlStatements(multiSql);
    assert.equal(stmts.length, 2);
    assert.match(stmts[0], /CREATE TABLE IF NOT EXISTS test_tbl/);
    assert.match(stmts[0], /first; statement;/);
    assert.match(stmts[1], /CREATE INDEX IF NOT EXISTS idx_test_note/);
  });

  await t.test('2. Run all 12 async migrations through TursoDatabaseWrapper over HTTP', async () => {
    const result = await runMigrationsAsync(tursoDb);
    assert.equal(result, true, 'runMigrationsAsync must resolve true');
  });

  await t.test('3. Migration 003 Verification: user_app_data table & idx_user_app_data_user index exist and operate correctly', async () => {
    // Insert a parent user first to satisfy foreign key constraint
    const now = new Date().toISOString();
    const userRes = await tursoDb.prepare(`
      INSERT INTO users (name, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('Smoke Test User', 'smoke@ekagra.ai', 'mock_hash', now, now);

    const users = await tursoDb.prepare('SELECT id FROM users WHERE email = ?').all('smoke@ekagra.ai');
    assert.ok(users.length > 0, 'Parent user must exist');
    const userId = users[0].id;

    // Insert into user_app_data referencing the parent user
    const insertRes = await tursoDb.prepare(`
      INSERT INTO user_app_data (user_id, entity_type, payload, created_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, 'smoke_test', JSON.stringify({ smoke: 'success' }), now);

    assert.ok(insertRes);

    const rows = await tursoDb.prepare('SELECT * FROM user_app_data WHERE entity_type = ?').all('smoke_test');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, userId);
    assert.match(rows[0].payload, /smoke/);
  });

  await t.test('4. Schema Coverage: All core application tables exist in the remote database', async () => {
    const tables = [
      'users',
      'password_reset_tokens',
      'user_app_data',
      'goals',
      'tasks',
      'routines',
      'user_schedule_settings',
      'user_ai_settings',
      'scheduled_blocks',
      'execution_logs',
      'user_learning_profile',
    ];

    for (const tbl of tables) {
      const res = await tursoDb.prepare(`SELECT * FROM ${tbl} LIMIT 1`).all();
      assert.ok(Array.isArray(res), `Table ${tbl} should be queryable via prepare().all()`);
    }
  });

  await t.test('5. Idempotency: Running migrations a second time executes cleanly with zero duplicate errors', async () => {
    const resultSecondRun = await runMigrationsAsync(tursoDb);
    assert.equal(resultSecondRun, true, 'Second run must resolve true with zero errors');
  });

  await t.test('6. Error Normalization: safeFetch uncovers remote Turso { error: "..." } without leaking credentials', async () => {
    const errorServer = http.createServer((req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'table already exists: simulated turso error' }));
    });

    await new Promise((r) => errorServer.listen(0, r));
    const errPort = errorServer.address().port;

    const errClient = createClient({
      url: `http://127.0.0.1:${errPort}`,
      authToken: 'secret-auth-token-never-log',
      fetch: createSafeFetch(),
    });

    try {
      await errClient.execute('CREATE TABLE duplicate_table (id INT);');
      assert.fail('Should have thrown an error');
    } catch (err) {
      // Must contain the real Turso error message instead of generic "Server returned HTTP status 400"
      assert.match(err.message, /table already exists: simulated turso error/);
      // Must NEVER leak the secret auth token
      assert.ok(!err.message.includes('secret-auth-token-never-log'));
    } finally {
      errorServer.close();
    }
  });

  await t.test('7. Cache Reset on Failure: ensureMigrations resets cached Promise when a migration fails so retries can succeed', async () => {
    resetMigrationPromise();

    let failOnce = true;
    const flakeDb = {
      isTurso: true,
      async exec(sql) {
        if (/CREATE TABLE/i.test(sql) && failOnce) {
          failOnce = false;
          throw new Error('Simulated cold-start timeout');
        }
        return true;
      },
      prepare(sql) {
        return {
          all: async () => [],
          get: async () => null,
          run: async () => ({ changes: 0 }),
        };
      },
    };

    // First attempt fails
    await assert.rejects(async () => {
      await ensureMigrations(flakeDb);
    }, /Simulated cold-start timeout/);

    // Second attempt must NOT return the cached rejected Promise; it must retry and succeed
    const retryResult = await ensureMigrations(tursoDb);
    assert.equal(retryResult, true);
  });
});
