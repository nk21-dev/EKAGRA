const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const app = require('../server');
const { getDatabase } = require('../server/db');
const { getRoutineCoverageStatus } = require('../server/services/routineService');

test('EKAGRA UI & Scheduling Synchronization Suite', async (t) => {
  let server;
  let baseUrl;
  let userACookie;
  let userBCookie;
  let userAId;
  let userBId;
  const db = getDatabase();

  const timestamp = Date.now();
  const userAEmail = `sync_user_a_${timestamp}@ekagra.ai`;
  const userBEmail = `sync_user_b_${timestamp}@ekagra.ai`;
  const password = 'Password123!';

  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // Step 0: Register Users
  await t.test('0. Setup: Register User A and User B', async () => {
    const resA = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User A Sync', email: userAEmail, password, confirmPassword: password })
    });
    assert.equal(resA.status, 201);
    const cookieA = resA.headers.get('set-cookie');
    userACookie = cookieA ? cookieA.split(';')[0] : '';
    const dataA = await resA.json();
    userAId = dataA.user.id;

    const resB = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User B Sync', email: userBEmail, password, confirmPassword: password })
    });
    assert.equal(resB.status, 201);
    const cookieB = resB.headers.get('set-cookie');
    userBCookie = cookieB ? cookieB.split(';')[0] : '';
    const dataB = await resB.json();
    userBId = dataB.user.id;
  });

  await t.test('1. Static File Verification: Dashboard HTML & JS have all required elements and zero fake stats', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/views/dashboard.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

    // 1. Banner element & text container
    assert.ok(html.includes('id="globalRoutineIncompleteBanner"'), 'Must have global routine banner');
    assert.ok(html.includes('id="globalRoutineBannerText"'), 'Must have global routine banner text element');

    // 2. Auto-schedule button on dashboard home
    assert.ok(html.includes('id="homeAutoScheduleBtn"'), 'Must have homeAutoScheduleBtn');
    assert.ok(html.includes('⚡ Auto-Schedule Today'), 'Must have ⚡ Auto-Schedule Today button text');

    // 3. Copy weekdays to weekends buttons
    assert.ok(html.includes('id="btnCopyWeekdaysToWeekends"'), 'Must have copy weekdays button in routines view');
    assert.ok(html.includes('copyWeekdaysToWeekendsInModal()'), 'Must have copy weekdays button in initial routine modal');

    // 4. Fake stats removed from insights
    assert.ok(!html.includes('>+12%</span>'), 'Fake +12% chip must be removed');
    assert.ok(!html.includes('>+15%</span>'), 'Fake +15% chip must be removed');

    // 5. Real task breakdown legend
    assert.ok(html.includes('<span>Completed</span>'), 'Legend must include Completed');
    assert.ok(html.includes('<span>Scheduled</span>'), 'Legend must include Scheduled');
    assert.ok(html.includes('<span>Missed</span>'), 'Legend must include Missed');
    assert.ok(html.includes('<span>Unscheduled</span>'), 'Legend must include Unscheduled');

    // 6. JS functions defined
    assert.ok(js.includes('window.updateGlobalRoutineBanner'), 'Must define window.updateGlobalRoutineBanner');
    assert.ok(js.includes('window.copyWeekdaysToWeekends'), 'Must define window.copyWeekdaysToWeekends');
    assert.ok(js.includes('window.handleHomeCompleteNextTask'), 'Must define window.handleHomeCompleteNextTask');
    assert.ok(js.includes('window.handleHomeRescheduleNextTask'), 'Must define window.handleHomeRescheduleNextTask');
    assert.ok(js.includes('#1 DO FIRST'), 'Must render #1 DO FIRST rank badge');
    assert.ok(!js.includes('Flexible Seal Block'), 'Typo Flexible Seal Block must not exist');
  });

  await t.test('2. Specific Weekend Warning Message when Weekdays is complete but Weekends is incomplete', async () => {
    // Set 100% weekdays coverage for User A (00:00 to 24:00)
    db.prepare(`
      INSERT INTO routines (id, user_id, name, start_time, end_time, days, type, schedule_group, availability_type, is_reviewed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(`r-wk-1-${timestamp}`, userAId, 'Sleep', '00:00', '08:00', '["Monday","Tuesday","Wednesday","Thursday","Friday"]', 'Fixed', 'weekdays', 'busy');

    db.prepare(`
      INSERT INTO routines (id, user_id, name, start_time, end_time, days, type, schedule_group, availability_type, is_reviewed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(`r-wk-2-${timestamp}`, userAId, 'College', '08:00', '16:00', '["Monday","Tuesday","Wednesday","Thursday","Friday"]', 'Fixed', 'weekdays', 'busy');

    db.prepare(`
      INSERT INTO routines (id, user_id, name, start_time, end_time, days, type, schedule_group, availability_type, is_reviewed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(`r-wk-3-${timestamp}`, userAId, 'Free Study', '16:00', '24:00', '["Monday","Tuesday","Wednesday","Thursday","Friday"]', 'Flexible', 'weekdays', 'available');

    const status = getRoutineCoverageStatus(db, userAId);
    assert.equal(status.is_routine_complete, false, 'Routine must be incomplete since weekends has 0 minutes');
    assert.equal(status.incomplete_group, 'weekends', 'Incomplete group must be weekends');
    assert.equal(status.weekday_complete, true, 'Weekdays must be complete');
    assert.equal(status.weekend_complete, false, 'Weekends must be incomplete');
    assert.ok(status.message.includes('Weekends (Sat–Sun)'), 'Message must specifically mention Weekends');
  });

  await t.test('3. POST /api/routines/copy-group: Replicates weekday routines to weekends with strict user isolation', async () => {
    // Copy weekdays to weekends for User A
    const res = await fetch(`${baseUrl}/api/routines/copy-group`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userACookie
      },
      body: JSON.stringify({ fromGroup: 'weekdays', toGroup: 'weekends' })
    });

    assert.equal(res.status, 200, 'Copy group endpoint must return 200');
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.copied_count, 3, 'Must have copied 3 routines');

    // Verify User A coverage is now 100% complete for both
    const updatedStatus = getRoutineCoverageStatus(db, userAId);
    assert.equal(updatedStatus.is_routine_complete, true, 'Routine must be complete now');
    assert.equal(updatedStatus.weekday_complete, true);
    assert.equal(updatedStatus.weekend_complete, true);

    // Verify User B routines were NOT affected (User B has 0 routines)
    const userBRoutines = db.prepare('SELECT * FROM routines WHERE user_id = ?').all(userBId);
    assert.equal(userBRoutines.length, 0, 'User B must have 0 routines');
  });

  await t.test('4. Priority Scheduling & GET /api/schedule?date=today: Ranked blocks with goal details', async () => {
    // Create goal and task for User A
    const goalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userACookie
      },
      body: JSON.stringify({
        title: 'Master ML Engineering',
        priority: 'High',
        target_date: '2026-12-31'
      })
    });
    const goalData = await goalRes.json();
    const goalId = goalData.goal.id;

    // Create 2 tasks under the goal
    const task1Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userACookie
      },
      body: JSON.stringify({
        goal_id: goalId,
        title: 'Complete Transformer Attention Practice',
        priority: 'High',
        duration_minutes: 60
      })
    });
    const task1Data = await task1Res.json();

    const task2Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userACookie
      },
      body: JSON.stringify({
        goal_id: goalId,
        title: 'Review Loss Functions',
        priority: 'Medium',
        duration_minutes: 45
      })
    });
    const task2Data = await task2Res.json();

    // Trigger auto-schedule
    const genRes = await fetch(`${baseUrl}/api/schedule/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userACookie
      },
      body: JSON.stringify({ daysAhead: 7, clearExisting: true })
    });
    const genData = await genRes.json();
    assert.equal(genData.success, true);
    assert.ok(genData.scheduled_count >= 2, 'Should have scheduled at least 2 tasks');

    // Query GET /api/schedule?date=today
    const schedRes = await fetch(`${baseUrl}/api/schedule?date=today`, {
      headers: { 'Cookie': userACookie }
    });
    assert.equal(schedRes.status, 200);
    const schedData = await schedRes.json();
    assert.equal(schedData.success, true);
    assert.ok(Array.isArray(schedData.blocks), 'blocks must be an array');
    assert.ok(schedData.blocks.length >= 2, 'Should return scheduled blocks');

    const firstBlock = schedData.blocks[0];
    assert.ok(firstBlock.task_title, 'Block must include task_title');
    assert.equal(firstBlock.goal_title, 'Master ML Engineering', 'Block must include goal_title');
    assert.equal(firstBlock.goal_priority, 'High', 'Block must include goal_priority');
    assert.ok(firstBlock.task_priority, 'Block must include task_priority');
  });

  await t.test('5. GET /api/tasks: Returns joined goal_title and scheduled_start_time', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      headers: { 'Cookie': userACookie }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.tasks));

    const taskWithGoal = data.tasks.find(t => t.goal_id);
    assert.ok(taskWithGoal, 'Must find a task with goal_id');
    assert.equal(taskWithGoal.goal_title, 'Master ML Engineering', 'Task must have joined goal_title');
    assert.equal(taskWithGoal.goal_priority, 'High', 'Task must have joined goal_priority');
    assert.ok(taskWithGoal.scheduled_start_time, 'Scheduled task must have scheduled_start_time');
  });

  await t.test('6. GET /api/insights: 100% real calculations with task breakdown and productivity trend', async () => {
    const res = await fetch(`${baseUrl}/api/insights`, {
      headers: { 'Cookie': userACookie }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    // Verify structure
    assert.ok(data.metrics, 'Must return metrics');
    assert.equal(typeof data.metrics.completed_tasks, 'number');
    assert.equal(typeof data.metrics.focus_hours, 'number');
    assert.equal(typeof data.metrics.streak, 'number');

    assert.ok(data.task_breakdown, 'Must return real task_breakdown');
    assert.equal(typeof data.task_breakdown.completed, 'number');
    assert.equal(typeof data.task_breakdown.scheduled, 'number');
    assert.equal(typeof data.task_breakdown.missed, 'number');
    assert.equal(typeof data.task_breakdown.unscheduled, 'number');
    assert.equal(typeof data.task_breakdown.total, 'number');
    assert.ok(data.task_breakdown.total >= 2);

    assert.ok(data.productivity_trend, 'Must return productivity_trend');
    assert.equal(data.productivity_trend.values.length, 7);
    assert.equal(data.productivity_trend.days.length, 7);
  });
});
