const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { runMigrations, runMigrationsSync, runMigrationsAsync } = require('./migrations');

let dbInstance = null;
let migrationPromise = null;

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

  async exec(sql) {
    return await this.client.executeMultiple(sql);
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
 * Idempotently run database migrations once per process / cold start
 */
function ensureMigrations(db) {
  if (!migrationPromise) {
    migrationPromise = Promise.resolve(runMigrations(db));
  }
  return migrationPromise;
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
  TursoDatabaseWrapper,
  runMigrations,
  runMigrationsSync,
  runMigrationsAsync,
};
