const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../server/db/migrations');
const {
  getDayGroupForDate,
  getFreeIntervalsForDate,
  findNextAvailableSlot,
  generateSchedule,
  rescheduleTask,
  completeScheduledTask
} = require('../server/services/schedulingEngine');

describe('Scheduler Collision & Deduplication Tests', () => {
  let db;
  const testUserId = 999;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);

    const now = new Date().toISOString();
    // Insert test user
    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
      VALUES (?, 'Test User', 'test@ekagra.app', 'dummy_hash', ?, ?)
    `).run(testUserId, now, now);

    // Setup User Schedule Settings with Sunday as weekend
    db.prepare(`
      INSERT OR REPLACE INTO user_schedule_settings (user_id, weekdays_days, weekends_days, created_at, updated_at)
      VALUES (?, '["Monday","Tuesday","Wednesday","Thursday","Friday"]', '["Saturday","Sunday"]', ?, ?)
    `).run(testUserId, now, now);

    // Insert exact routine structure similar to User 662 on weekends
    const routines = [
      { name: 'Sleep / Rest', s: '07:00', e: '08:00', type: 'busy' },
      { name: 'College', s: '08:00', e: '15:00', type: 'busy' },
      { name: 'Travel', s: '15:00', e: '15:05', type: 'busy' },
      { name: 'travel', s: '15:05', e: '16:00', type: 'busy' },
      { name: 'rest', s: '16:00', e: '16:30', type: 'busy' },
      { name: 'gym', s: '16:30', e: '17:00', type: 'busy' },
      { name: 'study', s: '17:00', e: '19:00', type: 'flexible' },
      { name: 'dinner', s: '19:00', e: '20:00', type: 'flexible' },
      { name: 'study', s: '20:00', e: '23:00', type: 'flexible' },
      { name: 'Sleep', s: '23:00', e: '07:00', type: 'busy' }
    ];

    for (const r of routines) {
      db.prepare(`
        INSERT INTO routines (id, user_id, name, start_time, end_time, availability_type, schedule_group, days, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'weekends', '["Saturday","Sunday"]', ?, ?)
      `).run(`rt-${Date.now()}-${Math.random()}`, testUserId, r.name, r.s, r.e, r.type, now, now);
    }
  });

  test('1. Free routine intervals strictly exclude fixed commitments and overnight sleep', () => {
    // 2026-11-15 is Sunday (weekend)
    const sundayDate = '2026-11-15';
    const group = getDayGroupForDate(db, testUserId, sundayDate);
    assert.equal(group, 'weekends');

    const free = getFreeIntervalsForDate(db, testUserId, sundayDate);
    // Free windows should ONLY be 17:00 (1020m) to 23:00 (1380m)
    assert.equal(free.length, 1);
    assert.equal(free[0].start, 1020); // 17:00
    assert.equal(free[0].end, 1380);   // 23:00

    // Verify 15:00 - 15:30 is NOT included
    const has1500 = free.some((slot) => Math.max(slot.start, 900) < Math.min(slot.end, 930));
    assert.equal(has1500, false);
  });

  test('2. Sequential placement places multiple tasks non-overlapping inside 17:00-23:00', () => {
    const sundayDate = '2026-11-15';
    const now = new Date().toISOString();

    // Create 3 tasks: 30m, 45m, 60m
    const t1 = 't-test-1';
    const t2 = 't-test-2';
    const t3 = 't-test-3';

    db.prepare(`
      INSERT INTO tasks (id, user_id, title, duration_minutes, priority, completed, created_at, updated_at)
      VALUES (?, ?, 'Task 1', 30, 'High', 0, ?, ?),
             (?, ?, 'Task 2', 45, 'Medium', 0, ?, ?),
             (?, ?, 'Task 3', 60, 'Low', 0, ?, ?)
    `).run(t1, testUserId, now, now, t2, testUserId, now, now, t3, testUserId, now, now);

    const result = generateSchedule(db, testUserId, { startDate: sundayDate, daysAhead: 1 });
    assert.equal(result.success, true);
    assert.equal(result.scheduled_count, 3);

    const blocks = db.prepare(`
      SELECT * FROM scheduled_blocks
      WHERE user_id = ? AND scheduled_date = ?
      ORDER BY start_time ASC
    `).all(testUserId, sundayDate);

    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].start_time, '17:00');
    assert.equal(blocks[0].end_time, '17:30');
    assert.equal(blocks[1].start_time, '17:30');
    assert.equal(blocks[1].end_time, '18:15');
    assert.equal(blocks[2].start_time, '18:15');
    assert.equal(blocks[2].end_time, '19:15');

    // Verify zero overlap with fixed routines or between each other
    for (let i = 0; i < blocks.length; i++) {
      assert.ok(blocks[i].start_time >= '17:00');
      assert.ok(blocks[i].end_time <= '23:00');
      if (i > 0) {
        assert.ok(blocks[i].start_time >= blocks[i - 1].end_time);
      }
    }
  });

  test('3. Calling generateSchedule multiple times is idempotent and creates 0 duplicate blocks', () => {
    const sundayDate = '2026-11-15';
    const now = new Date().toISOString();
    const t1 = 't-idem-1';

    db.prepare(`
      INSERT INTO tasks (id, user_id, title, duration_minutes, priority, completed, created_at, updated_at)
      VALUES (?, ?, 'Idempotent Task', 30, 'High', 0, ?, ?)
    `).run(t1, testUserId, now, now);

    const run1 = generateSchedule(db, testUserId, { startDate: sundayDate, daysAhead: 1 });
    assert.equal(run1.scheduled_count, 1);

    const run2 = generateSchedule(db, testUserId, { startDate: sundayDate, daysAhead: 1 });
    assert.equal(run2.scheduled_count, 0);

    const blocks = db.prepare('SELECT * FROM scheduled_blocks WHERE user_id = ? AND task_id = ?').all(testUserId, t1);
    assert.equal(blocks.length, 1);
  });

  test('4. Rescheduling finds next strictly later non-overlapping slot without hardcoded 15:00', () => {
    const sundayDate = '2026-11-15';
    const now = new Date().toISOString();
    const t1 = 't-resched-1';

    db.prepare(`
      INSERT INTO tasks (id, user_id, title, duration_minutes, priority, completed, created_at, updated_at)
      VALUES (?, ?, 'Reschedulable Task', 30, 'High', 0, ?, ?)
    `).run(t1, testUserId, now, now);

    // Initial placement at 17:00 - 17:30
    generateSchedule(db, testUserId, { startDate: sundayDate, daysAhead: 1 });

    const initialBlock = db.prepare('SELECT * FROM scheduled_blocks WHERE user_id = ? AND task_id = ?').get(testUserId, t1);
    assert.equal(initialBlock.start_time, '17:00');
    assert.equal(initialBlock.end_time, '17:30');

    // Auto-reschedule without specifying newDate/newStartTime
    const reschedResult = rescheduleTask(db, testUserId, t1);
    assert.equal(reschedResult.success, true);
    // The next available slot on Sunday 2026-11-15 must start strictly at or after 17:30
    assert.equal(reschedResult.scheduled_date, sundayDate);
    assert.equal(reschedResult.start_time, '17:30');
    assert.equal(reschedResult.end_time, '18:00');

    // Check scheduled_blocks state: exactly 1 active 'scheduled' block
    const activeBlocks = db.prepare("SELECT * FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'scheduled'").all(testUserId, t1);
    assert.equal(activeBlocks.length, 1);
    assert.equal(activeBlocks[0].start_time, '17:30');

    // Attempting to manually reschedule into fixed travel slot 15:00 - 15:30 throws collision error
    assert.throws(() => {
      rescheduleTask(db, testUserId, t1, sundayDate, '15:00');
    }, /Cannot reschedule into a fixed routine commitment/i);
  });

  test('5. Completing a task marks all its blocks completed and leaves 0 active blocks', () => {
    const sundayDate = '2026-11-15';
    const now = new Date().toISOString();
    const t1 = 't-complete-1';

    db.prepare(`
      INSERT INTO tasks (id, user_id, title, duration_minutes, priority, completed, created_at, updated_at)
      VALUES (?, ?, 'Completable Task', 30, 'High', 0, ?, ?)
    `).run(t1, testUserId, now, now);

    generateSchedule(db, testUserId, { startDate: sundayDate, daysAhead: 1 });

    const activeBefore = db.prepare("SELECT * FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'scheduled'").all(testUserId, t1);
    assert.equal(activeBefore.length, 1);

    // Complete task
    const compResult = completeScheduledTask(db, testUserId, t1);
    assert.equal(compResult.success, true);

    const taskInDb = db.prepare('SELECT completed FROM tasks WHERE id = ?').get(t1);
    assert.equal(taskInDb.completed, 1);

    const activeAfter = db.prepare("SELECT * FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'scheduled'").all(testUserId, t1);
    assert.equal(activeAfter.length, 0);

    const completedBlocks = db.prepare("SELECT * FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'completed'").all(testUserId, t1);
    assert.equal(completedBlocks.length, 1);

    // Cannot reschedule an already completed task
    assert.throws(() => {
      rescheduleTask(db, testUserId, t1);
    }, /Cannot reschedule an already completed task/);
  });
});
