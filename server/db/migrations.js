const fs = require('node:fs');
const path = require('node:path');

function runMigrationsSync(db) {
  // Ensure Foreign Keys are strictly enforced in SQLite
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  // Migration 001: Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // Migration 002: Password reset tokens table
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
  `);

  // Migration 003: User application data isolation registry
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_app_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_app_data_user ON user_app_data(user_id);
  `);

  // Migration 004: Dedicated Goals table (Zero Category, Strict User Isolation)
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'Medium',
      target_date TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
  `);

  // Data migration: if existing dashboard_state contains goals
  try {
    const rows = db.prepare("SELECT id, user_id, payload FROM user_app_data WHERE entity_type = 'dashboard_state'").all();
    for (const row of rows) {
      if (!row.payload) continue;
      try {
        const state = JSON.parse(row.payload);
        let payloadChanged = false;
        if (Array.isArray(state.goals) && state.goals.length > 0) {
          for (const g of state.goals) {
            const goalId = g.id || `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const title = g.title || g.name || 'Untitled Goal';
            const desc = g.description || '';
            const priority = g.priority || 'Medium';
            const targetDate = g.target_date || g.deadline || 'Dec 31, 2026';
            const progress = Number(g.progress) || 0;
            const now = new Date().toISOString();

            const existingInDb = db.prepare('SELECT id FROM goals WHERE id = ?').get(goalId);
            if (!existingInDb) {
              db.prepare(`
                INSERT INTO goals (id, user_id, title, description, priority, target_date, progress, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(goalId, row.user_id, title, desc, priority, targetDate, progress, g.created_at || now, g.updated_at || now);
            }
          }
          state.goals = state.goals.map(({ category, categoryIcon, ...rest }) => rest);
          payloadChanged = true;
        }
        if (payloadChanged) {
          db.prepare('UPDATE user_app_data SET payload = ? WHERE id = ?').run(JSON.stringify(state), row.id);
        }
      } catch (err) {
        console.error('[Migration 004 Data Error]', err);
      }
    }
  } catch (err) {}

  // Migration 005: Tasks table for task-derived goal progress and execution
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      goal_id TEXT DEFAULT NULL,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'Medium',
      time_slot TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
  `);

  // Migration 006: Routines table & extended task metadata
  try {
    const taskCols = db.prepare("PRAGMA table_info('tasks')").all().map((c) => c.name);
    if (!taskCols.includes('description')) {
      db.exec("ALTER TABLE tasks ADD COLUMN description TEXT DEFAULT ''");
    }
    if (!taskCols.includes('duration_minutes')) {
      db.exec("ALTER TABLE tasks ADD COLUMN duration_minutes INTEGER DEFAULT NULL");
    }
    if (!taskCols.includes('due_date')) {
      db.exec("ALTER TABLE tasks ADD COLUMN due_date TEXT DEFAULT NULL");
    }
  } catch (err) {
    console.error('[Migration 006 Task Schema Error]', err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      days TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Fixed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);
  `);

  // Migration 007: Schedule Settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_schedule_settings (
      user_id INTEGER PRIMARY KEY,
      weekdays_days TEXT NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]',
      weekends_days TEXT NOT NULL DEFAULT '["Saturday","Sunday"]',
      routine_setup_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  try {
    const routineCols = db.prepare("PRAGMA table_info('routines')").all().map((c) => c.name);
    if (!routineCols.includes('schedule_group')) {
      db.exec("ALTER TABLE routines ADD COLUMN schedule_group TEXT DEFAULT 'weekdays'");
    }
  } catch (err) {
    console.error('[Migration 007 Routine Schema Error]', err);
  }

  try {
    const usersWithRoutines = db.prepare('SELECT DISTINCT user_id FROM routines').all().map((r) => r.user_id);
    const usersWithGoals = db.prepare('SELECT DISTINCT user_id FROM goals').all().map((g) => g.user_id);
    const completedUserIds = new Set([...usersWithRoutines, ...usersWithGoals]);

    const now = new Date().toISOString();
    for (const uid of completedUserIds) {
      db.prepare(`
        INSERT OR IGNORE INTO user_schedule_settings (user_id, weekdays_days, weekends_days, routine_setup_status, created_at, updated_at)
        VALUES (?, '["Monday","Tuesday","Wednesday","Thursday","Friday"]', '["Saturday","Sunday"]', 'completed', ?, ?)
      `).run(uid, now, now);
    }

    const existingRoutines = db.prepare("SELECT id, days FROM routines WHERE schedule_group = 'weekdays'").all();
    for (const r of existingRoutines) {
      try {
        let days = JSON.parse(r.days);
        if (Array.isArray(days)) {
          const hasWeekday = days.some((d) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(d));
          const hasWeekend = days.some((d) => ['Saturday', 'Sunday'].includes(d));
          if (!hasWeekday && hasWeekend) {
            db.prepare("UPDATE routines SET schedule_group = 'weekends' WHERE id = ?").run(r.id);
          }
        }
      } catch (e) {}
    }
  } catch (err) {
    console.error('[Migration 007 Backfill Error]', err);
  }

  // Migration 008: Additive routine metadata
  try {
    const routineCols = db.prepare("PRAGMA table_info('routines')").all().map((c) => c.name);
    if (!routineCols.includes('activity_classification')) {
      db.exec("ALTER TABLE routines ADD COLUMN activity_classification TEXT DEFAULT ''");
    }
    if (!routineCols.includes('availability_type')) {
      db.exec("ALTER TABLE routines ADD COLUMN availability_type TEXT DEFAULT 'busy'");
    }
    if (!routineCols.includes('is_reviewed')) {
      db.exec("ALTER TABLE routines ADD COLUMN is_reviewed INTEGER DEFAULT 1");
    }
  } catch (err) {
    console.error('[Migration 008 Routine Schema Error]', err);
  }

  // Migration 009: User AI Provider & Estimation Settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_ai_settings (
      user_id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'default',
      provider TEXT NOT NULL DEFAULT 'gemini',
      encrypted_api_key TEXT DEFAULT NULL,
      key_hint TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_ai_settings_user ON user_ai_settings(user_id);
  `);

  // Migration 010: Execution History, Priority Scheduling, and Online Adaptive Learning Profile
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_blocks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      goal_id TEXT DEFAULT NULL,
      scheduled_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      allocated_minutes INTEGER NOT NULL,
      time_bucket TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_user_date ON scheduled_blocks(user_id, scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_task ON scheduled_blocks(task_id);

    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      goal_id TEXT DEFAULT NULL,
      goal_priority TEXT DEFAULT 'Medium',
      task_priority TEXT DEFAULT 'Medium',
      estimated_minutes INTEGER NOT NULL DEFAULT 0,
      actual_minutes INTEGER NOT NULL DEFAULT 0,
      duration_verified INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL,
      time_bucket TEXT NOT NULL,
      day_type TEXT NOT NULL,
      logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_execution_logs_user_date ON execution_logs(user_id, logged_at);
    CREATE INDEX IF NOT EXISTS idx_execution_logs_task ON execution_logs(task_id);

    CREATE TABLE IF NOT EXISTS user_learning_profile (
      user_id INTEGER PRIMARY KEY,
      pace_factor REAL NOT NULL DEFAULT 1.0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      calibrated_count INTEGER NOT NULL DEFAULT 0,
      alpha_morning REAL NOT NULL DEFAULT 2.0,
      beta_morning REAL NOT NULL DEFAULT 2.0,
      alpha_afternoon REAL NOT NULL DEFAULT 2.0,
      beta_afternoon REAL NOT NULL DEFAULT 2.0,
      alpha_evening REAL NOT NULL DEFAULT 2.0,
      beta_evening REAL NOT NULL DEFAULT 2.0,
      alpha_night REAL NOT NULL DEFAULT 2.0,
      beta_night REAL NOT NULL DEFAULT 2.0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  try {
    const sbCols = db.prepare("PRAGMA table_info('scheduled_blocks')").all().map((c) => c.name);
    if (!sbCols.includes('time_bucket')) {
      db.exec("ALTER TABLE scheduled_blocks ADD COLUMN time_bucket TEXT DEFAULT 'morning'");
    }
    if (!sbCols.includes('updated_at')) {
      db.exec("ALTER TABLE scheduled_blocks ADD COLUMN updated_at TEXT DEFAULT NULL");
    }
  } catch (err) {}

  try {
    const profCols = db.prepare("PRAGMA table_info('user_learning_profile')").all().map((c) => c.name);
    if (!profCols.includes('pace_factor')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN pace_factor REAL DEFAULT 1.0");
    }
    if (!profCols.includes('completed_count')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN completed_count INTEGER DEFAULT 0");
    }
    if (!profCols.includes('alpha_morning')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_morning REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_morning')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_morning REAL DEFAULT 2.0");
    }
    if (!profCols.includes('alpha_afternoon')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_afternoon REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_afternoon')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_afternoon REAL DEFAULT 2.0");
    }
    if (!profCols.includes('alpha_evening')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_evening REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_evening')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_evening REAL DEFAULT 2.0");
    }
    if (!profCols.includes('alpha_night')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_night REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_night')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_night REAL DEFAULT 2.0");
    }
    if (!profCols.includes('calibrated_count')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN calibrated_count INTEGER DEFAULT 0");
    }
  } catch (err) {}

  // Migration 011: Verified Task Duration Check-In & Calibration Counter
  try {
    const elCols = db.prepare("PRAGMA table_info('execution_logs')").all().map((c) => c.name);
    if (!elCols.includes('duration_verified')) {
      db.exec("ALTER TABLE execution_logs ADD COLUMN duration_verified INTEGER DEFAULT 0");
    }
  } catch (err) {
    console.error('[Migration 011 execution_logs error]', err);
  }

  try {
    const profCols = db.prepare("PRAGMA table_info('user_learning_profile')").all().map((c) => c.name);
    if (!profCols.includes('calibrated_count')) {
      db.exec("ALTER TABLE user_learning_profile ADD COLUMN calibrated_count INTEGER DEFAULT 0");
    }
  } catch (err) {
    console.error('[Migration 011 user_learning_profile error]', err);
  }

  // Migration 012: Deduplicate scheduled blocks and cleanup stale/completed blocks
  try {
    db.prepare(`
      UPDATE scheduled_blocks 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
      WHERE status = 'scheduled' 
      AND task_id IN (SELECT id FROM tasks WHERE completed = 1)
    `).run();

    db.prepare(`DELETE FROM scheduled_blocks WHERE status = 'rescheduled'`).run();

    db.prepare(`
      DELETE FROM scheduled_blocks 
      WHERE status = 'completed'
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id, scheduled_date ORDER BY created_at DESC) as rn 
          FROM scheduled_blocks 
          WHERE status = 'completed'
        ) WHERE rn = 1
      )
    `).run();

    db.prepare(`
      DELETE FROM scheduled_blocks 
      WHERE status = 'scheduled'
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC) as rn 
          FROM scheduled_blocks 
          WHERE status = 'scheduled'
        ) WHERE rn = 1
      )
    `).run();
  } catch (err) {
    console.error('[Migration 012 deduplicate scheduled blocks error]', err);
  }

  return true;
}

async function runMigrationsAsync(db) {
  // Ensure Foreign Keys are strictly enforced in SQLite / Turso
  await db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

  // Migration 001: Users table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // Migration 002: Password reset tokens table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
  `);

  // Migration 003: User application data isolation registry
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_app_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_app_data_user ON user_app_data(user_id);
  `);

  // Migration 004: Dedicated Goals table (Zero Category, Strict User Isolation)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      priority TEXT DEFAULT 'Medium',
      target_date TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
  `);

  // Data migration: if existing dashboard_state contains goals
  try {
    const rows = await db.prepare("SELECT id, user_id, payload FROM user_app_data WHERE entity_type = 'dashboard_state'").all();
    for (const row of rows) {
      if (!row.payload) continue;
      try {
        const state = JSON.parse(row.payload);
        let payloadChanged = false;
        if (Array.isArray(state.goals) && state.goals.length > 0) {
          for (const g of state.goals) {
            const goalId = g.id || `g-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const title = g.title || g.name || 'Untitled Goal';
            const desc = g.description || '';
            const priority = g.priority || 'Medium';
            const targetDate = g.target_date || g.deadline || 'Dec 31, 2026';
            const progress = Number(g.progress) || 0;
            const now = new Date().toISOString();

            const existingInDb = await db.prepare('SELECT id FROM goals WHERE id = ?').get(goalId);
            if (!existingInDb) {
              await db.prepare(`
                INSERT INTO goals (id, user_id, title, description, priority, target_date, progress, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(goalId, row.user_id, title, desc, priority, targetDate, progress, g.created_at || now, g.updated_at || now);
            }
          }
          state.goals = state.goals.map(({ category, categoryIcon, ...rest }) => rest);
          payloadChanged = true;
        }
        if (payloadChanged) {
          await db.prepare('UPDATE user_app_data SET payload = ? WHERE id = ?').run(JSON.stringify(state), row.id);
        }
      } catch (err) {
        console.error('[Migration 004 Data Error]', err);
      }
    }
  } catch (err) {}

  // Migration 005: Tasks table for task-derived goal progress and execution
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      goal_id TEXT DEFAULT NULL,
      title TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'Medium',
      time_slot TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
  `);

  // Migration 006: Routines table & extended task metadata
  try {
    const taskCols = (await db.prepare("PRAGMA table_info('tasks')").all()).map((c) => c.name);
    if (!taskCols.includes('description')) {
      await db.exec("ALTER TABLE tasks ADD COLUMN description TEXT DEFAULT ''");
    }
    if (!taskCols.includes('duration_minutes')) {
      await db.exec("ALTER TABLE tasks ADD COLUMN duration_minutes INTEGER DEFAULT NULL");
    }
    if (!taskCols.includes('due_date')) {
      await db.exec("ALTER TABLE tasks ADD COLUMN due_date TEXT DEFAULT NULL");
    }
  } catch (err) {
    console.error('[Migration 006 Task Schema Error]', err);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      days TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Fixed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);
  `);

  // Migration 007: Schedule Settings
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_schedule_settings (
      user_id INTEGER PRIMARY KEY,
      weekdays_days TEXT NOT NULL DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]',
      weekends_days TEXT NOT NULL DEFAULT '["Saturday","Sunday"]',
      routine_setup_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  try {
    const routineCols = (await db.prepare("PRAGMA table_info('routines')").all()).map((c) => c.name);
    if (!routineCols.includes('schedule_group')) {
      await db.exec("ALTER TABLE routines ADD COLUMN schedule_group TEXT DEFAULT 'weekdays'");
    }
  } catch (err) {
    console.error('[Migration 007 Routine Schema Error]', err);
  }

  try {
    const usersWithRoutines = (await db.prepare('SELECT DISTINCT user_id FROM routines').all()).map((r) => r.user_id);
    const usersWithGoals = (await db.prepare('SELECT DISTINCT user_id FROM goals').all()).map((g) => g.user_id);
    const completedUserIds = new Set([...usersWithRoutines, ...usersWithGoals]);

    const now = new Date().toISOString();
    for (const uid of completedUserIds) {
      await db.prepare(`
        INSERT OR IGNORE INTO user_schedule_settings (user_id, weekdays_days, weekends_days, routine_setup_status, created_at, updated_at)
        VALUES (?, '["Monday","Tuesday","Wednesday","Thursday","Friday"]', '["Saturday","Sunday"]', 'completed', ?, ?)
      `).run(uid, now, now);
    }

    const existingRoutines = await db.prepare("SELECT id, days FROM routines WHERE schedule_group = 'weekdays'").all();
    for (const r of existingRoutines) {
      try {
        let days = JSON.parse(r.days);
        if (Array.isArray(days)) {
          const hasWeekday = days.some((d) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(d));
          const hasWeekend = days.some((d) => ['Saturday', 'Sunday'].includes(d));
          if (!hasWeekday && hasWeekend) {
            await db.prepare("UPDATE routines SET schedule_group = 'weekends' WHERE id = ?").run(r.id);
          }
        }
      } catch (e) {}
    }
  } catch (err) {
    console.error('[Migration 007 Backfill Error]', err);
  }

  // Migration 008: Additive routine metadata
  try {
    const routineCols = (await db.prepare("PRAGMA table_info('routines')").all()).map((c) => c.name);
    if (!routineCols.includes('activity_classification')) {
      await db.exec("ALTER TABLE routines ADD COLUMN activity_classification TEXT DEFAULT ''");
    }
    if (!routineCols.includes('availability_type')) {
      await db.exec("ALTER TABLE routines ADD COLUMN availability_type TEXT DEFAULT 'busy'");
    }
    if (!routineCols.includes('is_reviewed')) {
      await db.exec("ALTER TABLE routines ADD COLUMN is_reviewed INTEGER DEFAULT 1");
    }
  } catch (err) {
    console.error('[Migration 008 Routine Schema Error]', err);
  }

  // Migration 009: User AI Provider & Estimation Settings
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_ai_settings (
      user_id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'default',
      provider TEXT NOT NULL DEFAULT 'gemini',
      encrypted_api_key TEXT DEFAULT NULL,
      key_hint TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_ai_settings_user ON user_ai_settings(user_id);
  `);

  // Migration 010: Execution History, Priority Scheduling, and Online Adaptive Learning Profile
  await db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_blocks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      goal_id TEXT DEFAULT NULL,
      scheduled_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      allocated_minutes INTEGER NOT NULL,
      time_bucket TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_user_date ON scheduled_blocks(user_id, scheduled_date);
    CREATE INDEX IF NOT EXISTS idx_scheduled_blocks_task ON scheduled_blocks(task_id);

    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      goal_id TEXT DEFAULT NULL,
      goal_priority TEXT DEFAULT 'Medium',
      task_priority TEXT DEFAULT 'Medium',
      estimated_minutes INTEGER NOT NULL DEFAULT 0,
      actual_minutes INTEGER NOT NULL DEFAULT 0,
      duration_verified INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL,
      time_bucket TEXT NOT NULL,
      day_type TEXT NOT NULL,
      logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_execution_logs_user_date ON execution_logs(user_id, logged_at);
    CREATE INDEX IF NOT EXISTS idx_execution_logs_task ON execution_logs(task_id);

    CREATE TABLE IF NOT EXISTS user_learning_profile (
      user_id INTEGER PRIMARY KEY,
      pace_factor REAL NOT NULL DEFAULT 1.0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      calibrated_count INTEGER NOT NULL DEFAULT 0,
      alpha_morning REAL NOT NULL DEFAULT 2.0,
      beta_morning REAL NOT NULL DEFAULT 2.0,
      alpha_afternoon REAL NOT NULL DEFAULT 2.0,
      beta_afternoon REAL NOT NULL DEFAULT 2.0,
      alpha_evening REAL NOT NULL DEFAULT 2.0,
      beta_evening REAL NOT NULL DEFAULT 2.0,
      alpha_night REAL NOT NULL DEFAULT 2.0,
      beta_night REAL NOT NULL DEFAULT 2.0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  try {
    const sbCols = (await db.prepare("PRAGMA table_info('scheduled_blocks')").all()).map((c) => c.name);
    if (!sbCols.includes('time_bucket')) {
      await db.exec("ALTER TABLE scheduled_blocks ADD COLUMN time_bucket TEXT DEFAULT 'morning'");
    }
    if (!sbCols.includes('updated_at')) {
      await db.exec("ALTER TABLE scheduled_blocks ADD COLUMN updated_at TEXT DEFAULT NULL");
    }
  } catch (err) {}

  try {
    const profCols = (await db.prepare("PRAGMA table_info('user_learning_profile')").all()).map((c) => c.name);
    if (!profCols.includes('pace_factor')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN pace_factor REAL DEFAULT 1.0");
    }
    if (!profCols.includes('completed_count')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN completed_count INTEGER DEFAULT 0");
    }
    if (!profCols.includes('alpha_morning')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_morning REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_morning')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_morning REAL DEFAULT 2.0");
    }
    if (!profCols.includes('alpha_afternoon')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_afternoon REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_afternoon')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_afternoon REAL DEFAULT 2.0");
    }
    if (!profCols.includes('alpha_evening')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_evening REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_evening')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_evening REAL DEFAULT 2.0");
    }
    if (!profCols.includes('alpha_night')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN alpha_night REAL DEFAULT 2.0");
    }
    if (!profCols.includes('beta_night')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN beta_night REAL DEFAULT 2.0");
    }
    if (!profCols.includes('calibrated_count')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN calibrated_count INTEGER DEFAULT 0");
    }
  } catch (err) {}

  // Migration 011: Verified Task Duration Check-In & Calibration Counter
  try {
    const elCols = (await db.prepare("PRAGMA table_info('execution_logs')").all()).map((c) => c.name);
    if (!elCols.includes('duration_verified')) {
      await db.exec("ALTER TABLE execution_logs ADD COLUMN duration_verified INTEGER DEFAULT 0");
    }
  } catch (err) {
    console.error('[Migration 011 execution_logs error]', err);
  }

  try {
    const profCols = (await db.prepare("PRAGMA table_info('user_learning_profile')").all()).map((c) => c.name);
    if (!profCols.includes('calibrated_count')) {
      await db.exec("ALTER TABLE user_learning_profile ADD COLUMN calibrated_count INTEGER DEFAULT 0");
    }
  } catch (err) {
    console.error('[Migration 011 user_learning_profile error]', err);
  }

  // Migration 012: Deduplicate scheduled blocks and cleanup stale/completed blocks
  try {
    await db.prepare(`
      UPDATE scheduled_blocks 
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
      WHERE status = 'scheduled' 
      AND task_id IN (SELECT id FROM tasks WHERE completed = 1)
    `).run();

    await db.prepare("DELETE FROM scheduled_blocks WHERE status = 'rescheduled'").run();

    await db.prepare(`
      DELETE FROM scheduled_blocks 
      WHERE status = 'completed'
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id, scheduled_date ORDER BY created_at DESC) as rn 
          FROM scheduled_blocks 
          WHERE status = 'completed'
        ) WHERE rn = 1
      )
    `).run();

    await db.prepare(`
      DELETE FROM scheduled_blocks 
      WHERE status = 'scheduled'
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC) as rn 
          FROM scheduled_blocks 
          WHERE status = 'scheduled'
        ) WHERE rn = 1
      )
    `).run();
  } catch (err) {
    console.error('[Migration 012 deduplicate scheduled blocks error]', err);
  }

  return true;
}

function runMigrations(db) {
  if (db && db.isTurso) {
    return runMigrationsAsync(db);
  }
  return runMigrationsSync(db);
}

module.exports = {
  runMigrations,
  runMigrationsSync,
  runMigrationsAsync
};
