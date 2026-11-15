const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const app = require('../server');
const { getDatabase } = require('../server/db');
const {
  isRoutineCoverageComplete,
  calculateDayGaps
} = require('../server/services/routineService');
const {
  computeTaskPriorityScore,
  getFreeIntervalsForDate,
  generateSchedule
} = require('../server/services/schedulingEngine');
const {
  getUserLearningProfile,
  getBucketStats,
  recordTaskCompletion,
  recordTaskMissOrReschedule,
  computeGoalForecast
} = require('../server/services/adaptiveLearningService');
const { calculateGoalHealth } = require('../server/services/goalHealth');

test('EKAGRA Core End-to-End Intelligence Loop Suite', async (t) => {
  let server;
  let baseUrl;
  let userAToken;
  let userBToken;
  let userAId;
  let userBId;
  const db = getDatabase();

  const timestamp = Date.now();
  const userAEmail = `loop_user_a_${timestamp}@ekagra.ai`;
  const userBEmail = `loop_user_b_${timestamp}@ekagra.ai`;
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
      body: JSON.stringify({ name: 'User A Loop', email: userAEmail, password, confirmPassword: password })
    });
    assert.equal(resA.status, 201);
    const cookieA = resA.headers.get('set-cookie');
    userAToken = cookieA ? cookieA.split(';')[0] : '';
    const dataA = await resA.json();
    userAId = dataA.user.id;

    const resB = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User B Loop', email: userBEmail, password, confirmPassword: password })
    });
    assert.equal(resB.status, 201);
    const cookieB = resB.headers.get('set-cookie');
    userBToken = cookieB ? cookieB.split(';')[0] : '';
    const dataB = await resB.json();
    userBId = dataB.user.id;

    assert.ok(userAToken);
    assert.ok(userBToken);
  });

  // =========================================================================
  // PART 1: 24-HOUR ROUTINE GATE ON GOALS & AUTOFILL BUG FIX
  // =========================================================================

  await t.test('1. Routine Gate: New user has incomplete coverage and goal creation flags routine_coverage_incomplete', async () => {
    // Brand new user has 0 routines -> coverage incomplete
    assert.equal(isRoutineCoverageComplete(db, userAId), false);

    // Create Goal
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Master Machine Learning',
        description: 'Complete ML fundamentals and deep learning projects',
        priority: 'High',
        target_date: '2026-12-31'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.success, true);
    assert.ok(data.goal.id);
    assert.equal(data.routine_coverage_incomplete, true);
    assert.equal(data.is_routine_complete, false);
    // Goal health on creation with 0 tasks must be neutral On Track
    assert.equal(data.goal.health, 'On Track');
  });

  await t.test('2. UI Verification: Banner and Autofill Bug Fix present in dashboard.html', () => {
    const htmlPath = path.resolve(__dirname, '../public/views/dashboard.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Persistent banner with exact prompt message
    assert.ok(html.includes('id="globalRoutineIncompleteBanner"'), 'globalRoutineIncompleteBanner must exist');
    assert.ok(
      html.includes('Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.'),
      'Must contain exact mandatory explanation text'
    );

    // Routine Title inputs must have unique non-email name and autocomplete="off"
    assert.ok(html.includes('name="routineBlockLabel"'), 'Must define name="routineBlockLabel" to prevent autofill');
    assert.ok(html.includes('autocomplete="off"'), 'Must have autocomplete="off"');
    assert.ok(html.includes('id="btnAutoScheduleGoals"'), 'Must have explicit Auto-Schedule button in schedule view');
  });

  await t.test('3. Routine 100% Coverage Verification (1440 mins with 0 gaps for Weekdays & Weekends)', async () => {
    // User A sets complete 24h schedule for weekdays:
    // 23:00 - 07:00 Sleep (Fixed, 480m)
    // 07:00 - 08:00 Morning Prep (Fixed, 60m)
    // 08:00 - 15:00 College (Fixed, 420m)
    // 15:00 - 18:00 Study Focus (Available, 180m)
    // 18:00 - 19:30 Workout (Flexible, 90m)
    // 19:30 - 21:00 Dinner & Family (Fixed, 90m)
    // 21:00 - 23:00 Evening Focus (Available, 120m)
    // Total = 480 + 60 + 420 + 180 + 90 + 90 + 120 = 1440 minutes!

    const weekdayBlocks = [
      { name: 'Sleep', start_time: '23:00', end_time: '07:00', days: '["Monday","Tuesday","Wednesday","Thursday","Friday"]', type: 'Fixed', schedule_group: 'weekdays', availability_type: 'busy' },
      { name: 'Morning Prep', start_time: '07:00', end_time: '08:00', days: '["Monday","Tuesday","Wednesday","Thursday","Friday"]', type: 'Fixed', schedule_group: 'weekdays', availability_type: 'busy' },
      { name: 'College', start_time: '08:00', end_time: '15:00', days: '["Monday","Tuesday","Wednesday","Thursday","Friday"]', type: 'Fixed', schedule_group: 'weekdays', availability_type: 'busy' },
      { name: 'Study Focus', start_time: '15:00', end_time: '18:00', days: '["Monday","Tuesday","Wednesday","Thursday","Friday"]', type: 'Flexible', schedule_group: 'weekdays', availability_type: 'available' },
      { name: 'Workout', start_time: '18:00', end_time: '19:30', days: '["Monday","Tuesday","Wednesday","Thursday","Friday"]', type: 'Flexible', schedule_group: 'weekdays', availability_type: 'flexible' },
      { name: 'Dinner & Family', start_time: '19:30', end_time: '21:00', days: '["Monday","Tuesday","Wednesday","Thursday","Friday"]', type: 'Fixed', schedule_group: 'weekdays', availability_type: 'busy' },
      { name: 'Evening Focus', start_time: '21:00', end_time: '23:00', days: '["Monday","Tuesday","Wednesday","Thursday","Friday"]', type: 'Flexible', schedule_group: 'weekdays', availability_type: 'available' }
    ];

    // Weekends schedule (1440 mins):
    // 23:00 - 07:00 Sleep (Fixed, 480m)
    // 07:00 - 09:00 Personal Rest (Fixed, 120m)
    // 09:00 - 13:00 Weekend Deep Work (Available, 240m)
    // 13:00 - 15:00 Lunch & Rest (Fixed, 120m)
    // 15:00 - 19:00 Afternoon Project (Available, 240m)
    // 19:00 - 23:00 Leisure & Dinner (Fixed, 240m)
    // Total = 480 + 120 + 240 + 120 + 240 + 240 = 1440 minutes!
    const weekendBlocks = [
      { name: 'Weekend Sleep', start_time: '23:00', end_time: '07:00', days: '["Saturday","Sunday"]', type: 'Fixed', schedule_group: 'weekends', availability_type: 'busy' },
      { name: 'Weekend Rest', start_time: '07:00', end_time: '09:00', days: '["Saturday","Sunday"]', type: 'Fixed', schedule_group: 'weekends', availability_type: 'busy' },
      { name: 'Weekend Deep Work', start_time: '09:00', end_time: '13:00', days: '["Saturday","Sunday"]', type: 'Flexible', schedule_group: 'weekends', availability_type: 'available' },
      { name: 'Lunch & Rest', start_time: '13:00', end_time: '15:00', days: '["Saturday","Sunday"]', type: 'Fixed', schedule_group: 'weekends', availability_type: 'busy' },
      { name: 'Afternoon Project', start_time: '15:00', end_time: '19:00', days: '["Saturday","Sunday"]', type: 'Flexible', schedule_group: 'weekends', availability_type: 'available' },
      { name: 'Leisure & Dinner', start_time: '19:00', end_time: '23:00', days: '["Saturday","Sunday"]', type: 'Fixed', schedule_group: 'weekends', availability_type: 'busy' }
    ];

    // Verify calculateDayGaps produces 1440 covered minutes and 0 gaps
    const wGaps = calculateDayGaps(weekdayBlocks);
    assert.equal(wGaps.is_full_day_covered, true);
    assert.equal(wGaps.covered_minutes, 1440);
    assert.equal(wGaps.gaps.length, 0);

    const weGaps = calculateDayGaps(weekendBlocks);
    assert.equal(weGaps.is_full_day_covered, true);
    assert.equal(weGaps.covered_minutes, 1440);
    assert.equal(weGaps.gaps.length, 0);

    // Save into database for User A
    for (const b of [...weekdayBlocks, ...weekendBlocks]) {
      const bId = `rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO routines (id, user_id, name, start_time, end_time, days, type, schedule_group, availability_type, is_reviewed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(bId, userAId, b.name, b.start_time, b.end_time, b.days, b.type, b.schedule_group, b.availability_type);
    }

    // Now isRoutineCoverageComplete must be TRUE
    assert.equal(isRoutineCoverageComplete(db, userAId), true);
  });

  // =========================================================================
  // PART 2: PRIORITY SCHEDULING ENGINE & ANTI-OVERWHELM BUFFER
  // =========================================================================

  await t.test('4. Priority Scoring Formula: Deterministic scoring with W_goal, W_task, U_deadline, and Fairness', () => {
    // Goal: High priority (W_goal = 50)
    // Task 1: High priority (W_task = 30), due tomorrow (days_until = 1 -> U_deadline = 40 / (1 + 1) = 20)
    // Fairness: never scheduled -> 20
    // Total expected score = 50 + 30 + 20 + 20 = 120
    const goalHigh = { id: 'g-test-high', priority: 'High', target_date: '2026-12-31', created_at: '2026-01-01' };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
    const taskHighUrgent = { id: 't-1', goal_id: 'g-test-high', priority: 'High', due_date: tomorrowStr };

    const score1 = computeTaskPriorityScore(db, userAId, taskHighUrgent, goalHigh);
    assert.equal(score1.wGoal, 50);
    assert.equal(score1.wTask, 30);
    assert.equal(score1.uDeadline, 20);
    assert.equal(score1.totalScore, 120);

    // Task 2: Low priority (W_task = 5), Low goal (W_goal = 10), due in 39 days (U = 40 / 40 = 1)
    const goalLow = { id: 'g-test-low', priority: 'Low', target_date: '2026-12-31', created_at: '2026-01-01' };
    const future39 = new Date();
    future39.setDate(future39.getDate() + 39);
    const future39Str = future39.getFullYear() + '-' + String(future39.getMonth() + 1).padStart(2, '0') + '-' + String(future39.getDate()).padStart(2, '0');
    const taskLow = { id: 't-2', goal_id: 'g-test-low', priority: 'Low', due_date: future39Str };

    const score2 = computeTaskPriorityScore(db, userAId, taskLow, goalLow);
    assert.equal(score2.wGoal, 10);
    assert.equal(score2.wTask, 5);
    assert.equal(score2.uDeadline, 1);
    assert.ok(score1.totalScore > score2.totalScore, 'High priority urgent task must outscore low priority task');
  });

  await t.test('5. Routine Availability & Zero Fixed Overlap: Only schedules inside available slots', () => {
    // For User A on a weekday (e.g. 2026-11-18 is Wednesday):
    // Available slots: 15:00-18:00 (180m), 18:00-19:30 (flexible 90m), 21:00-23:00 (120m)
    // Fixed busy commitments: Sleep (23:00-07:00), Morning Prep (07:00-08:00), College (08:00-15:00), Dinner (19:30-21:00)
    const freeIntervals = getFreeIntervalsForDate(db, userAId, '2026-11-18');
    assert.ok(freeIntervals.length > 0);

    // Verify NONE of the free intervals overlap College (08:00-15:00 = 480m to 900m) or Sleep (23:00-07:00)
    for (const slot of freeIntervals) {
      const inCollege = !(slot.end <= 480 || slot.start >= 900);
      assert.equal(inCollege, false, `Slot [${slot.start}, ${slot.end}] must NEVER overlap College [480, 900]`);
    }
  });

  let task1Id;
  let task2Id;
  let task3Id;

  await t.test('6. Schedule Generation & Anti-Overwhelm Buffer: Generates schedule and respects capacity limit', async () => {
    // Add tasks for User A under the active goal
    const goalRow = db.prepare('SELECT id FROM goals WHERE user_id = ? LIMIT 1').get(userAId);
    assert.ok(goalRow);

    task1Id = `t-loop-1-${timestamp}`;
    task2Id = `t-loop-2-${timestamp}`;
    task3Id = `t-loop-3-${timestamp}`;

    const task1 = { id: task1Id, user_id: userAId, goal_id: goalRow.id, title: 'Read Research Paper', priority: 'High', duration_minutes: 60 };
    const task2 = { id: task2Id, user_id: userAId, goal_id: goalRow.id, title: 'Implement Attention Head', priority: 'High', duration_minutes: 90 };
    const task3 = { id: task3Id, user_id: userAId, goal_id: goalRow.id, title: 'Write Documentation', priority: 'Medium', duration_minutes: 45 };

    for (const t of [task1, task2, task3]) {
      db.prepare(`
        INSERT INTO tasks (id, user_id, goal_id, title, priority, duration_minutes, completed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(t.id, t.user_id, t.goal_id, t.title, t.priority, t.duration_minutes);
    }

    const genRes = await fetch(`${baseUrl}/api/schedule/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({ clearExisting: true, daysAhead: 7 })
    });

    const genData = await genRes.json();
    assert.equal(genRes.status, 200);
    assert.equal(genData.success, true);
    assert.ok(genData.scheduled_count >= 3, 'Must schedule all 3 candidate tasks');

    // Query scheduled blocks via GET /api/schedule
    const getRes = await fetch(`${baseUrl}/api/schedule`, {
      headers: { 'Cookie': userAToken }
    });
    const getData = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.equal(getData.success, true);
    assert.ok(getData.blocks.length >= 3);

    // Verify scheduled blocks fall within available routine windows and never during fixed commitments
    for (const block of getData.blocks) {
      if (getData.schedule_group === 'weekdays') {
        assert.ok(
          block.start_time >= '15:00' || block.end_time <= '08:00',
          `Block ${block.task_title} at ${block.start_time} must not overlap College (08:00 - 15:00)`
        );
      } else {
        assert.ok(
          (block.start_time >= '09:00' && block.end_time <= '13:00') ||
          (block.start_time >= '15:00' && block.end_time <= '19:00'),
          `Block ${block.task_title} at ${block.start_time}-${block.end_time} must be inside weekend available windows (09:00-13:00 or 15:00-19:00)`
        );
      }
    }
  });

  // =========================================================================
  // PART 3: ONLINE ADAPTIVE ML (EWMA PACE & BETA-BINOMIAL FOCUS QUALITY)
  // =========================================================================

  await t.test('7. Model 1 EWMA Speed Calibration & Model 2 Focus Classifier Updates', async () => {
    // 1. Initial Profile Verification
    const initialProfile = getUserLearningProfile(db, userAId);
    assert.equal(initialProfile.pace_factor, 1.0);
    assert.equal(initialProfile.completed_count, 0);

    // Initial bucket stats: alpha=2, beta=2 -> P = 0.50
    const mStats = getBucketStats(initialProfile, 'morning');
    assert.equal(mStats.alpha, 2.0);
    assert.equal(mStats.beta, 2.0);
    assert.equal(mStats.p_complete, 0.5);
    assert.equal(mStats.slip_risk, 0.5);

    // Cold-start Task 1 Completion (estimated 60m, actual 120m -> ratio 2.0)
    // Under cold start (count < 3), pace_factor remains 1.0
    recordTaskCompletion(db, userAId, {
      taskId: task1Id,
      estimatedMinutes: 60,
      actualMinutes: 120,
      timeBucket: 'morning',
      outcome: 'completed'
    });

    let pAfter1 = getUserLearningProfile(db, userAId);
    assert.equal(pAfter1.completed_count, 1);
    assert.equal(pAfter1.pace_factor, 1.0, 'Cold-start: pace factor remains 1.0 for task 1');
    assert.equal(pAfter1.alpha_morning, 3.0, 'Morning alpha incremented to 3.0');

    // Cold-start Task 2 Completion
    recordTaskCompletion(db, userAId, {
      taskId: task2Id,
      estimatedMinutes: 90,
      actualMinutes: 180,
      timeBucket: 'morning',
      outcome: 'completed'
    });

    let pAfter2 = getUserLearningProfile(db, userAId);
    assert.equal(pAfter2.completed_count, 2);
    assert.equal(pAfter2.pace_factor, 1.0, 'Cold-start: pace factor remains 1.0 for task 2');

    // Task 3 Completion -> Reaches count = 3, EWMA calibration activates!
    // r_i = 120 / 60 = 2.0
    // C_new = clamp(0.3 * 2.0 + 0.7 * 1.0, 0.7, 2.0) = 0.6 + 0.7 = 1.3
    recordTaskCompletion(db, userAId, {
      taskId: task3Id,
      estimatedMinutes: 60,
      actualMinutes: 120,
      timeBucket: 'morning',
      outcome: 'completed'
    });

    let pAfter3 = getUserLearningProfile(db, userAId);
    assert.equal(pAfter3.completed_count, 3);
    assert.equal(pAfter3.pace_factor, 1.3, 'EWMA pace factor calibrated to 1.3x after 3rd task');
    assert.equal(pAfter3.alpha_morning, 5.0, 'Morning alpha incremented to 5.0');

    // Morning P_complete: alpha=5, beta=2 -> 5 / 7 = 0.714
    const mStatsUpdated = getBucketStats(pAfter3, 'morning');
    assert.equal(mStatsUpdated.p_complete, 0.714);
    assert.equal(mStatsUpdated.slip_risk, 0.286);

    // Record a missed/rescheduled task in Evening bucket -> beta_evening should increment!
    recordTaskMissOrReschedule(db, userAId, {
      taskId: task3Id,
      timeBucket: 'evening',
      outcome: 'missed'
    });

    let pAfterMiss = getUserLearningProfile(db, userAId);
    assert.equal(pAfterMiss.beta_evening, 3.0, 'Evening beta incremented to 3.0 on miss');

    // Evening P_complete: alpha=2, beta=3 -> 2 / 5 = 0.400
    const evStats = getBucketStats(pAfterMiss, 'evening');
    assert.equal(evStats.p_complete, 0.4);
    assert.equal(evStats.slip_risk, 0.6);
  });

  await t.test('8. Model 3 Rolling-Velocity Goal Forecaster', () => {
    const goalRow = db.prepare('SELECT id FROM goals WHERE user_id = ? LIMIT 1').get(userAId);
    assert.ok(goalRow);

    const forecast = computeGoalForecast(db, userAId, goalRow.id);
    assert.ok(forecast);
    assert.ok(['On Track', 'At Risk', 'Behind', 'Needs Tasks', 'Completed'].includes(forecast.status));
    assert.ok(typeof forecast.burn_rate_mins_day === 'number');
    assert.ok(typeof forecast.days_needed === 'number');
  });

  await t.test('9. GET /api/insights Endpoint: Returns behavioral ML metrics, capacity, and forecasts', async () => {
    const res = await fetch(`${baseUrl}/api/insights`, {
      headers: { 'Cookie': userAToken }
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.ok(data.learning);
    assert.equal(data.learning.pace_factor, 1.3);
    assert.ok(data.learning.bucket_stats.morning);
    assert.ok(data.capacity);
    assert.ok(data.capacity.daily_available_mins > 0);
    assert.ok(Array.isArray(data.goal_forecasts));
    assert.ok(Array.isArray(data.recent_logs));
  });

  // =========================================================================
  // PART 4: STRICT USER ISOLATION
  // =========================================================================

  await t.test('10. Strict User Isolation: User B cannot view User A scheduled blocks or insights', async () => {
    // User B calls GET /api/schedule -> must see ZERO blocks belonging to User A
    const bScheduleRes = await fetch(`${baseUrl}/api/schedule`, {
      headers: { 'Cookie': userBToken }
    });
    const bScheduleData = await bScheduleRes.json();
    assert.equal(bScheduleRes.status, 200);
    assert.equal(bScheduleData.blocks.length, 0, 'User B must NOT see User A scheduled blocks');

    // User B calls GET /api/insights -> must see default clean profile
    const bInsightsRes = await fetch(`${baseUrl}/api/insights`, {
      headers: { 'Cookie': userBToken }
    });
    const bInsightsData = await bInsightsRes.json();
    assert.equal(bInsightsRes.status, 200);
    assert.equal(bInsightsData.learning.pace_factor, 1.0, 'User B pace factor must be untouched at 1.0');
    assert.equal(bInsightsData.learning.completed_count, 0, 'User B completed count must be 0');
    assert.equal(bInsightsData.recent_logs.length, 0, 'User B must NOT see User A execution logs');
  });
});
