const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const { getDatabase } = require('../server/db');

describe('EKAGRA Task-Derived Goal Progress Suite', () => {
  let server;
  let baseUrl;
  let userAToken;
  let userBToken;
  let userAId;
  let userBId;

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
        name: 'Progress User A',
        email: `prog_user_a_${Date.now()}@example.com`,
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
        name: 'Progress User B',
        email: `prog_user_b_${Date.now()}@example.com`,
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

  test('1. Goal with zero tasks calculates to 0% progress', async () => {
    const createRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Zero Tasks Goal',
        target_date: '2026-12-31',
        description: 'Goal with no tasks attached',
        priority: 'High'
      })
    });
    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.equal(createData.goal.progress, 0);

    const getRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const getData = await getRes.json();
    const goal = getData.goals.find((g) => g.id === createData.goal.id);
    assert.ok(goal);
    assert.equal(goal.progress, 0);
    assert.equal(goal.totalTasks, 0);
    assert.equal(goal.completedTasks, 0);
  });

  test('2. Goal with 5 tasks, 0 completed calculates to 0% progress', async () => {
    const db = getDatabase();
    const createRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Goal with 5 Uncompleted Tasks',
        target_date: '2026-12-31',
        description: '5 tasks none done',
        priority: 'Medium'
      })
    });
    assert.equal(createRes.status, 201);
    const { goal } = await createRes.json();

    // Insert 5 tasks, none completed
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(`task-g2-${i}-${Date.now()}`, userAId, goal.id, `Task ${i}`, 0, 'Medium');
    }

    const getRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const getData = await getRes.json();
    const found = getData.goals.find((g) => g.id === goal.id);
    assert.ok(found);
    assert.equal(found.totalTasks, 5);
    assert.equal(found.completedTasks, 0);
    assert.equal(found.progress, 0);
  });

  test('3. Goal with 5 tasks, 2 completed calculates to 40% progress', async () => {
    const db = getDatabase();
    const createRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Goal with 5 Tasks (2 Completed)',
        target_date: '2026-12-31',
        description: '2 completed out of 5',
        priority: 'High'
      })
    });
    assert.equal(createRes.status, 201);
    const { goal } = await createRes.json();

    // Insert 5 tasks: 2 completed (1), 3 pending (0)
    for (let i = 1; i <= 5; i++) {
      const isCompleted = i <= 2 ? 1 : 0;
      db.prepare(`
        INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(`task-g3-${i}-${Date.now()}`, userAId, goal.id, `Task ${i}`, isCompleted, 'Medium');
    }

    const getRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const getData = await getRes.json();
    const found = getData.goals.find((g) => g.id === goal.id);
    assert.ok(found);
    assert.equal(found.totalTasks, 5);
    assert.equal(found.completedTasks, 2);
    assert.equal(found.progress, 40);
  });

  test('4. Goal with 5 tasks, 5 completed calculates to 100% progress', async () => {
    const db = getDatabase();
    const createRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Goal with 5 Tasks (5 Completed)',
        target_date: '2026-12-31',
        description: '5 completed out of 5',
        priority: 'High'
      })
    });
    assert.equal(createRes.status, 201);
    const { goal } = await createRes.json();

    // Insert 5 tasks: all 5 completed (1)
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(`task-g4-${i}-${Date.now()}`, userAId, goal.id, `Task ${i}`, 1, 'Medium');
    }

    const getRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const getData = await getRes.json();
    const found = getData.goals.find((g) => g.id === goal.id);
    assert.ok(found);
    assert.equal(found.totalTasks, 5);
    assert.equal(found.completedTasks, 5);
    assert.equal(found.progress, 100);
    assert.equal(found.health, 'On Track');
  });

  test("5. User cannot affect another user's goal progress (User Isolation)", async () => {
    const db = getDatabase();

    // User A creates a goal
    const resA = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: "User A's Protected Goal",
        target_date: '2026-12-31',
        priority: 'High'
      })
    });
    const goalA = (await resA.json()).goal;

    // User A has 2 tasks: 1 completed (1/2 = 50%)
    db.prepare(`
      INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(`task-iso-a1-${Date.now()}`, userAId, goalA.id, 'User A Task 1', 1, 'High');
    db.prepare(`
      INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(`task-iso-a2-${Date.now()}`, userAId, goalA.id, 'User A Task 2', 0, 'High');

    // Malicious User B tries to insert tasks pointing to goalA.id
    db.prepare(`
      INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(`task-malicious-b1-${Date.now()}`, userBId, goalA.id, 'User B Malicious Task', 1, 'Low');
    db.prepare(`
      INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(`task-malicious-b2-${Date.now()}`, userBId, goalA.id, 'User B Malicious Task 2', 1, 'Low');

    // Check User A's goal progress: MUST strictly be 50% (1/2), ignoring User B's tasks completely!
    const getResA = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const dataA = await getResA.json();
    const foundA = dataA.goals.find((g) => g.id === goalA.id);
    assert.equal(foundA.totalTasks, 2, "User A should only see their own 2 tasks");
    assert.equal(foundA.completedTasks, 1, "User A should only count their own completed task");
    assert.equal(foundA.progress, 50, "User A progress must remain strictly 50%");

    // Verify User B cannot access User A's goal through PUT or GET
    const putResB = await fetch(`${baseUrl}/api/goals/${goalA.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userBToken
      },
      body: JSON.stringify({ title: 'Hacked Goal', target_date: '2026-12-31' })
    });
    assert.equal(putResB.status, 403, "User B must not be able to modify User A's goal");
  });

  test('6. Frontend cannot manually override goal progress', async () => {
    const db = getDatabase();

    // Test POST: client supplies progress: 85 -> backend overrides to 0
    const postRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Untrusted Progress Goal',
        target_date: '2026-12-31',
        progress: 85
      })
    });
    assert.equal(postRes.status, 201);
    const postData = await postRes.json();
    assert.equal(postData.goal.progress, 0, 'POST must ignore client progress and default to 0');

    // Add 4 tasks to this goal: 1 completed -> derived progress = 25%
    for (let i = 1; i <= 4; i++) {
      db.prepare(`
        INSERT INTO tasks (id, user_id, goal_id, title, completed, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(`task-override-${i}-${Date.now()}`, userAId, postData.goal.id, `Task ${i}`, i === 1 ? 1 : 0, 'Medium');
    }

    // Test PUT: client attempts to force progress: 99 on a goal with tasks -> backend rejects and enforces 25%
    const putRes = await fetch(`${baseUrl}/api/goals/${postData.goal.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Untrusted Progress Goal Updated',
        target_date: '2026-12-31',
        progress: 99
      })
    });
    assert.equal(putRes.status, 200);
    const putData = await putRes.json();
    assert.equal(putData.goal.progress, 25, 'PUT must reject manual override and enforce task-derived 25%');

    // Confirm via GET
    const getRes = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const getData = await getRes.json();
    const found = getData.goals.find((g) => g.id === postData.goal.id);
    assert.equal(found.progress, 25);
  });

  test('7. Edit Goal modal contains no progress input/slider and contains read-only indicator', () => {
    const htmlPath = path.join(__dirname, '..', 'public', 'views', 'dashboard.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Extract editGoalModal content
    const modalMatch = html.match(/id="editGoalModal"[\s\S]*?<\/form>\s*<\/div>\s*<\/div>/);
    assert.ok(modalMatch, 'editGoalModal must exist in dashboard.html');
    const modalContent = modalMatch[0];

    // Must NOT contain input type="range"
    assert.ok(
      !modalContent.includes('type="range"'),
      'editGoalModal must not contain type="range" slider'
    );
    assert.ok(
      !modalContent.includes('id="editGoalProgress"'),
      'editGoalModal must not contain editable editGoalProgress input'
    );

    // Must contain read-only progress display elements
    assert.ok(
      modalContent.includes('id="editGoalProgressVal"'),
      'editGoalModal must contain read-only editGoalProgressVal text element'
    );
    assert.ok(
      modalContent.includes('id="editGoalProgressBarFill"'),
      'editGoalModal must contain read-only editGoalProgressBarFill meter fill'
    );

    // Must contain subtle explanatory line
    assert.ok(
      modalContent.includes('Progress is calculated from completed tasks.'),
      'editGoalModal must contain "Progress is calculated from completed tasks." note'
    );
  });

  test('8. Dashboard API returns task-derived progress and task counts', async () => {
    const dashRes = await fetch(`${baseUrl}/api/dashboard/data`, {
      headers: { 'Cookie': userAToken }
    });
    assert.equal(dashRes.status, 200);
    const dashData = await dashRes.json();
    assert.ok(Array.isArray(dashData.goals));

    for (const g of dashData.goals) {
      assert.ok(typeof g.progress === 'number');
      assert.ok(typeof g.totalTasks === 'number');
      assert.ok(typeof g.completedTasks === 'number');
    }
  });
});
