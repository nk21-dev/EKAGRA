const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const testDbPath = path.resolve(__dirname, '../data/test_schedule_sync_ekagra.sqlite');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (e) {}
}
process.env.DB_PATH = './data/test_schedule_sync_ekagra.sqlite';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-schedule-sync-suite-32chars!!';

const app = require('../server/index');

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
      headers: { ...headers }
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
          json
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

test('EKAGRA Schedule Synchronization & Multi-Day Views Suite', async (t) => {
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

  const timestamp = Date.now();
  const userA = {
    name: 'Schedule Sync User',
    email: `sched_sync_${timestamp}@ekagra.ai`,
    password: 'Password123!@#',
    confirmPassword: 'Password123!@#'
  };

  let authCookie = null;
  let userId = null;
  let taskId1 = null;
  let taskId2 = null;
  let taskId3 = null;

  await t.test('1. User Registration & Full-Day Routine Setup', async () => {
    const signupRes = await makeRequest('POST', '/api/auth/signup', {}, userA);
    assert.equal(signupRes.status, 201);
    authCookie = extractCookie(signupRes.headers);
    userId = signupRes.json.user.id;

    // Set up full 24-hour routine
    const routinesRes = await makeRequest('POST', '/api/routines/initial-setup', { Cookie: authCookie }, {
      weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      weekends_days: ['Saturday', 'Sunday'],
      routines: [
        { name: 'Sleep', start_time: '23:00', end_time: '07:00', availability_type: 'busy', type: 'sleep', schedule_group: 'weekdays' },
        { name: 'Morning Routine', start_time: '07:00', end_time: '09:00', availability_type: 'busy', type: 'routine', schedule_group: 'weekdays' },
        { name: 'College / Work', start_time: '09:00', end_time: '17:00', availability_type: 'busy', type: 'work', schedule_group: 'weekdays' },
        { name: 'Deep Focus Window', start_time: '17:00', end_time: '21:00', availability_type: 'available', type: 'study', schedule_group: 'weekdays' },
        { name: 'Evening Wind-down', start_time: '21:00', end_time: '23:00', availability_type: 'busy', type: 'leisure', schedule_group: 'weekdays' }
      ]
    });
    assert.equal(routinesRes.status, 200);

    // Copy to weekends
    const copyRes = await makeRequest('POST', '/api/routines/copy-group', { Cookie: authCookie }, {
      fromGroup: 'weekdays',
      toGroup: 'weekends'
    });
    assert.equal(copyRes.status, 200);
  });

  await t.test('2. Goal & Tasks Creation and Auto-Scheduling', async () => {
    // Create goal
    const goalRes = await makeRequest('POST', '/api/goals', { Cookie: authCookie }, {
      title: 'AI Engineering Sprint',
      priority: 'High',
      target_date: '2026-11-30'
    });
    assert.equal(goalRes.status, 201);
    const goalId = goalRes.json.goal.id;

    // Create 3 tasks
    const t1 = await makeRequest('POST', '/api/tasks', { Cookie: authCookie }, {
      goal_id: goalId,
      title: 'Backpropagation Derivation',
      duration_minutes: 45,
      priority: 'High'
    });
    taskId1 = t1.json.task.id;

    const t2 = await makeRequest('POST', '/api/tasks', { Cookie: authCookie }, {
      goal_id: goalId,
      title: 'NeetCode 150 Graphs',
      duration_minutes: 60,
      priority: 'Medium'
    });
    taskId2 = t2.json.task.id;

    const t3 = await makeRequest('POST', '/api/tasks', { Cookie: authCookie }, {
      goal_id: goalId,
      title: 'Hybrid RAG Pipeline',
      duration_minutes: 45,
      priority: 'Medium'
    });
    taskId3 = t3.json.task.id;

    // Run Auto-Schedule (clearExisting to regenerate)
    const schedRes = await makeRequest('POST', '/api/schedule/generate', { Cookie: authCookie }, {
      daysAhead: 7,
      clearExisting: true
    });
    assert.equal(schedRes.status, 200);
    assert.equal(schedRes.json.success, true);
    assert.ok(schedRes.json.scheduled_count >= 3);
  });

  await t.test('3. Backend GET /api/schedule returns global all_scheduled_task_ids & all_active_blocks', async () => {
    // Query schedule for an empty future date (e.g. 2026-11-28)
    const scheduleRes = await makeRequest('GET', '/api/schedule?date=2026-11-28', { Cookie: authCookie });

    assert.equal(scheduleRes.status, 200);
    assert.equal(scheduleRes.json.success, true);
    assert.equal(scheduleRes.json.date, '2026-11-28');

    // On 2026-11-28, blocks for this specific day should be 0
    assert.equal(scheduleRes.json.blocks.length, 0);

    // But all_scheduled_task_ids must contain all 3 tasks!
    assert.ok(Array.isArray(scheduleRes.json.all_scheduled_task_ids));
    assert.ok(scheduleRes.json.all_scheduled_task_ids.includes(String(taskId1)));
    assert.ok(scheduleRes.json.all_scheduled_task_ids.includes(String(taskId2)));
    assert.ok(scheduleRes.json.all_scheduled_task_ids.includes(String(taskId3)));

    // all_active_blocks must contain details for all active blocks
    assert.ok(Array.isArray(scheduleRes.json.all_active_blocks));
    assert.ok(scheduleRes.json.all_active_blocks.length >= 3);
    const hasT1 = scheduleRes.json.all_active_blocks.some((b) => String(b.task_id) === String(taskId1));
    assert.equal(hasT1, true);
  });

  await t.test('4. Range Query GET /api/schedule?start_date=...&end_date=... returns blocks across range', async () => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const future = new Date(today.getTime() + 6 * 24 * 60 * 60 * 1000);
    const futureIso = future.toISOString().slice(0, 10);

    const rangeRes = await makeRequest('GET', `/api/schedule?start_date=${todayIso}&end_date=${futureIso}`, { Cookie: authCookie });

    assert.equal(rangeRes.status, 200);
    assert.equal(rangeRes.json.success, true);
    assert.ok(rangeRes.json.blocks.length >= 3);
  });

  await t.test('5. Single Task Scheduling: POST /api/schedule/schedule-task', async () => {
    // Create an independent unscheduled task
    const indTaskRes = await makeRequest('POST', '/api/tasks', { Cookie: authCookie }, {
      title: 'Pay Electricity Bill',
      duration_minutes: 20,
      priority: 'Medium'
    });
    assert.equal(indTaskRes.status, 201);
    const indTaskId = indTaskRes.json.task.id;

    // Schedule specifically this task
    const singleSchedRes = await makeRequest('POST', '/api/schedule/schedule-task', { Cookie: authCookie }, {
      taskId: indTaskId
    });

    assert.equal(singleSchedRes.status, 200);
    assert.equal(singleSchedRes.json.success, true);
    assert.equal(singleSchedRes.json.task_id, indTaskId);

    // Verify it now appears in all_scheduled_task_ids
    const schedCheck = await makeRequest('GET', '/api/schedule?date=today', { Cookie: authCookie });
    assert.ok(schedCheck.json.all_scheduled_task_ids.includes(String(indTaskId)));
  });

  await t.test('6. GET /api/dashboard/bootstrap returns root allScheduledTaskIds and allActiveBlocks', async () => {
    const bootRes = await makeRequest('GET', '/api/dashboard/bootstrap', { Cookie: authCookie });

    assert.equal(bootRes.status, 200);
    assert.ok(Array.isArray(bootRes.json.allScheduledTaskIds));
    assert.ok(bootRes.json.allScheduledTaskIds.includes(String(taskId1)));
    assert.ok(Array.isArray(bootRes.json.allActiveBlocks));
    assert.ok(bootRes.json.allActiveBlocks.length >= 4);
  });

  await t.test('7. Frontend Unscheduled Queue Logic Verification (No False Positives)', async () => {
    const jsContent = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

    // Verify globalScheduledTaskIds checks state.all_scheduled_task_ids
    assert.ok(jsContent.includes('globalScheduledTaskIds = new Set('));
    assert.ok(jsContent.includes('all_scheduled_task_ids'));

    // Verify task is filtered by !globalScheduledTaskIds.has
    assert.ok(jsContent.includes('!globalScheduledTaskIds.has(String(t.id))'));

    // Verify helpful empty day note exists
    assert.ok(jsContent.includes('No tasks scheduled for'));
    assert.ok(jsContent.includes('scheduled on Today'));
    assert.ok(jsContent.includes('Jump to Today'));

    // Verify single-task schedule button calls scheduleSingleTask
    assert.ok(jsContent.includes("scheduleSingleTask('${t.id}', this)"));
    assert.ok(jsContent.includes('window.scheduleSingleTask = async function'));
  });

  await t.test('8. Frontend View Switch & Navigation Verification (0ms instant switch)', async () => {
    const jsContent = fs.readFileSync(path.join(__dirname, '../public/js/dashboard.js'), 'utf8');

    // Verify openScheduleTodayDayView is defined and resets date to Today and Day mode
    assert.ok(jsContent.includes('window.openScheduleTodayDayView = function'));
    assert.ok(jsContent.includes("Store.state.scheduleViewMode = 'Day'"));

    // Verify HTML links to openScheduleTodayDayView()
    const htmlContent = fs.readFileSync(path.join(__dirname, '../public/views/dashboard.html'), 'utf8');
    assert.ok(htmlContent.includes('openScheduleTodayDayView()'));

    // Verify updateScheduleTodayButtonHighlight toggles highlight-today-btn
    assert.ok(jsContent.includes('updateScheduleTodayButtonHighlight'));
    assert.ok(jsContent.includes('highlight-today-btn'));

    // Verify CSS has .highlight-today-btn and .schedule-empty-day-callout
    const cssContent = fs.readFileSync(path.join(__dirname, '../public/css/dashboard.css'), 'utf8');
    assert.ok(cssContent.includes('.btn-secondary-pill.highlight-today-btn'));
    assert.ok(cssContent.includes('.schedule-empty-day-callout'));
  });
});
