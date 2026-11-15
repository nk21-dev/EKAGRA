const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { runMigrations, runMigrationsSync, runMigrationsAsync } = require('./migrations');

let dbInstance = null;
let migrationPromise = null;

/**
 * Safely splits a multi-statement SQL script into individual statements.
 * Preserves quotes, escaped quotes, line comments (--), and block comments.
 */
function splitSqlStatements(sql) {
  if (!sql || typeof sql !== 'string') return [];
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
        i++;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += char;
    }
  }

  const remainder = current.trim();
  if (remainder) {
    statements.push(remainder);
  }

  return statements;
}

/**
 * Safe fetch wrapper for @libsql/client that:
 * 1. Safely captures and logs underlying Turso HTTP error bodies without logging authorization tokens or credentials.
 * 2. Normalizes JSON error responses ({ error: '...' } -> message) so @libsql/hrana-client does not swallow
 *    the error behind an opaque "SERVER_ERROR: Server returned HTTP status 400".
 */
function createSafeFetch() {
  return async function safeFetch(input, init) {
    const res = await fetch(input, init);
    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const clone = res.clone();
          const json = await clone.json();
          const rawErr = (json && (json.error || json.message)) || null;
          if (rawErr) {
            const safeMsg = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
            console.error(`[Turso HTTP ${res.status}] Error details:`, safeMsg);
          }
          if (json && json.error && !json.message) {
            json.message = json.error;
            return new Response(JSON.stringify(json), {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers,
            });
          }
        } catch (e) {}
      } else if (contentType.includes('text/plain')) {
        try {
          const clone = res.clone();
          const text = (await clone.text()).trim();
          if (text) {
            console.error(`[Turso HTTP ${res.status}] Error details:`, text);
          }
        } catch (e) {}
      }
    }
    return res;
  };
}

class TursoDatabaseWrapper {
  constructor(client) {
    this.client = client;
    this.isTurso = true;
  }

  prepare(sql) {
    const client = this.client;
    return {
      async all(...args) {
        const flatArgs = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
        const cleanArgs = flatArgs.map((v) => (v === undefined ? null : v));
        const res = await client.execute({ sql, args: cleanArgs });
        return Array.from(res.rows);
      },
      async get(...args) {
        const flatArgs = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
        const cleanArgs = flatArgs.map((v) => (v === undefined ? null : v));
        const res = await client.execute({ sql, args: cleanArgs });
        return res.rows[0];
      },
      async run(...args) {
        const flatArgs = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
        const cleanArgs = flatArgs.map((v) => (v === undefined ? null : v));
        const res = await client.execute({ sql, args: cleanArgs });
        return {
          changes: res.rowsAffected,
          lastInsertRowid: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
        };
      },
    };
  }

  /**
   * Safe Turso-compatible migration execution strategy:
   * Splits multi-statement blocks and executes statements sequentially via client.execute(stmt).
   * This avoids remote Hrana sequence pipeline rejection (HTTP 400) and ensures table schema creation
   * commits before dependent indices are created.
   */
  async exec(sql) {
    if (!sql || typeof sql !== 'string') return;
    const statements = splitSqlStatements(sql);
    for (const stmt of statements) {
      if (!stmt) continue;
      // Skip unsupported/redundant journal_mode PRAGMA on Turso Cloud
      if (/^PRAGMA\s+journal_mode/i.test(stmt)) {
        continue;
      }
      try {
        await this.client.execute(stmt);
      } catch (err) {
        const safeSnippet = stmt.length > 80 ? stmt.slice(0, 80) + '...' : stmt;
        console.error(`[Turso Exec Error] Failed statement: "${safeSnippet}"`, err.message);
        throw err;
      }
    }
  }

  async execute(sql, args = []) {
    return await this.client.execute({ sql, args });
  }

  async batch(statements, mode = 'deferred') {
    return await this.client.batch(statements, mode);
  }

  all(sql, ...args) {
    return this.prepare(sql).all(...args);
  }

  get(sql, ...args) {
    return this.prepare(sql).get(...args);
  }

  run(sql, ...args) {
    return this.prepare(sql).run(...args);
  }
}

/**
 * Idempotently run database migrations once per process / cold start.
 * Resets cached Promise on error so retries are possible.
 */
function ensureMigrations(db) {
  if (!migrationPromise) {
    migrationPromise = Promise.resolve(runMigrations(db)).catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  return migrationPromise;
}

function resetMigrationPromise() {
  migrationPromise = null;
}

function getDatabase(customPath = null) {
  if (dbInstance && !customPath) {
    return dbInstance;
  }

  const tursoUrl = process.env.TURSO_DATABASE_URL || config.tursoDatabaseUrl;
  const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || config.tursoAuthToken;

  // Turso Cloud SQLite if TURSO_DATABASE_URL is set and no custom file path is explicitly requested
  if (!customPath && tursoUrl) {
    const { createClient } = require('@libsql/client');
    const client = createClient({
      url: tursoUrl,
      authToken: tursoAuthToken || undefined,
      fetch: createSafeFetch(),
    });
    const tursoWrapper = new TursoDatabaseWrapper(client);
    ensureMigrations(tursoWrapper);

    if (!customPath) {
      dbInstance = tursoWrapper;
    }
    return tursoWrapper;
  }

  // Local SQLite (file-based or in-memory)
  const dbFilePath = customPath || config.dbPath;

  if (dbFilePath !== ':memory:') {
    const dbDir = path.dirname(dbFilePath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbFilePath);
  runMigrations(db);

  // Attach convenience helpers for async/sync polymorphism
  if (!db.all) {
    db.all = (sql, ...args) => db.prepare(sql).all(...args);
  }
  if (!db.get) {
    db.get = (sql, ...args) => db.prepare(sql).get(...args);
  }
  if (!db.run) {
    db.run = (sql, ...args) => db.prepare(sql).run(...args);
  }

  if (!customPath) {
    dbInstance = db;
    // Cache resolved migration promise for cold-start middleware
    migrationPromise = Promise.resolve(true);
  }

  return db;
}

module.exports = {
  getDatabase,
  ensureMigrations,
  resetMigrationPromise,
  splitSqlStatements,
  createSafeFetch,
  TursoDatabaseWrapper,
  runMigrations,
  runMigrationsSync,
  runMigrationsAsync,
};
