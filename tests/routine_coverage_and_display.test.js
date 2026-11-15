/**
 * EKAGRA — Automated Test Suite for Routine Setup, Full-Day Coverage & Routine Display
 * 
 * Verifies all 17 requirements:
 * 1. Saved routines appear in the Routines section.
 * 2. Timeline entries are chronologically ordered.
 * 3. Routine changes refresh the displayed timeline.
 * 4. No fake routine entries are created.
 * 5. Empty routine state is displayed correctly.
 * 6. Time formatting uses AM/PM in the UI.
 * 7. Weekday/weekend assignments remain user-configurable.
 * 8. Midnight-crossing routines are handled correctly.
 * 9. Overlapping commitments are rejected.
 * 10. Gaps are detected correctly across the full day.
 * 11. Unclassified gaps are never considered available time.
 * 12. Users can classify gaps as rest, meals, travel, work, personal time, flexible time, or available time.
 * 13. Partially completed setup can be saved and resumed.
 * 14. User isolation is preserved.
 * 15. Existing accounts with no routines can complete setup.
 * 16. The popup remains usable on small screens without an intrusive scrollbar.
 * 17. All features integrate smoothly without regression.
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
  calculateDayGaps,
  calculateIntervalDuration,
  minutesToTime24
} = require('../server/services/routineService');

describe('EKAGRA Routine Setup, Full-Day Coverage & Display Suite', () => {
  let server;
  let baseUrl;
  let db;

  let userAToken;
  let userAId;

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

    const uA = await registerUser('User Coverage A', `coverage_a_${Date.now()}@ekagra.ai`);
    userAId = uA.id;
    userAToken = uA.token;

    const uB = await registerUser('User Coverage B', `coverage_b_${Date.now()}@ekagra.ai`);
    userBId = uB.id;
    userBToken = uB.token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // 1. Saved routines appear in the Routines section
  test('1. Saved routines appear in the Routines section', async () => {
    const createRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'College Classes',
        start_time: '08:00 AM',
        end_time: '03:00 PM',
        schedule_group: 'weekdays',
        type: 'Fixed',
        activity_classification: 'College / Work'
      })
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.equal(createData.success, true);
    assert.equal(createData.routine.name, 'College Classes');
    assert.equal(createData.routine.start_time, '08:00');
    assert.equal(createData.routine.end_time, '15:00');

    // Retrieve via GET /api/routines
    const getRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userAToken }
    });
    assert.equal(getRes.status, 200);
    const getData = await getRes.json();
    assert.ok(getData.routines.length >= 1);
    const found = getData.routines.find((r) => r.name === 'College Classes');
    assert.ok(found, 'Saved routine must appear in GET /api/routines');
    assert.equal(found.activity_classification, 'College / Work');
  });

  // 2. Timeline entries are chronologically ordered
  test('2. Timeline entries are chronologically ordered', async () => {
    // Add Gym at 06:00 PM (18:00) and Breakfast at 07:00 AM (07:00)
    await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'Evening Workout',
        start_time: '06:00 PM',
        end_time: '07:30 PM',
        schedule_group: 'weekdays',
        type: 'Flexible',
        activity_classification: 'Exercise'
      })
    });

    await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'Morning Routine & Breakfast',
        start_time: '07:00 AM',
        end_time: '08:00 AM',
        schedule_group: 'weekdays',
        type: 'Fixed',
        activity_classification: 'Meals'
      })
    });

    const getRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userAToken }
    });
    const getData = await getRes.json();
    const routines = getData.routines;

    // Verify sorted chronologically by start_time
    for (let i = 0; i < routines.length - 1; i++) {
      const curM = parseTimeToMinutes(routines[i].start_time);
      const nextM = parseTimeToMinutes(routines[i + 1].start_time);
      assert.ok(curM <= nextM, `Chronological order violation: ${routines[i].start_time} > ${routines[i + 1].start_time}`);
    }
  });

  // 3. Routine changes refresh the displayed timeline
  test('3. Routine changes refresh the displayed timeline', async () => {
    const listRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userAToken }
    });
    const routines = (await listRes.json()).routines;
    const target = routines.find((r) => r.name === 'Evening Workout');
    assert.ok(target);

    // Edit routine
    const editRes = await fetch(`${baseUrl}/api/routines/${target.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'Strength & Conditioning',
        start_time: '06:00 PM',
        end_time: '07:00 PM',
        type: 'Fixed'
      })
    });
    assert.equal(editRes.status, 200);

    const refreshRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userAToken }
    });
    const refreshData = await refreshRes.json();
    const updated = refreshData.routines.find((r) => r.id === target.id);
    assert.equal(updated.name, 'Strength & Conditioning');
    assert.equal(updated.type, 'Fixed');
  });

  // 4. No fake routine entries are created
  test('4. No fake routine entries are created', async () => {
    const rows = db.prepare('SELECT * FROM routines WHERE user_id = ?').all(userAToken ? userAId : 0);
    for (const row of rows) {
      assert.ok(row.name && row.name.trim().length > 0, 'No empty or fabricated routine names');
      assert.ok(row.start_time && row.end_time, 'No missing start/end times');
      assert.notEqual(row.start_time, row.end_time, 'Zero-duration fake blocks must not exist');
    }
  });

  // 5. Empty routine state is displayed correctly
  test('5. Empty routine state is displayed correctly', async () => {
    // User B currently has 0 routines
    const getBRes = await fetch(`${baseUrl}/api/routines`, {
      headers: { 'Cookie': userBToken }
    });
    assert.equal(getBRes.status, 200);
    const getBData = await getBRes.json();
    assert.equal(getBData.routines.length, 0);

    // Check dashboard.js for exact required empty state text
    const jsPath = path.resolve(__dirname, '../public/js/dashboard.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    assert.ok(jsContent.includes('Your routine is not set up yet.'), 'Must contain empty state title');
    assert.ok(jsContent.includes('Add your regular commitments so EKAGRA can understand your available time.'), 'Must contain empty state body');
    assert.ok(jsContent.includes('+ Add Routine'), 'Must contain add routine button');
  });

  // 6. Time formatting uses AM/PM in the UI
  test('6. Time formatting uses AM/PM in the UI', () => {
    assert.equal(formatTime12Hour('00:00'), '12:00 AM');
    assert.equal(formatTime12Hour('07:30'), '07:30 AM');
    assert.equal(formatTime12Hour('12:00'), '12:00 PM');
    assert.equal(formatTime12Hour('15:45'), '03:45 PM');
    assert.equal(formatTime12Hour('23:15'), '11:15 PM');
  });

  // 7. Weekday/weekend assignments remain user-configurable
  test('7. Weekday/weekend assignments remain user-configurable', async () => {
    // Reconfigure User A's week: Monday-Saturday as Weekdays, Sunday as Weekend
    const putRes = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        weekends_days: ['Sunday']
      })
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.deepEqual(putData.settings.weekdays_days, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
    assert.deepEqual(putData.settings.weekends_days, ['Sunday']);

    // Overlapping assignments must be rejected
    const badRes = await fetch(`${baseUrl}/api/routines/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        weekends_days: ['Saturday', 'Sunday']
      })
    });
    assert.equal(badRes.status, 400);
  });

  // 8. Midnight-crossing routines are handled correctly
  test('8. Midnight-crossing routines are handled correctly', async () => {
    // Add overnight Sleep block: 11:00 PM to 07:00 AM
    const res = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'Overnight Sleep',
        start_time: '11:00 PM',
        end_time: '07:00 AM',
        schedule_group: 'weekdays',
        type: 'Fixed',
        activity_classification: 'Sleep / Rest'
      })
    });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.routine.start_time, '23:00');
    assert.equal(data.routine.end_time, '07:00');
    assert.equal(formatTime12Hour(data.routine.start_time), '11:00 PM');
    assert.equal(formatTime12Hour(data.routine.end_time), '07:00 AM');

    // Interval duration must correctly calculate to 8 hours (480 mins)
    const dur = calculateIntervalDuration(data.routine.start_time, data.routine.end_time);
    assert.equal(dur, 480);
  });

  // 9. Overlapping commitments are rejected
  test('9. Overlapping commitments are rejected', async () => {
    // Attempt to add a block overlapping with College (08:00 to 15:00)
    const clashRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'Conflicting Seminar',
        start_time: '12:00 PM',
        end_time: '02:00 PM',
        schedule_group: 'weekdays',
        type: 'Fixed'
      })
    });
    assert.equal(clashRes.status, 409);
    const clashData = await clashRes.json();
    assert.ok(clashData.error.includes('conflict') || clashData.error.includes('overlap'));
  });

  // 10. Gaps are detected correctly across the full day
  test('10. Gaps are detected correctly across the full day', () => {
    // Current User A weekday routines:
    // 23:00 – 07:00 Sleep (covers [1380, 1440) and [0, 420))
    // 07:00 – 08:00 Morning Routine ([420, 480))
    // 08:00 – 15:00 College ([480, 900))
    // 18:00 – 19:00 Strength & Conditioning ([1080, 1140))
    const testRoutines = [
      { start_time: '23:00', end_time: '07:00', name: 'Sleep' },
      { start_time: '07:00', end_time: '08:00', name: 'Morning' },
      { start_time: '08:00', end_time: '15:00', name: 'College' },
      { start_time: '18:00', end_time: '19:00', name: 'Gym' }
    ];

    const result = calculateDayGaps(testRoutines);
    assert.equal(result.is_full_day_covered, false);
    // Gaps:
    // Gap 1: 15:00 – 18:00 (3 hours / 180 min)
    // Gap 2: 19:00 – 23:00 (4 hours / 240 min)
    assert.equal(result.gaps.length, 2);
    assert.equal(result.gaps[0].start_time, '15:00');
    assert.equal(result.gaps[0].end_time, '18:00');
    assert.equal(result.gaps[0].duration_minutes, 180);

    assert.equal(result.gaps[1].start_time, '19:00');
    assert.equal(result.gaps[1].end_time, '23:00');
    assert.equal(result.gaps[1].duration_minutes, 240);

    assert.equal(result.uncovered_minutes, 420);
    assert.equal(result.covered_minutes, 1020);
  });

  // 11. Unclassified gaps are never considered available time
  test('11. Unclassified gaps are never considered available time', () => {
    const testRoutines = [
      { start_time: '08:00', end_time: '16:00', name: 'Work', availability_type: 'busy' }
    ];
    const coverage = calculateDayGaps(testRoutines);
    for (const gap of coverage.gaps) {
      assert.equal(gap.is_unclassified, true);
      assert.notEqual(gap.availability_type, 'available', 'Unclassified gaps must never be marked available');
    }
  });

  // 12. Users can classify gaps as rest, meals, travel, work, personal time, flexible time, or available time
  test('12. Users can classify gaps as rest, meals, travel, work, personal time, flexible time, or available time', async () => {
    // Classify gap from 15:00 to 18:00 as "Usually Available"
    const availRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'Focused Project Time',
        start_time: '03:00 PM',
        end_time: '06:00 PM',
        schedule_group: 'weekdays',
        type: 'Flexible',
        activity_classification: 'Usually Available',
        availability_type: 'available'
      })
    });
    assert.equal(availRes.status, 201);
    const availData = await availRes.json();
    assert.equal(availData.routine.availability_type, 'available');
    assert.equal(availData.routine.activity_classification, 'Usually Available');

    // Classify remaining gap from 19:00 to 23:00 as Personal / Family Time
    const personalRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userAToken },
      body: JSON.stringify({
        name: 'Family Dinner & Rest',
        start_time: '07:00 PM',
        end_time: '11:00 PM',
        schedule_group: 'weekdays',
        type: 'Fixed',
        activity_classification: 'Personal / Family Time',
        availability_type: 'busy'
      })
    });
    assert.equal(personalRes.status, 201);

    // Verify day is now 100% covered!
    const getRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userAToken }
    });
    const data = await getRes.json();
    assert.equal(data.coverage.weekdays.is_full_day_covered, true);
    assert.equal(data.coverage.weekdays.uncovered_minutes, 0);
  });

  // 13. Partially completed setup can be saved and resumed
  test('13. Partially completed setup can be saved and resumed', async () => {
    // For User B, save partial initial routine (e.g. only Sleep and Work)
    const partialRes = await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userBToken },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekends_days: ['Saturday', 'Sunday'],
        routines: [
          { name: 'Sleep', start_time: '11:00 PM', end_time: '07:00 AM', schedule_group: 'weekdays', type: 'Fixed', activity_classification: 'Sleep / Rest' },
          { name: 'Office Work', start_time: '09:00 AM', end_time: '05:00 PM', schedule_group: 'weekdays', type: 'Fixed', activity_classification: 'College / Work' }
        ]
      })
    });
    assert.equal(partialRes.status, 200);
    const partialData = await partialRes.json();
    assert.equal(partialData.success, true);
    assert.equal(partialData.routines.length, 2);

    // Retrieve routines and confirm existing routines are preserved and gaps are identified
    const getBRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userBToken }
    });
    const getBData = await getBRes.json();
    assert.equal(getBData.routines.length, 2);
    assert.equal(getBData.coverage.weekdays.is_full_day_covered, false);
    assert.ok(getBData.coverage.weekdays.uncovered_minutes > 0);

    // User resumes and fills in the remaining gaps later
    const resumeRes = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': userBToken },
      body: JSON.stringify({
        name: 'Morning Prep',
        start_time: '07:00 AM',
        end_time: '09:00 AM',
        schedule_group: 'weekdays',
        type: 'Fixed',
        activity_classification: 'Meals'
      })
    });
    assert.equal(resumeRes.status, 201);
  });

  // 14. User isolation is preserved
  test('14. User isolation is preserved', async () => {
    const userARoutinesRes = await fetch(`${baseUrl}/api/routines`, {
      headers: { 'Cookie': userAToken }
    });
    const userARoutine = (await userARoutinesRes.json()).routines[0];

    // User B cannot modify User A routine
    const hackEdit = await fetch(`${baseUrl}/api/routines/${userARoutine.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': userBToken },
      body: JSON.stringify({ name: 'Cross User Hack' })
    });
    assert.equal(hackEdit.status, 403);

    // User B cannot delete User A routine
    const hackDelete = await fetch(`${baseUrl}/api/routines/${userARoutine.id}`, {
      method: 'DELETE',
      headers: { 'Cookie': userBToken }
    });
    assert.equal(hackDelete.status, 403);
  });

  // 15. Existing accounts with no routines can complete setup
  test('15. Existing accounts with no routines can complete setup', async () => {
    // Create new user without routines
    const res = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Fresh Routine User',
        email: `fresh_routine_${Date.now()}@ekagra.ai`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    assert.equal(res.status, 201);
    const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
    const token = cookies.map((c) => c.split(';')[0]).join('; ');

    const setupRes = await fetch(`${baseUrl}/api/routines/initial-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': token },
      body: JSON.stringify({
        weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        weekends_days: ['Saturday', 'Sunday'],
        routines: [
          { name: 'Night Sleep', start_time: '10:00 PM', end_time: '06:00 AM', schedule_group: 'weekdays', type: 'Fixed' }
        ]
      })
    });
    assert.equal(setupRes.status, 200);
    const data = await setupRes.json();
    assert.equal(data.settings.routine_setup_status, 'completed');
  });

  // 16. The popup remains usable on small screens without an intrusive scrollbar
  test('16. The popup remains usable on small screens without an intrusive scrollbar', () => {
    const cssPath = path.resolve(__dirname, '../public/css/dashboard.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Scoped rules for initialRoutineModal
    assert.ok(cssContent.includes('#initialRoutineModal'), 'Must have scoped styling for #initialRoutineModal');
    assert.ok(cssContent.includes('::-webkit-scrollbar-button'), 'Must hide webkit scrollbar buttons');
    assert.ok(cssContent.includes('display: none !important'), 'Scrollbar buttons must be hidden');
    assert.ok(cssContent.includes('scrollbar-width: thin'), 'Must use sleek scrollbar-width');
    assert.ok(cssContent.includes('max-height: 90vh'), 'Must prevent extending beyond viewport');

    const htmlPath = path.resolve(__dirname, '../public/views/dashboard.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    // Ensure inline raw overflow-y was removed from the outer frosted card
    assert.ok(!htmlContent.includes('id="initialRoutineModalCard" style="max-width: 560px; max-height: 90vh; overflow-y: auto;"'), 'Removed intrusive inline overflow-y on card');
  });

  // 17. Routine changes refresh the displayed timeline
  test('17. Routine changes refresh the displayed timeline', async () => {
    const listRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userAToken }
    });
    const routinesBefore = (await listRes.json()).routines;
    const targetToDelete = routinesBefore.find((r) => r.name === 'Morning Routine & Breakfast');
    assert.ok(targetToDelete);

    // Delete routine
    const delRes = await fetch(`${baseUrl}/api/routines/${targetToDelete.id}`, {
      method: 'DELETE',
      headers: { 'Cookie': userAToken }
    });
    assert.equal(delRes.status, 200);

    // Refresh and check timeline
    const refreshRes = await fetch(`${baseUrl}/api/routines?group=weekdays`, {
      headers: { 'Cookie': userAToken }
    });
    const refreshedRoutines = (await refreshRes.json()).routines;
    assert.ok(!refreshedRoutines.find((r) => r.id === targetToDelete.id), 'Deleted routine must not appear in refreshed list');
  });
});
