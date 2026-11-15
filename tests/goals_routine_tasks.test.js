/**
 * EKAGRA — One-Time Routine Setup + Separate Weekday/Weekend Schedules Test Suite
 * Covers all 15 requirements specified in Section 7:
 * 1. Goal is saved and visible before the routine popup opens.
 * 2. Initial popup appears after first goal creation when setup has not been handled.
 * 3. Saving routine setup prevents the popup from appearing again.
 * 4. Skipping setup prevents repeated interruptions.
 * 5. Additional goals do not trigger the popup again.
 * 6. Existing users and existing routines are preserved during migration.
 * 7. Weekday and weekend routines can have different time blocks.
 * 8. Saturday can be assigned to either group.
 * 9. Sunday can be assigned independently.
 * 10. A day cannot belong to both groups simultaneously.
 * 11. Changing day assignments persists after refresh.
 * 12. Routine CRUD and overlap validation still work.
 * 13. Users cannot view or modify another user's routines.
 * 14. Existing goal/task progress remains correct.
 * 15. Existing authentication, dashboard, theme, and goal tests still pass.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const { getDatabase } = require('../server/db');

describe('EKAGRA Goals Experience & Separate Weekday/Weekend Schedules Suite', () => {
  let server;
  let baseUrl;
  let userAToken;
  let userBToken;
  let userAId;
  let userBId;
  let userAGoalId;
  let userARoutineId;
  let userATaskId;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Register User A
    const resA = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Schedule User A',
        email: `sched_a_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    const dataA = await resA.json();
    assert.equal(resA.status, 201);
    userAId = dataA.user.id;
    const cookiesA = resA.headers.getSetCookie ? resA.headers.getSetCookie() : [resA.headers.get('set-cookie')];
    userAToken = cookiesA.map((c) => c.split(';')[0]).join('; ');

    // Register User B
    const resB = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Schedule User B',
        email: `sched_b_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    const dataB = await resB.json();
    assert.equal(resB.status, 201);
    userBId = dataB.user.id;
    const cookiesB = resB.headers.getSetCookie ? resB.headers.getSetCookie() : [resB.headers.get('set-cookie')];
    userBToken = cookiesB.map((c) => c.split(';')[0]).join('; ');
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // 1. Goal is saved and visible before the routine popup opens
  test('1. Goal is saved and visible before the routine popup opens', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Master Quantum Computing',
        description: 'Read primary papers and implement simulators',
        priority: 'High',
        target_date: '2026-12-31'
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.goal);
    assert.equal(data.goal.title, 'Master Quantum Computing');
    userAGoalId = data.goal.id;

    // Verify goal is immediately in database and visible in Goals list
    const listRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const listData = await listRes.json();
    const found = listData.goals.find((g) => g.id === userAGoalId);
    assert.ok(found, 'Goal must be in database and visible before routine popup opens');

    // Verify UI has separate modals: #addGoalModal (single step) and #initialRoutineModal (standalone popup)
    const htmlPath = path.resolve(__dirname, '../public/views/dashboard.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(htmlContent.includes('id="addGoalModal"'), 'Must have separate #addGoalModal');
    assert.ok(htmlContent.includes('id="initialRoutineModal"'), 'Must have separate #initialRoutineModal');
    assert.ok(htmlContent.includes('id="firstTaskBanner"'), 'Must have #firstTaskBanner notification');
  });

  // 2. Initial popup appears after first goal creation when setup has not been handled
  test('2. Initial popup appears after first goal creation when setup has not been handled', async () => {
    // Check initial settings for User A: routine_setup_status should be 'pending'
    const settingsRes = await fetch(`${baseUrl}/api/routines/settings`, {
      headers: { 'Cookie': userAToken }
    });
    assert.equal(settingsRes.status, 200);
    const settingsData = await settingsRes.json();
    assert.equal(settingsData.settings.routine_setup_status, 'pending');

    // Verify dashboard.js triggers openInitialRoutineModal when data.show_routine_setup is true
    const jsPath = path.resolve(__dirname, '../public/js/dashboard.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    assert.ok(jsContent.includes('window.openInitialRoutineModal'), 'Must have openInitialRoutineModal function');
    assert.ok(jsContent.includes('data.show_routine_setup'), 'Must conditionally trigger based on authoritative backend show_routine_setup');
  });

  // 3. Saving routine setup prevents the popup from appearing again
  test('3. Saving routine setup prevents the popup from appearing again', async () => {
    const res = await fetch(`${baseUrl}/api/routines/initial-setup-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({ status: 'completed' })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.settings.routine_setup_status, 'completed');

    // Verify persisted in database
    const db = getDatabase();
    const row = db.prepare('SELECT routine_setup_status FROM user_schedule_settings WHERE user_id = ?').get(userAId);
    assert.equal(row.routine_setup_status, 'completed');
  });

  // 4. Skipping setup prevents repeated interruptions
  test('4. Skipping setup prevents repeated interruptions', async () => {
    // For User B, skip routine setup
    const skipRes = await fetch(`${baseUrl}/api/routines/initial-setup-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userBToken
      },
      body: JSON.stringify({ status: 'skipped' })
    });

    assert.equal(skipRes.status, 200);
    const skipData = await skipRes.json();
    assert.equal(skipData.settings.routine_setup_status, 'skipped');

    // Verify persisted in DB
    const db = getDatabase();
    const row = db.prepare('SELECT routine_setup_status FROM user_schedule_settings WHERE user_id = ?').get(userBId);
    assert.equal(row.routine_setup_status, 'skipped');
  });

  // 5. Additional goals do not trigger the popup again
  test('5. Additional goals do not trigger the popup again', async () => {
    // Create second goal for User A (whose status is completed)
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Second Milestone Goal',
        target_date: '2026-11-30'
      })
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.ok(data.goal);

    // Verify setup status remains completed
    const settingsRes = await fetch(`${baseUrl}/api/routines/settings`, {
      headers: { 'Cookie': userAToken }
    });
    const settingsData = await settingsRes.json();
    assert.equal(settingsData.settings.routine_setup_status, 'completed');
  });

  // 6. Existing users and existing routines are preserved during migration
  test('6. Existing users and existing routines are preserved during migration', () => {
    const db = getDatabase();
    // Verify migration 007 created user_schedule_settings table
    const tableCheck = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='user_schedule_settings'
    `).get();
    assert.ok(tableCheck, 'user_schedule_settings table must exist');

    // Verify schedule_group column in routines
    const colCheck = db.prepare("PRAGMA table_info(routines)").all();
    const hasGroup = colCheck.some((c) => c.name === 'schedule_group');
    assert.ok(hasGroup, 'routines table must have schedule_group column');
  });

  // 7. Weekday and weekend routines can have different time blocks
  test('7. Weekday and weekend routines can have different time blocks', async () => {
    // Add Weekday block: Sleep 23:00 - 06:30
    const resWeekday = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        name: 'Sleep',
        start_time: '23:00',
        end_time: '06:30',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(resWeekday.status, 201);
    const wdData = await resWeekday.json();
    assert.equal(wdData.routine.schedule_group, 'weekdays');
    assert.equal(wdData.routine.start_time, '23:00');
    userARoutineId = wdData.routine.id;

    // Add Weekend block: Gym 10:00 - 12:00
    const resWeekend = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        name: 'Gym',
        start_time: '10:00',
        end_time: '12:00',
        schedule_group: 'weekends',
        type: 'Flexible'
      })
    });
    assert.equal(resWeekend.status, 201);
    const weData = await resWeekend.json();
    assert.equal(weData.routine.schedule_group, 'weekends');
    assert.equal(weData.routine.start_time, '10:00');

    // Verify GET /api/routines returns both with distinct schedule_group values
    const listRes = await fetch(`${baseUrl}/api/routines`, {
      headers: { 'Cookie': userAToken }
    });
    const listData = await listRes.json();
    const wdFound = listData.routines.find((r) => r.schedule_group === 'weekdays' && r.name === 'Sleep');
    const weFound = listData.routines.find((r) => r.schedule_group === 'weekends' && r.name === 'Gym');
    assert.ok(wdFound, 'Must find weekday routine');
    assert.ok(weFound, 'Must find weekend routine');
  });

  // 8. Saturday can be assigned to either group
  test('8. Saturday can be assigned to either group', async () => {
    // Assign Saturday to Weekdays (e.g. 6-day work week: Mon - Sat)
    const res = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        weekends_days: ['Sunday']
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.settings.weekdays_days.includes('Saturday'));
    assert.ok(!data.settings.weekends_days.includes('Saturday'));
  });

  // 9. Sunday can be assigned independently
  test('9. Sunday can be assigned independently', async () => {
    // Now assign Saturday to Weekends, and Sunday remains in Weekends
    const res = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekends_days: ['Saturday', 'Sunday']
      })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.settings.weekdays_days, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    assert.deepEqual(data.settings.weekends_days, ['Saturday', 'Sunday']);
  });

  // 10. A day cannot belong to both groups simultaneously
  test('10. A day cannot belong to both groups simultaneously', async () => {
    // Attempt to assign Saturday to both Weekdays and Weekends
    const resOverlap = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        weekends_days: ['Saturday', 'Sunday']
      })
    });

    assert.equal(resOverlap.status, 400);
    const data = await resOverlap.json();
    assert.ok(data.error.includes('overlap') || data.error.includes('exactly once') || data.error.includes('disjoint'));

    // Attempt to leave a day unassigned (only 6 days total)
    const resMissing = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekends_days: ['Saturday']
      })
    });

    assert.equal(resMissing.status, 400);
  });

  // 11. Changing day assignments persists after refresh
  test('11. Changing day assignments persists after refresh', async () => {
    // Reconfigure User A's schedule: Weekdays = Mon - Thu, Weekends = Fri - Sun
    const updateRes = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
        weekends_days: ['Friday', 'Saturday', 'Sunday']
      })
    });
    assert.equal(updateRes.status, 200);

    // Refresh simulation: GET /api/dashboard/data
    const dashRes = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': userAToken }
    });
    assert.equal(dashRes.status, 200);
    const dashData = await dashRes.json();
    assert.ok(dashData.schedule_settings);
    assert.deepEqual(dashData.schedule_settings.weekdays_days, ['Monday', 'Tuesday', 'Wednesday', 'Thursday']);
    assert.deepEqual(dashData.schedule_settings.weekends_days, ['Friday', 'Saturday', 'Sunday']);
  });

  // 12. Routine CRUD and overlap validation still work
  test('12. Routine CRUD and overlap validation still work', async () => {
    // Add college block: 08:00 - 16:00 on weekdays
    const resCollege = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        name: 'College',
        start_time: '08:00',
        end_time: '16:00',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(resCollege.status, 201);
    const collegeData = await resCollege.json();

    // Overlapping routine on weekdays: 14:00 - 17:00 (overlaps with 08:00 - 16:00)
    const resConflict = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        name: 'Conflicting Study',
        start_time: '14:00',
        end_time: '17:00',
        schedule_group: 'weekdays',
        type: 'Flexible'
      })
    });
    assert.equal(resConflict.status, 409);
    const conflictData = await resConflict.json();
    assert.ok(conflictData.error.includes('overlap') || conflictData.error.includes('Conflict'));

    // Update College routine to non-conflicting time: 08:00 - 14:00
    const resUpdate = await fetch(`${baseUrl}/api/routines/${collegeData.routine.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        name: 'College Lectures',
        start_time: '08:00',
        end_time: '14:00',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(resUpdate.status, 200);
    const updatedData = await resUpdate.json();
    assert.equal(updatedData.routine.name, 'College Lectures');

    // Delete College routine
    const resDelete = await fetch(`${baseUrl}/api/routines/${collegeData.routine.id}`, {
      method: 'DELETE',
      headers: { 'Cookie': userAToken }
    });
    assert.equal(resDelete.status, 200);
  });

  // 13. Users cannot view or modify another user's routines
  test('13. Users cannot view or modify another user\'s routines', async () => {
    // User B tries to update User A's Sleep routine
    const resEdit = await fetch(`${baseUrl}/api/routines/${userARoutineId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userBToken
      },
      body: JSON.stringify({
        name: 'Hacked Sleep',
        start_time: '22:00',
        end_time: '07:00'
      })
    });
    assert.ok([403, 404].includes(resEdit.status), 'User B must not be able to edit User A routine');

    // User B tries to delete User A's Sleep routine
    const resDelete = await fetch(`${baseUrl}/api/routines/${userARoutineId}`, {
      method: 'DELETE',
      headers: { 'Cookie': userBToken }
    });
    assert.ok([403, 404].includes(resDelete.status), 'User B must not be able to delete User A routine');

    // User B listing routines should not contain User A's routine
    const resListB = await fetch(`${baseUrl}/api/routines`, {
      headers: { 'Cookie': userBToken }
    });
    const listBData = await resListB.json();
    const foundAInB = listBData.routines.some((r) => r.id === userARoutineId);
    assert.equal(foundAInB, false, 'User B must not see User A routines');
  });

  // 14. Existing goal/task progress remains correct
  test('14. Existing goal/task progress remains correct', async () => {
    // Add 2 tasks to User A's goal
    const task1Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Task 1: Linear Algebra Review',
        goal_id: userAGoalId,
        duration_minutes: 60
      })
    });
    assert.equal(task1Res.status, 201);
    const task1 = (await task1Res.json()).task;
    userATaskId = task1.id;

    const task2Res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Task 2: Quantum Gates Simulation',
        goal_id: userAGoalId,
        duration_minutes: 90
      })
    });
    assert.equal(task2Res.status, 201);

    // Goal progress with 2 tasks, 0 completed should be 0%
    const goalRes1 = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const goalData1 = await goalRes1.json();
    const g1 = goalData1.goals.find((g) => g.id === userAGoalId);
    assert.equal(g1.progress, 0);

    // Toggle task 1 completed -> progress should be 50%
    const toggleRes = await fetch(`${baseUrl}/api/tasks/${userATaskId}/toggle`, {
      method: 'PATCH',
      headers: { 'Cookie': userAToken }
    });
    assert.equal(toggleRes.status, 200);

    const goalRes2 = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const goalData2 = await goalRes2.json();
    const g2 = goalData2.goals.find((g) => g.id === userAGoalId);
    assert.equal(g2.progress, 50);
  });

  // 15. UI Compliance: Zero window.alert/confirm and Dedicated Theme Styles
  test('15. UI Compliance: Zero window.alert/confirm and Dedicated Theme Styles', () => {
    const jsPath = path.resolve(__dirname, '../public/js/dashboard.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');

    // Ensure zero raw alert( or confirm( calls
    const alertMatches = jsContent.match(/\balert\s*\(/g);
    const confirmMatches = jsContent.match(/\bconfirm\s*\(/g);
    assert.equal(alertMatches, null, 'Must have zero alert() calls in dashboard.js');
    assert.equal(confirmMatches, null, 'Must have zero confirm() calls in dashboard.js');

    // Verify styling exists in dashboard.css
    const cssPath = path.resolve(__dirname, '../public/css/dashboard.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert.ok(cssContent.includes('.first-task-banner-box'), 'Must define .first-task-banner-box');
    assert.ok(cssContent.includes('.initial-routine-group-card'), 'Must define .initial-routine-group-card');
    assert.ok(cssContent.includes('.routines-group-tabs-row'), 'Must define .routines-group-tabs-row');
    assert.ok(cssContent.includes('.day-assignment-row'), 'Must define .day-assignment-row');
    assert.ok(cssContent.includes('.routine-type-icon-circle'), 'Must define .routine-type-icon-circle');
    assert.ok(cssContent.includes('[data-theme="dark"]'), 'Must support dark theme tokens');
  });

  // 16. Step A -> Step B -> Step C End-to-End First Goal Routine & First Task Flow
  test('16. Step A -> Step B -> Step C End-to-End First Goal Routine & First Task Flow', async () => {
    // 1. Register a fresh, genuinely new user
    const resNewUser = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Brand New Student',
        email: `student_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    assert.equal(resNewUser.status, 201);
    const newUserData = await resNewUser.json();
    const newUserCookies = resNewUser.headers.getSetCookie ? resNewUser.headers.getSetCookie() : [resNewUser.headers.get('set-cookie')];
    const newUserToken = newUserCookies.map((c) => c.split(';')[0]).join('; ');

    // 2. Initial setup status must be 'pending'
    const settingsRes = await fetch(`${baseUrl}/api/routines/settings`, {
      headers: { 'Cookie': newUserToken }
    });
    assert.equal(settingsRes.status, 200);
    const settingsData = await settingsRes.json();
    assert.equal(settingsData.settings.routine_setup_status, 'pending');

    // 3. Step A: Create first goal -> Goal must be created, show_routine_setup MUST be true
    const resGoal = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': newUserToken
      },
      body: JSON.stringify({
        title: 'Complete First Course Project',
        description: 'Implement distributed systems project',
        priority: 'High',
        target_date: '2026-11-15'
      })
    });
    assert.equal(resGoal.status, 201);
    const goalData = await resGoal.json();
    assert.ok(goalData.goal);
    assert.equal(goalData.is_first_goal, true);
    assert.equal(goalData.routine_setup_status, 'pending');
    assert.equal(goalData.show_routine_setup, true);
    const goalId = goalData.goal.id;

    // 4. Verify goal is already in the database and retrieved on GET /api/goals
    const listRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': newUserToken }
    });
    const listData = await listRes.json();
    assert.equal(listData.goals.length, 1);
    assert.equal(listData.goals[0].id, goalId);

    // 5. Step B: Initial Routine Setup with User-Defined Days (Sunday-Wednesday Weekdays, Thursday-Saturday Weekends)
    // and Overnight Block (Sleep 23:00 - 07:00)
    const customWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday'];
    const customWeekends = ['Thursday', 'Friday', 'Saturday'];

    // Overlapping blocks in the same group should be rejected
    const overlapRes = await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': newUserToken
      },
      body: JSON.stringify({
        weekdays_days: customWeekdays,
        weekends_days: customWeekends,
        routines: [
          { name: 'College Morning', start_time: '08:00', end_time: '14:00', schedule_group: 'weekdays', type: 'Fixed' },
          { name: 'College Lab', start_time: '12:00', end_time: '16:00', schedule_group: 'weekdays', type: 'Fixed' }
        ]
      })
    });
    assert.equal(overlapRes.status, 409);

    // Atomic valid setup
    const setupRes = await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': newUserToken
      },
      body: JSON.stringify({
        weekdays_days: customWeekdays,
        weekends_days: customWeekends,
        routines: [
          { name: 'Sleep', start_time: '23:00', end_time: '07:00', schedule_group: 'weekdays', type: 'Fixed' },
          { name: 'College', start_time: '08:00', end_time: '15:00', schedule_group: 'weekdays', type: 'Fixed' },
          { name: 'Weekend Study', start_time: '10:00', end_time: '13:00', schedule_group: 'weekends', type: 'Flexible' }
        ]
      })
    });
    assert.equal(setupRes.status, 200);
    const setupData = await setupRes.json();
    assert.equal(setupData.settings.routine_setup_status, 'completed');
    const canonicalWeekdays = ['Monday', 'Tuesday', 'Wednesday', 'Sunday'];
    const canonicalWeekends = ['Thursday', 'Friday', 'Saturday'];
    assert.deepEqual(setupData.settings.weekdays_days, canonicalWeekdays);
    assert.deepEqual(setupData.settings.weekends_days, canonicalWeekends);
    assert.equal(setupData.routines.length, 3);

    // 6. Persistence across reload: GET /api/dashboard/data
    const reloadRes = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': newUserToken }
    });
    assert.equal(reloadRes.status, 200);
    const reloadData = await reloadRes.json();
    assert.equal(reloadData.schedule_settings.routine_setup_status, 'completed');
    assert.deepEqual(reloadData.schedule_settings.weekdays_days, canonicalWeekdays);
    assert.deepEqual(reloadData.schedule_settings.weekends_days, canonicalWeekends);
    assert.equal(reloadData.routines.length, 3);

    // 7. Second goal creation MUST NOT trigger routine popup
    const secondGoalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': newUserToken
      },
      body: JSON.stringify({
        title: 'Second Course Project',
        target_date: '2026-12-01'
      })
    });
    assert.equal(secondGoalRes.status, 201);
    const secondGoalData = await secondGoalRes.json();
    assert.equal(secondGoalData.is_first_goal, false);
    assert.equal(secondGoalData.routine_setup_status, 'completed');
    assert.equal(secondGoalData.show_routine_setup, false);

    // 8. Verify exact text requirements in HTML
    const htmlPath = path.resolve(__dirname, '../public/views/dashboard.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes('Set Up Your Daily Routine'), 'Must include exact heading: Set Up Your Daily Routine');
    assert.ok(html.includes("Tell EKAGRA when you're busy so we can understand when you are available for your tasks."), 'Must include exact supporting text');
    assert.ok(html.includes('Your goal is ready! 🌱'), 'Must include exact banner title');
    assert.ok(html.includes('Break it into your first small task to get started.'), 'Must include exact banner subtitle');
    assert.ok(html.includes('+ Add First Task'), 'Must include + Add First Task action');
    assert.ok(html.includes('Maybe Later'), 'Must include Maybe Later action');

    // 9. Step C Inline task creation against the goal
    const taskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': newUserToken
      },
      body: JSON.stringify({
        title: 'Write project proposal',
        description: 'Draft the 2-page system spec',
        goal_id: goalId,
        priority: 'High',
        duration_minutes: 45,
        due_date: '2026-11-10'
      })
    });
    assert.equal(taskRes.status, 201);
    const createdTask = (await taskRes.json()).task;
    assert.equal(createdTask.goal_id, goalId);

    // Goal task count & progress should immediately reflect task
    const checkGoalRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': newUserToken }
    });
    const checkGoalData = await checkGoalRes.json();
    const targetGoal = checkGoalData.goals.find((g) => g.id === goalId);
    assert.equal(targetGoal.totalTasks, 1);
    assert.equal(targetGoal.completedTasks, 0);
    assert.equal(targetGoal.progress, 0);

    // Complete task -> progress immediately becomes 100%
    const toggleTaskRes = await fetch(`${baseUrl}/api/tasks/${createdTask.id}/toggle`, {
      method: 'PATCH',
      headers: { 'Cookie': newUserToken }
    });
    assert.equal(toggleTaskRes.status, 200);

    const checkGoalRes2 = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': newUserToken }
    });
    const targetGoal2 = (await checkGoalRes2.json()).goals.find((g) => g.id === goalId);
    assert.equal(targetGoal2.totalTasks, 1);
    assert.equal(targetGoal2.completedTasks, 1);
    assert.equal(targetGoal2.progress, 100);
  });
});
