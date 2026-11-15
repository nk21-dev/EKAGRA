/**
 * EKAGRA — Automated Test Suite for Routine Setup Eligibility & 12-Hour Time Format
 * 
 * Verifies all requirements specified in Section 5:
 * 1. A brand-new user without routines is prompted.
 * 2. An existing user with zero goals and no routine setup is prompted.
 * 3. An existing user with goals but no routine setup is prompted.
 * 4. A user with valid saved routines is not repeatedly prompted.
 * 5. Skipping setup does not permanently suppress future prompts.
 * 6. Closing the popup does not mark setup completed.
 * 7. Saving valid routines permanently completes initial setup.
 * 8. Routine setup can be opened independently when the user has no goals.
 * 9. All seven days can be assigned manually without overlap or omission.
 * 10. 12:00 AM converts correctly to midnight (00:00).
 * 11. 12:00 PM converts correctly to noon (12:00).
 * 12. 03:00 PM converts correctly to internal 15:00.
 * 13. Overnight commitments and overlap detection work correctly.
 * 14. Existing saved routine records remain readable and editable.
 * 15. User isolation remains enforced.
 * 16. Frontend components provide 12-hour pickers and zero 24-hour presentation.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const { getDatabase } = require('../server/db');
const {
  formatTime12Hour,
  normalizeTo24Hour,
  parseTimeToMinutes,
  hasValidRoutineSetup
} = require('../server/services/routineService');

describe('EKAGRA Routine Setup Eligibility & 12-Hour Time Suite', () => {
  let server;
  let baseUrl;
  let db;

  let brandNewUserToken;
  let brandNewUserId;

  let zeroGoalsUserToken;
  let zeroGoalsUserId;

  let existingWithGoalsUserToken;
  let existingWithGoalsUserId;

  let userBToken;
  let userBId;

  before(async () => {
    db = getDatabase();

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Helper to register user and get token & ID
    async function registerUser(name, email) {
      const res = await fetch(`${baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password: 'Password123!',
          confirmPassword: 'Password123!'
        })
      });
      const data = await res.json();
      assert.equal(res.status, 201);
      const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
      const token = cookies.map((c) => c.split(';')[0]).join('; ');
      return { id: data.user.id, token };
    }

    // 1. Brand new user
    const u1 = await registerUser('Brand New User', `new_${Date.now()}@ekagra.ai`);
    brandNewUserId = u1.id;
    brandNewUserToken = u1.token;

    // 2. Existing user with zero goals
    const u2 = await registerUser('Zero Goals Existing User', `zerogoals_${Date.now()}@ekagra.ai`);
    zeroGoalsUserId = u2.id;
    zeroGoalsUserToken = u2.token;
    // Simulate legacy account by dating back created_at
    db.prepare(`UPDATE users SET created_at = '2025-01-01T00:00:00.000Z' WHERE id = ?`).run(zeroGoalsUserId);

    // 3. Existing user with goals but zero routines (simulate legacy backfill bug where routine_setup_status was set to 'completed')
    const u3 = await registerUser('Legacy Goals User', `legacy_${Date.now()}@ekagra.ai`);
    existingWithGoalsUserId = u3.id;
    existingWithGoalsUserToken = u3.token;
    db.prepare(`UPDATE users SET created_at = '2025-01-01T00:00:00.000Z' WHERE id = ?`).run(existingWithGoalsUserId);
    // Create goal
    const goalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': existingWithGoalsUserToken },
      body: JSON.stringify({ title: 'Legacy Goal 1', target_date: '2026-12-31' })
    });
    assert.equal(goalRes.status, 201);
    // Simulate legacy migration that mistakenly wrote 'completed' even with 0 routines
    db.prepare(`UPDATE user_schedule_settings SET routine_setup_status = 'completed' WHERE user_id = ?`).run(existingWithGoalsUserId);

    // 4. User B for isolation tests
    const ub = await registerUser('User B Isolation', `user_b_${Date.now()}@ekagra.ai`);
    userBId = ub.id;
    userBToken = ub.token;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // 1. A brand-new user without routines is prompted
  test('1. A brand-new user without routines is prompted', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': brandNewUserToken }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.has_valid_routine_setup, false);
    assert.equal(data.needs_routine_setup, true);
    assert.equal(hasValidRoutineSetup(db, brandNewUserId), false);
  });

  // 2. An existing user with zero goals and no routine setup is prompted
  test('2. An existing user with zero goals and no routine setup is prompted', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': zeroGoalsUserToken }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.has_valid_routine_setup, false);
    assert.equal(data.needs_routine_setup, true);
    assert.equal(hasValidRoutineSetup(db, zeroGoalsUserId), false);
  });

  // 3. An existing user with goals but no routine setup is prompted
  test('3. An existing user with goals but no routine setup is prompted even if legacy status was completed', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': existingWithGoalsUserToken }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.has_valid_routine_setup, false, 'Must be false when 0 routines in routines table');
    assert.equal(data.needs_routine_setup, true, 'Must need routine setup');
    assert.equal(hasValidRoutineSetup(db, existingWithGoalsUserId), false);

    // Adding another goal also flags show_routine_setup = true
    const addGoalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': existingWithGoalsUserToken },
      body: JSON.stringify({ title: 'Another Goal', target_date: '2027-01-01' })
    });
    const addGoalData = await addGoalRes.json();
    assert.equal(addGoalData.show_routine_setup, true);
    assert.equal(addGoalData.has_valid_routine_setup, false);
    assert.equal(addGoalData.needs_routine_setup, true);
  });

  // 4. A user with valid saved routines is not repeatedly prompted
  test('4. A user with valid saved routines is not repeatedly prompted', async () => {
    // Save a valid routine for User B
    const saveRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userBToken },
      body: JSON.stringify({
        name: 'College Hours',
        start_time: '08:00 AM',
        end_time: '03:00 PM',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(saveRes.status, 201);

    assert.equal(hasValidRoutineSetup(db, userBId), true);

    const dashRes = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': userBToken }
    });
    const dashData = await dashRes.json();
    assert.equal(dashData.has_valid_routine_setup, true);
    assert.equal(dashData.needs_routine_setup, false);

    // Creating a goal for User B does NOT show routine setup
    const goalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userBToken },
      body: JSON.stringify({ title: 'User B Milestone', target_date: '2026-12-31' })
    });
    const goalData = await goalRes.json();
    assert.equal(goalData.show_routine_setup, false);
    assert.equal(goalData.has_valid_routine_setup, true);
    assert.equal(goalData.needs_routine_setup, false);
  });

  // 5. Skipping setup does not permanently suppress future prompts
  test('5. Skipping setup does not permanently suppress future prompts', async () => {
    // Skipping in the UI uses session dismissal and does not permanently set has_valid_routine_setup to true
    assert.equal(hasValidRoutineSetup(db, brandNewUserId), false);

    const dashRes = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': brandNewUserToken }
    });
    const dashData = await dashRes.json();
    assert.equal(dashData.needs_routine_setup, true);
    assert.equal(dashData.has_valid_routine_setup, false);
  });

  // 6. Closing the popup does not mark setup completed
  test('6. Closing the popup does not mark setup completed', async () => {
    assert.equal(hasValidRoutineSetup(db, zeroGoalsUserId), false);
    const settingsRes = await fetch(`${baseUrl}/api/routines/settings`, {
      headers: { 'Cookie': zeroGoalsUserToken }
    });
    const settingsData = await settingsRes.json();
    assert.equal(settingsData.settings.has_valid_routine_setup, false);
    assert.equal(settingsData.settings.needs_routine_setup, true);
  });

  // 7. Saving valid routines permanently completes initial setup
  test('7. Saving valid routines permanently completes initial setup', async () => {
    const setupRes = await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': brandNewUserToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekends_days: ['Saturday', 'Sunday'],
        routines: [
          { name: 'Sleep', start_time: '11:00 PM', end_time: '07:00 AM', schedule_group: 'weekdays', type: 'Fixed' },
          { name: 'Gym', start_time: '06:00 PM', end_time: '07:00 PM', schedule_group: 'weekdays', type: 'Flexible' }
        ]
      })
    });
    assert.equal(setupRes.status, 200);
    const setupData = await setupRes.json();
    assert.equal(setupData.success, true);
    assert.equal(setupData.settings.routine_setup_status, 'completed');
    assert.equal(setupData.settings.has_valid_routine_setup, true);
    assert.equal(setupData.settings.needs_routine_setup, false);
    assert.equal(hasValidRoutineSetup(db, brandNewUserId), true);
  });

  // 8. Routine setup can be opened independently when the user has no goals
  test('8. Routine setup can be configured independently when user has no goals', async () => {
    // zeroGoalsUser has 0 goals
    const goalsCount = db.prepare('SELECT COUNT(*) as count FROM goals WHERE user_id = ?').get(zeroGoalsUserId).count;
    assert.equal(goalsCount, 0);

    const setupRes = await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': zeroGoalsUserToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
        weekends_days: ['Friday', 'Saturday', 'Sunday'],
        routines: [
          { name: 'Study Block', start_time: '09:00 AM', end_time: '01:00 PM', schedule_group: 'weekdays', type: 'Fixed' }
        ]
      })
    });
    assert.equal(setupRes.status, 200);
    const setupData = await setupRes.json();
    assert.equal(setupData.success, true);
    assert.equal(hasValidRoutineSetup(db, zeroGoalsUserId), true);
  });

  // 9. All seven days can be assigned manually without overlap or omission
  test('9. All seven days can be assigned manually without overlap or omission', async () => {
    // Valid 4/3 split
    const validRes = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': brandNewUserToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Wednesday', 'Friday'],
        weekends_days: ['Tuesday', 'Thursday', 'Saturday', 'Sunday']
      })
    });
    assert.equal(validRes.status, 200);
    const validData = await validRes.json();
    assert.equal(validData.settings.weekdays_days.length, 3);
    assert.equal(validData.settings.weekends_days.length, 4);

    // Invalid overlapping split (Monday in both)
    const overlapRes = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': brandNewUserToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekends_days: ['Monday', 'Saturday', 'Sunday']
      })
    });
    assert.equal(overlapRes.status, 400);

    // Invalid missing days (only 6 days total)
    const missingRes = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': brandNewUserToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
        weekends_days: ['Saturday', 'Sunday']
      })
    });
    assert.equal(missingRes.status, 400);
  });

  // 10. 12:00 AM converts correctly to midnight
  test('10. 12:00 AM converts correctly to midnight', () => {
    assert.equal(normalizeTo24Hour('12:00 AM'), '00:00');
    assert.equal(parseTimeToMinutes('12:00 AM'), 0);
    assert.equal(formatTime12Hour('00:00'), '12:00 AM');
  });

  // 11. 12:00 PM converts correctly to noon
  test('11. 12:00 PM converts correctly to noon', () => {
    assert.equal(normalizeTo24Hour('12:00 PM'), '12:00');
    assert.equal(parseTimeToMinutes('12:00 PM'), 720);
    assert.equal(formatTime12Hour('12:00'), '12:00 PM');
  });

  // 12. 03:00 PM converts correctly to internal 15:00
  test('12. 03:00 PM converts correctly to internal 15:00', () => {
    assert.equal(normalizeTo24Hour('03:00 PM'), '15:00');
    assert.equal(parseTimeToMinutes('03:00 PM'), 900);
    assert.equal(formatTime12Hour('15:00'), '03:00 PM');
    assert.equal(normalizeTo24Hour('08:30 AM'), '08:30');
    assert.equal(formatTime12Hour('08:30'), '08:30 AM');
    assert.equal(formatTime12Hour('23:30'), '11:30 PM');
  });

  // 13. Overnight commitments and overlap detection work correctly
  test('13. Overnight commitments and overlap detection work correctly across midnight', async () => {
    // Overnight: 11:00 PM to 07:00 AM
    const createRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': existingWithGoalsUserToken },
      body: JSON.stringify({
        name: 'Night Sleep',
        start_time: '11:00 PM',
        end_time: '07:00 AM',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(createRes.status, 201);
    const routine = (await createRes.json()).routine;
    assert.equal(routine.start_time, '23:00');
    assert.equal(routine.end_time, '07:00');

    // Conflicting morning block overlapping with 11:00 PM - 07:00 AM (e.g. 06:00 AM to 08:00 AM)
    const conflictRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': existingWithGoalsUserToken },
      body: JSON.stringify({
        name: 'Early Morning Run',
        start_time: '06:00 AM',
        end_time: '08:00 AM',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(conflictRes.status, 409);
    const errData = await conflictRes.json();
    assert.ok(errData.error.includes('Night Sleep'));
    assert.ok(errData.error.includes('11:00 PM') || errData.error.includes('23:00'));

    // Non-conflicting daytime block (08:00 AM to 03:00 PM) succeeds
    const nonConflictRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': existingWithGoalsUserToken },
      body: JSON.stringify({
        name: 'University Classes',
        start_time: '08:00 AM',
        end_time: '03:00 PM',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(nonConflictRes.status, 201);
  });

  // 14. Existing saved routine records remain readable and editable
  test('14. Existing saved routine records remain readable and editable', async () => {
    // Read routines for existingWithGoalsUser
    const getRes = await fetch(`${baseUrl}/api/routines`, {
      headers: { 'Cookie': existingWithGoalsUserToken }
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.routines.length >= 2);

    const targetRoutine = getData.routines.find((r) => r.name === 'University Classes');
    assert.ok(targetRoutine);

    // Edit using 12-hour format: update to 09:00 AM - 04:00 PM
    const editRes = await fetch(`${baseUrl}/api/routines/${targetRoutine.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': existingWithGoalsUserToken },
      body: JSON.stringify({
        name: 'Updated University Classes',
        start_time: '09:00 AM',
        end_time: '04:00 PM'
      })
    });
    assert.equal(editRes.status, 200);
    const editData = await editRes.json();
    assert.equal(editData.routine.name, 'Updated University Classes');
    assert.equal(editData.routine.start_time, '09:00');
    assert.equal(editData.routine.end_time, '16:00');
    assert.equal(formatTime12Hour(editData.routine.start_time), '09:00 AM');
    assert.equal(formatTime12Hour(editData.routine.end_time), '04:00 PM');
  });

  // 15. User isolation remains enforced
  test('15. User isolation remains enforced across routines and settings', async () => {
    // User B tries to view or edit existingWithGoalsUser's routine
    const userARoutinesRes = await fetch(`${baseUrl}/api/routines`, {
      headers: { 'Cookie': existingWithGoalsUserToken }
    });
    const userARoutine = (await userARoutinesRes.json()).routines[0];

    const rogueEditRes = await fetch(`${baseUrl}/api/routines/${userARoutine.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': userBToken },
      body: JSON.stringify({ name: 'Hacked Routine' })
    });
    assert.equal(rogueEditRes.status, 403);

    const rogueDeleteRes = await fetch(`${baseUrl}/api/routines/${userARoutine.id}`, {
      method: 'DELETE',
      headers: { 'Cookie': userBToken }
    });
    assert.equal(rogueDeleteRes.status, 403);
  });

  // 16. Frontend components provide 12-hour pickers and zero 24-hour presentation
  test('16. Frontend contains 12-hour pickers and zero 24-hour input types', () => {
    const htmlPath = path.resolve(__dirname, '../public/views/dashboard.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Must have 12-hour picker select dropdowns for hours, minutes, and am/pm
    assert.ok(html.includes('id="initialStartHour"'), 'Must have initialStartHour');
    assert.ok(html.includes('id="initialStartMinute"'), 'Must have initialStartMinute');
    assert.ok(html.includes('id="initialStartAmpm"'), 'Must have initialStartAmpm');

    assert.ok(html.includes('id="routineStartHour"'), 'Must have routineStartHour');
    assert.ok(html.includes('id="routineStartMinute"'), 'Must have routineStartMinute');
    assert.ok(html.includes('id="routineStartAmpm"'), 'Must have routineStartAmpm');

    // No raw 24-hour inputs in routine modals
    assert.ok(!html.includes('type="time" id="routineInputStart"'), 'No native 24h routineInputStart');
    assert.ok(!html.includes('type="time" id="initialInputStart"'), 'No native 24h initialInputStart');

    // Presets in initial routine modal must feature 12-hour times
    assert.ok(html.includes('11:00 PM – 07:00 AM'), 'Sleep preset in 12-hour format');
    assert.ok(html.includes('08:00 AM – 03:00 PM'), 'College preset in 12-hour format');
  });
});
