const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { getDatabase } = require('../server/db');
const {
  getIntervalsForBlock,
  doBlocksOverlap,
  checkSingleBlockConflict,
  deduplicateRoutineBlocks,
  calculateIntervalDuration,
  parseTimeToMinutes,
  normalizeTo24Hour
} = require('../server/services/routineService');

const BASE_URL = 'http://localhost:3000';

function makeRequest(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json || data,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

describe('EKAGRA Routine Deduplication & Action Locking Suite', () => {
  test('1. Interval Extraction: handles normal and overnight midnight-crossing blocks', () => {
    const normal = getIntervalsForBlock('09:00', '17:00');
    assert.deepEqual(normal, [{ start: 540, end: 1020 }]);

    const overnight = getIntervalsForBlock('23:00', '07:00');
    assert.deepEqual(overnight, [
      { start: 1380, end: 1440 },
      { start: 0, end: 420 }
    ]);
  });

  test('2. Overlap Detection: allows touching boundaries but flags real overlaps', () => {
    // Adjacent touching at 09:00 (allowed)
    assert.equal(doBlocksOverlap({ start_time: '08:00', end_time: '09:00' }, { start_time: '09:00', end_time: '10:00' }), false);

    // Normal overlapping (conflict)
    assert.equal(doBlocksOverlap({ start_time: '08:00', end_time: '09:30' }, { start_time: '09:00', end_time: '10:00' }), true);

    // Overnight overlapping with morning interval (conflict)
    assert.equal(doBlocksOverlap({ start_time: '23:00', end_time: '07:00' }, { start_time: '06:00', end_time: '08:00' }), true);

    // Overnight overlapping with evening interval (conflict)
    assert.equal(doBlocksOverlap({ start_time: '23:00', end_time: '07:00' }, { start_time: '22:30', end_time: '23:30' }), true);

    // Overnight non-overlapping daytime block (allowed)
    assert.equal(doBlocksOverlap({ start_time: '23:00', end_time: '07:00' }, { start_time: '08:00', end_time: '12:00' }), false);
  });

  test('3. Deduplication Helper: eliminates 7 duplicate copies of same time blocks', () => {
    const duplicatesList = [
      { name: 'Sleep', start_time: '23:00', end_time: '07:00', type: 'Fixed' },
      { name: 'Sleep', start_time: '23:00', end_time: '07:00', type: 'Fixed' },
      { name: 'Sleep', start_time: '23:00', end_time: '07:00', type: 'Fixed' },
      { name: 'Sleep', start_time: '23:00', end_time: '07:00', type: 'Fixed' },
      { name: 'Travel', start_time: '15:00', end_time: '16:00', type: 'Fixed' },
      { name: 'Travel', start_time: '15:00', end_time: '16:00', type: 'Fixed' },
      { name: 'Travel', start_time: '15:00', end_time: '16:00', type: 'Fixed' },
      { name: 'Travel', start_time: '15:00', end_time: '16:00', type: 'Fixed' },
      { name: 'Travel', start_time: '15:00', end_time: '16:00', type: 'Fixed' },
      { name: 'Travel', start_time: '15:00', end_time: '16:00', type: 'Fixed' },
      { name: 'Travel', start_time: '15:00', end_time: '16:00', type: 'Fixed' },
      // Conflicting block that overlaps Sleep
      { name: 'Conflict Block', start_time: '06:00', end_time: '08:00', type: 'Fixed' }
    ];

    const clean = deduplicateRoutineBlocks(duplicatesList);
    assert.equal(clean.length, 2, 'Should keep exactly 2 non-overlapping blocks');
    assert.equal(clean[0].name, 'Sleep');
    assert.equal(clean[1].name, 'Travel');
  });

  test('4. End-to-End: Concurrent copy-group requests produce exactly 1x set of blocks with zero duplicates', async () => {
    const email = `dedup_user_${Date.now()}@ekagra.ai`;
    const password = 'Password123!';

    // Register user
    const signupRes = await makeRequest('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, {
      name: 'Dedup Tester',
      email,
      password,
      confirmPassword: password
    });

    assert.equal(signupRes.status, 201);
    const cookie = signupRes.headers['set-cookie'];
    const authHeaders = {
      'Content-Type': 'application/json',
      'Cookie': Array.isArray(cookie) ? cookie.join('; ') : cookie
    };

    // Save initial weekdays routines: Morning Routine (07:00-08:00), Work (09:00-17:00), Sleep (23:00-07:00)
    const initRes = await makeRequest('/api/routines/initial-setup', {
      method: 'POST',
      headers: authHeaders
    }, {
      weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      weekends_days: ['Saturday', 'Sunday'],
      routines: [
        { name: 'Morning Routine', start_time: '07:00', end_time: '08:00', schedule_group: 'weekdays', type: 'Fixed' },
        { name: 'Work', start_time: '09:00', end_time: '17:00', schedule_group: 'weekdays', type: 'Fixed' },
        { name: 'Sleep', start_time: '23:00', end_time: '07:00', schedule_group: 'weekdays', type: 'Fixed' }
      ]
    });

    assert.equal(initRes.status, 200);
    assert.equal(initRes.data.routines.length, 3);

    // Fire 5 CONCURRENT requests to copy weekdays routines to weekends
    const concurrentCopies = await Promise.all([
      makeRequest('/api/routines/copy-group', { method: 'POST', headers: authHeaders }, { fromGroup: 'weekdays', toGroup: 'weekends' }),
      makeRequest('/api/routines/copy-group', { method: 'POST', headers: authHeaders }, { fromGroup: 'weekdays', toGroup: 'weekends' }),
      makeRequest('/api/routines/copy-group', { method: 'POST', headers: authHeaders }, { fromGroup: 'weekdays', toGroup: 'weekends' }),
      makeRequest('/api/routines/copy-group', { method: 'POST', headers: authHeaders }, { fromGroup: 'weekdays', toGroup: 'weekends' }),
      makeRequest('/api/routines/copy-group', { method: 'POST', headers: authHeaders }, { fromGroup: 'weekdays', toGroup: 'weekends' })
    ]);

    for (const res of concurrentCopies) {
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
    }

    // Query routines for weekends: MUST contain exactly 3 blocks, ZERO duplicates!
    const getWeekends = await makeRequest('/api/routines?group=weekends', {
      method: 'GET',
      headers: authHeaders
    });

    assert.equal(getWeekends.status, 200);
    assert.equal(getWeekends.data.routines.length, 3, 'Weekends must contain exactly 3 blocks, 0 duplicates');
    const weekendNames = getWeekends.data.routines.map((r) => r.name).sort();
    assert.deepEqual(weekendNames, ['Morning Routine', 'Sleep', 'Work']);
  });

  test('5. Single Block Create Guard: rejects overlapping or duplicate routine with 409 Conflict', async () => {
    const email = `conflict_user_${Date.now()}@ekagra.ai`;
    const password = 'Password123!';

    const signupRes = await makeRequest('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, {
      name: 'Conflict Tester',
      email,
      password,
      confirmPassword: password
    });

    const cookie = signupRes.headers['set-cookie'];
    const authHeaders = {
      'Content-Type': 'application/json',
      'Cookie': Array.isArray(cookie) ? cookie.join('; ') : cookie
    };

    // Add first routine: 09:00 - 12:00
    const res1 = await makeRequest('/api/routines', {
      method: 'POST',
      headers: authHeaders
    }, {
      name: 'Deep Focus Morning',
      start_time: '09:00',
      end_time: '12:00',
      schedule_group: 'weekdays',
      type: 'Fixed'
    });
    assert.equal(res1.status, 201);
    assert.ok(Array.isArray(res1.data.routines));
    assert.ok(res1.data.coverage);

    // Attempt to add overlapping routine: 11:00 - 13:00 (overlaps by 1 hour)
    const resOverlap = await makeRequest('/api/routines', {
      method: 'POST',
      headers: authHeaders
    }, {
      name: 'Team Standup',
      start_time: '11:00',
      end_time: '13:00',
      schedule_group: 'weekdays',
      type: 'Fixed'
    });
    assert.equal(resOverlap.status, 409, 'Must reject with HTTP 409 Conflict');
    assert.match(resOverlap.data.error, /overlap/i);

    // Attempt to add identical duplicate routine: 09:00 - 12:00
    const resDuplicate = await makeRequest('/api/routines', {
      method: 'POST',
      headers: authHeaders
    }, {
      name: 'Duplicate Deep Focus',
      start_time: '09:00',
      end_time: '12:00',
      schedule_group: 'weekdays',
      type: 'Fixed'
    });
    assert.equal(resDuplicate.status, 409, 'Must reject duplicate slot with HTTP 409 Conflict');
    assert.match(resDuplicate.data.error, /overlap/i);

    // Adding non-overlapping adjacent block (12:00 - 13:00) succeeds
    const resAdjacent = await makeRequest('/api/routines', {
      method: 'POST',
      headers: authHeaders
    }, {
      name: 'Lunch',
      start_time: '12:00',
      end_time: '13:00',
      schedule_group: 'weekdays',
      type: 'Fixed'
    });
    assert.equal(resAdjacent.status, 201);
  });
});
