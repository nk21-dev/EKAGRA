const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../server');
const { getDatabase } = require('../server/db');

describe('EKAGRA Goal Creation & Data Model Suite (Zero Category & User Isolation)', () => {
  let server;
  let baseUrl;
  let userAToken;
  let userBToken;
  let userAGoalId;

  before(async () => {
    // Start test server on dynamic port
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
        name: 'User A',
        email: `user_a_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    const dataA = await resA.json();
    assert.equal(resA.status, 201);
    const cookiesA = resA.headers.getSetCookie ? resA.headers.getSetCookie() : [resA.headers.get('set-cookie')];
    userAToken = cookiesA.map((c) => c.split(';')[0]).join('; ');

    // Register User B
    const resB = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'User B',
        email: `user_b_${Date.now()}@example.com`,
        password: 'Password123!',
        confirmPassword: 'Password123!'
      })
    });
    const dataB = await resB.json();
    assert.equal(resB.status, 201);
    const cookiesB = resB.headers.getSetCookie ? resB.headers.getSetCookie() : [resB.headers.get('set-cookie')];
    userBToken = cookiesB.map((c) => c.split(';')[0]).join('; ');
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('1. Database Schema: goals table exists and contains NO category column', () => {
    const db = getDatabase();
    const columns = db.prepare("PRAGMA table_info('goals')").all();
    const columnNames = columns.map((col) => col.name);
    
    assert.ok(columnNames.includes('id'), 'Must have id');
    assert.ok(columnNames.includes('user_id'), 'Must have user_id');
    assert.ok(columnNames.includes('title'), 'Must have title');
    assert.ok(columnNames.includes('description'), 'Must have description');
    assert.ok(columnNames.includes('priority'), 'Must have priority');
    assert.ok(columnNames.includes('target_date'), 'Must have target_date');
    assert.ok(columnNames.includes('progress'), 'Must have progress');
    assert.ok(columnNames.includes('created_at'), 'Must have created_at');
    assert.ok(columnNames.includes('updated_at'), 'Must have updated_at');
    
    // Explicitly verify Category is NOT in the database columns
    assert.equal(columnNames.includes('category'), false, 'Database must NOT contain category column');
    assert.equal(columnNames.includes('domain'), false, 'Database must NOT contain domain column');
    assert.equal(columnNames.includes('goal_type'), false, 'Database must NOT contain goal_type column');
  });

  test('2. Goal Creation: Succeeds with only required fields (Goal Name & Target Date)', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Learn Spanish',
        target_date: '2026-12-31'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.success, true);
    assert.equal(data.goal.title, 'Learn Spanish');
    assert.equal(data.goal.target_date, '2026-12-31');
    assert.equal(data.goal.description, ''); // optional defaults to empty string
    assert.equal(data.goal.priority, 'Medium'); // optional defaults to Medium
    assert.equal(data.goal.progress, 0); // defaults to 0
    assert.equal(data.goal.category, undefined, 'Goal object must have no category');

    userAGoalId = data.goal.id;
  });

  test('3. Goal Creation: Succeeds with optional description and priority', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Build Distributed Key-Value Store',
        description: 'Implement Raft consensus algorithm from scratch in Rust.',
        priority: 'High',
        target_date: '2027-01-15'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.goal.title, 'Build Distributed Key-Value Store');
    assert.equal(data.goal.description, 'Implement Raft consensus algorithm from scratch in Rust.');
    assert.equal(data.goal.priority, 'High');
    assert.equal(data.goal.target_date, '2027-01-15');
  });

  test('4. Goal Creation Validation: Rejects when Goal Name is missing', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        target_date: '2026-12-31'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('Goal Name is required'));
  });

  test('5. Goal Creation Validation: Rejects when Target Date is missing', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Some Unscheduled Goal'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 400);
    assert.ok(data.error.includes('Target Date is required'));
  });

  test('6. User Isolation: GET /api/goals strictly isolates User A and User B', async () => {
    // User B creates their own goal
    const resB = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userBToken
      },
      body: JSON.stringify({
        title: 'Run a Half Marathon',
        target_date: '2026-11-20',
        priority: 'Low'
      })
    });
    assert.equal(resB.status, 201);

    // Fetch User A's goals
    const getA = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const dataA = await getA.json();
    assert.equal(dataA.goals.length, 2);
    const titlesA = dataA.goals.map((g) => g.title);
    assert.ok(titlesA.includes('Learn Spanish'));
    assert.ok(titlesA.includes('Build Distributed Key-Value Store'));
    assert.ok(!titlesA.includes('Run a Half Marathon'), 'User A must NOT see User B goals');

    // Fetch User B's goals
    const getB = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userBToken }
    });
    const dataB = await getB.json();
    assert.equal(dataB.goals.length, 1);
    assert.equal(dataB.goals[0].title, 'Run a Half Marathon');
    assert.ok(!dataB.goals.some((g) => titlesA.includes(g.title)), 'User B must NOT see User A goals');
  });

  test('7. User Isolation: User B CANNOT edit User A goal (PUT /api/goals/:id)', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${userAGoalId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userBToken // User B trying to edit User A's goal
      },
      body: JSON.stringify({
        title: 'Malicious Overwrite',
        target_date: '2026-12-31'
      })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('Unauthorized'));

    // Verify goal was not modified in database
    const db = getDatabase();
    const goalInDb = db.prepare('SELECT title FROM goals WHERE id = ?').get(userAGoalId);
    assert.equal(goalInDb.title, 'Learn Spanish');
  });

  test('8. Goal Edit: User A can successfully edit their own goal', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${userAGoalId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Learn Spanish Fluently',
        description: 'Complete B2 level certification in Madrid.',
        priority: 'High',
        target_date: '2027-06-30',
        progress: 45
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.goal.title, 'Learn Spanish Fluently');
    assert.equal(data.goal.description, 'Complete B2 level certification in Madrid.');
    assert.equal(data.goal.priority, 'High');
    assert.equal(data.goal.target_date, '2027-06-30');
    assert.equal(data.goal.progress, 45);
  });

  test('9. User Isolation: User B CANNOT delete User A goal (DELETE /api/goals/:id)', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${userAGoalId}`, {
      method: 'DELETE',
      headers: {
        'Cookie': userBToken // User B trying to delete User A's goal
      }
    });

    assert.equal(res.status, 403);

    // Verify goal still exists in database
    const db = getDatabase();
    const goalInDb = db.prepare('SELECT id FROM goals WHERE id = ?').get(userAGoalId);
    assert.ok(goalInDb);
  });

  test('10. Goal Deletion: User A can successfully delete their own goal', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${userAGoalId}`, {
      method: 'DELETE',
      headers: {
        'Cookie': userAToken
      }
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);

    // Verify goal is gone from database
    const db = getDatabase();
    const goalInDb = db.prepare('SELECT id FROM goals WHERE id = ?').get(userAGoalId);
    assert.equal(goalInDb, undefined);
  });

  test('11. Dashboard /api/dashboard/data integrates seamlessly with goals table', async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': userAToken }
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.goals.length, 1);
    assert.equal(data.goals[0].title, 'Build Distributed Key-Value Store');
    assert.equal(data.goals[0].category, undefined, 'Dashboard goals must not have category');
  });
});
