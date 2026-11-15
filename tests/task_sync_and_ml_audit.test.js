const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server');
const { getDatabase } = require('../server/db');
const {
  getUserLearningProfile,
  getBucketStats
} = require('../server/services/adaptiveLearningService');
const {
  rescheduleTask,
  completeScheduledTask
} = require('../server/services/schedulingEngine');

test('EKAGRA Task Sync and ML Audit Regression Suite', async (t) => {
  let server;
  let baseUrl;
  let userToken;
  let userId;
  const db = getDatabase();

  const timestamp = Date.now();
  const userEmail = `ml_audit_${timestamp}@ekagra.ai`;
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

  // Step 1: Register User & Complete 24h Routine Setup
  await t.test('1. Setup: Register user & establish 24-hour routines for Weekdays and Weekends', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ML Audit User', email: userEmail, password, confirmPassword: password })
    });
    assert.equal(signupRes.status, 201);
    const signupData = await signupRes.json();
    userToken = signupData.token;
    userId = signupData.user.id;
    assert.ok(userToken);
    assert.ok(userId);

    // Initial 24h routines: Weekdays has Sleep (00:00-08:00 fixed), College (08:00-16:00 fixed), Free (16:00-24:00 available)
    // Weekends has Sleep (00:00-08:00 fixed), Gym (08:00-10:00 fixed), Free Time (10:00-24:00 available = 14h)
    const routineRes = await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekends_days: ['Saturday', 'Sunday'],
        routines: [
          { name: 'Sleep', start_time: '00:00', end_time: '08:00', schedule_group: 'weekdays', type: 'Fixed', availability_type: 'busy' },
          { name: 'College', start_time: '08:00', end_time: '16:00', schedule_group: 'weekdays', type: 'Fixed', availability_type: 'busy' },
          { name: 'Evening Study', start_time: '16:00', end_time: '24:00', schedule_group: 'weekdays', type: 'Flexible', availability_type: 'available' },
          { name: 'Sleep Weekend', start_time: '00:00', end_time: '08:00', schedule_group: 'weekends', type: 'Fixed', availability_type: 'busy' },
          { name: 'Gym', start_time: '08:00', end_time: '10:00', schedule_group: 'weekends', type: 'Fixed', availability_type: 'busy' },
          { name: 'Weekend Free Window', start_time: '10:00', end_time: '24:00', schedule_group: 'weekends', type: 'Flexible', availability_type: 'available' }
        ]
      })
    });
    assert.equal(routineRes.status, 200);
  });

  // Step 2: Goal & Task Creation
  let goalId;
  let taskId1;
  let taskId2;
  let taskIdUnlinked;

  await t.test('2. Goal & Task Creation with parent goal enrichment', async () => {
    // Create goal
    const goalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        title: 'Master Systems Programming',
        priority: 'High',
        target_date: '2026-12-31'
      })
    });
    assert.equal(goalRes.status, 201);
    const goalData = await goalRes.json();
    goalId = goalData.goal.id;

    // Create tasks
    const t1Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        goal_id: goalId,
        title: 'Implement Memory Allocator',
        priority: 'High',
        duration_minutes: 60
      })
    });
    assert.equal(t1Res.status, 201);
    taskId1 = (await t1Res.json()).task.id;

    const t2Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        goal_id: goalId,
        title: 'Write Benchmark Suite',
        priority: 'Medium',
        duration_minutes: 45
      })
    });
    assert.equal(t2Res.status, 201);
    taskId2 = (await t2Res.json()).task.id;

    const t3Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        title: 'Personal Errands Task',
        priority: 'Low',
        duration_minutes: 30
      })
    });
    assert.equal(t3Res.status, 201);
    taskIdUnlinked = (await t3Res.json()).task.id;

    // Verify GET /api/tasks returns goal_title, goal_name, goal_priority
    const tasksRes = await fetch(`${baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(tasksRes.status, 200);
    const tasksData = await tasksRes.json();
    const task1 = tasksData.tasks.find((t) => t.id === taskId1);
    assert.equal(task1.goal_title, 'Master Systems Programming');
    assert.equal(task1.goal_name, 'Master Systems Programming');
    assert.equal(task1.goal_priority, 'High');

    const taskUnlinked = tasksData.tasks.find((t) => t.id === taskIdUnlinked);
    assert.equal(taskUnlinked.goal_title, 'Personal');
    assert.equal(taskUnlinked.goal_name, 'Personal');
  });

  // Step 3: Reschedule Guard against Fixed Commitment Collision
  await t.test('3. Reschedule collision guard prevents scheduling into fixed routines', async () => {
    // 2026-11-16 is a Monday (Weekday). Fixed college is 08:00 - 16:00.
    const resCollision = await fetch(`${baseUrl}/api/schedule/reschedule-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        taskId: taskId1,
        newDate: '2026-11-16',
        newStartTime: '09:00' // Collides with College (08:00-16:00)
      })
    });
    assert.equal(resCollision.status, 400);
    const errData = await resCollision.json();
    assert.match(errData.error, /Cannot reschedule into a fixed routine commitment/i);

    // Rescheduling into available slot (17:00) must succeed
    const resOk = await fetch(`${baseUrl}/api/schedule/reschedule-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        taskId: taskId1,
        newDate: '2026-11-16',
        newStartTime: '17:00'
      })
    });
    assert.equal(resOk.status, 200);
  });

  // Step 4: Complete Task & ML Synchronous Calibration
  await t.test('4. Completing task synchronizes user_learning_profile completed_count and execution_logs', async () => {
    const profileBefore = getUserLearningProfile(db, userId);
    const initialCompletedCount = profileBefore.completed_count || 0;

    // Complete taskId1 via schedule complete route
    const compRes = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({ taskId: taskId1, actualMinutes: 50 })
    });
    assert.equal(compRes.status, 200);

    const profileAfter = getUserLearningProfile(db, userId);
    assert.equal(profileAfter.completed_count, initialCompletedCount + 1);

    // Verify execution log exists
    const log = db.prepare("SELECT * FROM execution_logs WHERE user_id = ? AND task_id = ? AND outcome = 'completed' ORDER BY logged_at DESC LIMIT 1").get(userId, taskId1);
    assert.ok(log);
    assert.equal(log.outcome, 'completed');
    assert.equal(log.actual_minutes, 50);

    // Complete taskId2 via tasks toggle route (PATCH /api/tasks/:id/toggle)
    const toggleRes = await fetch(`${baseUrl}/api/tasks/${taskId2}/toggle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(toggleRes.status, 200);

    const profileAfterToggle = getUserLearningProfile(db, userId);
    assert.equal(profileAfterToggle.completed_count, initialCompletedCount + 2);

    const log2 = db.prepare('SELECT * FROM execution_logs WHERE user_id = ? AND task_id = ?').get(userId, taskId2);
    assert.ok(log2);
    assert.equal(log2.outcome, 'completed');
  });

  // Step 5: Completed Task Guard (Cannot reschedule or complete again)
  await t.test('5. Already completed tasks cannot be rescheduled or re-completed', async () => {
    // Attempting to reschedule taskId1 (which is completed) must fail with HTTP 400
    const resReschedule = await fetch(`${baseUrl}/api/schedule/reschedule-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        taskId: taskId1,
        newDate: '2026-11-17',
        newStartTime: '18:00'
      })
    });
    assert.equal(resReschedule.status, 400);
    const resErr = await resReschedule.json();
    assert.match(resErr.error, /Cannot reschedule an already completed task/i);

    // Attempting to complete taskId1 again must fail with HTTP 400
    const reComplete = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({ taskId: taskId1 })
    });
    assert.equal(reComplete.status, 400);
    const compErr = await reComplete.json();
    assert.match(compErr.error, /Task is already completed/i);
  });

  // Step 6: Insights Weekend Capacity & Goal Forecasts
  await t.test('6. Insights reports accurate Weekend available capacity and goal forecasts', async () => {
    const insightsRes = await fetch(`${baseUrl}/api/insights`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(insightsRes.status, 200);
    const insights = await insightsRes.json();

    // Weekend available minutes: Free Window was 10:00 - 24:00 = 14 hours = 840 mins
    assert.ok(insights.capacity.weekend.available_mins > 0, 'Weekend available minutes must be > 0');
    assert.equal(insights.capacity.weekend.available_mins, 840);
    assert.equal(insights.capacity.weekend.busy_mins, 600); // 8h sleep + 2h gym = 10h = 600 mins

    // Verify goal forecasts includes our goal
    assert.ok(Array.isArray(insights.goal_forecasts));
    const gf = insights.goal_forecasts.find((f) => f.id === goalId);
    assert.ok(gf);
    assert.ok(gf.forecast);
    assert.ok(['Completed', 'On Track', 'At Risk', 'Behind', 'Needs Tasks'].includes(gf.forecast.status));
  });

  // Step 7: Next Task null state when all tasks are complete
  await t.test('7. Next Task is null when all tasks are complete', async () => {
    // Complete the remaining unlinked task
    const t3Comp = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({ taskId: taskIdUnlinked })
    });
    assert.equal(t3Comp.status, 200);

    // Schedule GET must report next_task: null
    const schedRes = await fetch(`${baseUrl}/api/schedule?date=today`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(schedRes.status, 200);
    const schedData = await schedRes.json();
    assert.equal(schedData.next_task, null);
  });

  // Step 8: Verified Execution Check-In Updates EWMA Pace Factor & Calibrated Count
  await t.test('8. Quick Check-In with verified durations calibrates EWMA Speed Learner (>= 3 calibrations)', async () => {
    // Register fresh user for clean cold-start ML verification
    const emailCheckIn = `checkin_ml_${Date.now()}@ekagra.ai`;
    const sRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CheckIn User', email: emailCheckIn, password, confirmPassword: password })
    });
    assert.equal(sRes.status, 201);
    const sData = await sRes.json();
    const cToken = sData.token;
    const cUserId = sData.user.id;

    // Routine setup
    await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cToken}` },
      body: JSON.stringify({
        weekdayRoutines: [
          { name: 'Sleep', start_time: '00:00', end_time: '08:00', type: 'Fixed', availability_type: 'busy' },
          { name: 'Free Time', start_time: '08:00', end_time: '24:00', type: 'Flexible', availability_type: 'available' }
        ],
        weekendRoutines: [
          { name: 'Sleep', start_time: '00:00', end_time: '08:00', type: 'Fixed', availability_type: 'busy' },
          { name: 'Free Time', start_time: '08:00', end_time: '24:00', type: 'Flexible', availability_type: 'available' }
        ]
      })
    });

    // Check cold-start profile
    let profile = getUserLearningProfile(db, cUserId);
    assert.equal(profile.completed_count, 0);
    assert.equal(profile.calibrated_count, 0);
    assert.equal(profile.pace_factor, 1.0);

    // Create Goal & 3 Tasks
    const gRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cToken}` },
      body: JSON.stringify({ title: 'Master Focus Calibration', category: 'Learning', priority: 'High', target_date: '2026-12-31' })
    });
    const gData = await gRes.json();
    const gId = gData.goal.id;

    const createT = async (title) => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cToken}` },
        body: JSON.stringify({ goal_id: gId, title, duration_minutes: 30, priority: 'High' })
      });
      const data = await res.json();
      return data.task.id;
    };

    const t1 = await createT('Task 1 - Verified Duration');
    const t2 = await createT('Task 2 - Verified Duration');
    const t3 = await createT('Task 3 - Verified Duration');

    // 1st verified completion: 30m estimated, 45m actual (ratio = 1.5)
    // Cold start rule: calibrated_count < 3 stays 1.0x
    const res1 = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cToken}` },
      body: JSON.stringify({ taskId: t1, actualMinutes: 45, duration_verified: true })
    });
    assert.equal(res1.status, 200);

    profile = getUserLearningProfile(db, cUserId);
    assert.equal(profile.calibrated_count, 1);
    assert.equal(profile.completed_count, 1);
    assert.equal(profile.pace_factor, 1.0, 'Pace factor stays 1.0 during cold start (< 3 verified)');

    const log1 = db.prepare("SELECT * FROM execution_logs WHERE user_id = ? AND task_id = ?").get(cUserId, t1);
    assert.ok(log1);
    assert.equal(log1.duration_verified, 1);
    assert.equal(log1.actual_minutes, 45);

    // 2nd verified completion: 30m estimated, 45m actual (ratio = 1.5)
    // Cold start rule: calibrated_count = 2 still stays 1.0x
    const res2 = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cToken}` },
      body: JSON.stringify({ taskId: t2, actualMinutes: 45, duration_verified: true })
    });
    assert.equal(res2.status, 200);

    profile = getUserLearningProfile(db, cUserId);
    assert.equal(profile.calibrated_count, 2);
    assert.equal(profile.completed_count, 2);
    assert.equal(profile.pace_factor, 1.0, 'Pace factor stays 1.0 until 3 verified task durations');

    // 3rd verified completion: 30m estimated, 45m actual (ratio = 1.5)
    // Calibrated count hits 3: activates calibrated multiplier!
    // EWMA: 0.3 * 1.5 + 0.7 * 1.0 = 1.15
    const res3 = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cToken}` },
      body: JSON.stringify({ taskId: t3, actualMinutes: 45, duration_verified: true })
    });
    assert.equal(res3.status, 200);

    profile = getUserLearningProfile(db, cUserId);
    assert.equal(profile.calibrated_count, 3);
    assert.equal(profile.completed_count, 3);
    assert.equal(profile.pace_factor, 1.15, 'Pace factor activates at calibrated_count >= 3');

    // Verify GET /api/insights surfaces calibrated_count
    const insRes = await fetch(`${baseUrl}/api/insights`, {
      headers: { Authorization: `Bearer ${cToken}` }
    });
    assert.equal(insRes.status, 200);
    const insData = await insRes.json();
    assert.equal(insData.learning.calibrated_count, 3);
    assert.equal(insData.learning.completed_count, 3);
    assert.equal(insData.learning.pace_factor, 1.15);
  });

  // Step 9: Unverified Check-In (Skip Timing) does NOT alter pace_factor or calibrated_count
  await t.test('9. Skipped/Unverified check-in updates completed_count without corrupting pace factor', async () => {
    // Continue with user from step 8
    const emailSkip = `skip_ml_${Date.now()}@ekagra.ai`;
    const sRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Skip User', email: emailSkip, password, confirmPassword: password })
    });
    const sData = await sRes.json();
    const sToken = sData.token;
    const sUserId = sData.user.id;

    // Setup 24h routine
    await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sToken}` },
      body: JSON.stringify({
        weekdayRoutines: [
          { name: 'Sleep', start_time: '00:00', end_time: '08:00', type: 'Fixed', availability_type: 'busy' },
          { name: 'Free', start_time: '08:00', end_time: '24:00', type: 'Flexible', availability_type: 'available' }
        ],
        weekendRoutines: [
          { name: 'Sleep', start_time: '00:00', end_time: '08:00', type: 'Fixed', availability_type: 'busy' },
          { name: 'Free', start_time: '08:00', end_time: '24:00', type: 'Flexible', availability_type: 'available' }
        ]
      })
    });

    // Create 4 tasks: 3 calibrated with 20m actual (faster than 30m, pace_factor < 1.0)
    const gRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sToken}` },
      body: JSON.stringify({ title: 'Fast Execution Goal', category: 'Work', priority: 'High', target_date: '2026-12-31' })
    });
    const gData = await gRes.json();
    const gId = gData.goal.id;

    const createT = async (title) => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sToken}` },
        body: JSON.stringify({ goal_id: gId, title, duration_minutes: 30, priority: 'Medium' })
      });
      const data = await res.json();
      return data.task.id;
    };

    const task1 = await createT('Task 1');
    const task2 = await createT('Task 2');
    const task3 = await createT('Task 3');
    const task4 = await createT('Task 4 - Skip Timing');

    // Complete 3 tasks with verified duration = 15 min (fast execution)
    for (const tid of [task1, task2, task3]) {
      await fetch(`${baseUrl}/api/schedule/complete-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sToken}` },
        body: JSON.stringify({ taskId: tid, actualMinutes: 15, duration_verified: true })
      });
    }

    let profile = getUserLearningProfile(db, sUserId);
    assert.equal(profile.calibrated_count, 3);
    assert.equal(profile.completed_count, 3);
    assert.ok(profile.pace_factor < 1.0, `Pace factor must be < 1.0 for fast user, got ${profile.pace_factor}`);
    const calibratedPace = profile.pace_factor;

    // Complete task4 with duration_verified: false (Skip Timing)
    const skipRes = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sToken}` },
      body: JSON.stringify({ taskId: task4, duration_verified: false })
    });
    assert.equal(skipRes.status, 200);

    // Profile check: completed_count increments to 4, BUT calibrated_count and pace_factor remain UNCHANGED!
    profile = getUserLearningProfile(db, sUserId);
    assert.equal(profile.completed_count, 4, 'completed_count must increment to 4');
    assert.equal(profile.calibrated_count, 3, 'calibrated_count must remain 3');
    assert.equal(profile.pace_factor, calibratedPace, 'pace_factor must NOT be altered by skipped timing');

    // Execution log check: duration_verified = 0
    const logSkip = db.prepare("SELECT * FROM execution_logs WHERE user_id = ? AND task_id = ?").get(sUserId, task4);
    assert.ok(logSkip);
    assert.equal(logSkip.duration_verified, 0);

    // Insights endpoint verification
    const insRes = await fetch(`${baseUrl}/api/insights`, {
      headers: { Authorization: `Bearer ${sToken}` }
    });
    assert.equal(insRes.status, 200);
    const insData = await insRes.json();
    assert.equal(insData.learning.calibrated_count, 3);
    assert.equal(insData.learning.completed_count, 4);
    assert.equal(insData.learning.pace_factor, calibratedPace);
  });
});
