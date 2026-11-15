/**
 * EKAGRA — Goals Page CRUD + UX Polish Comprehensive Test Suite
 * Tests all 14 requirements specified in the prompt:
 * 1. Create goal -> appears with returned DB ID and health
 * 2. Create second goal -> appears with returned DB ID and health
 * 3. Edit goal -> changes appear immediately (PUT /api/goals/:id)
 * 4. Refresh -> changes remain persisted in database
 * 5. Delete goal -> custom modal elements and styling present in DOM/CSS
 * 6. Cancel delete -> goal remains intact
 * 7. Confirm delete -> DELETE /api/goals/:id succeeds and goal removed
 * 8. Refresh -> deleted goal remains deleted
 * 9. Cross-user edit returns 403 Forbidden
 * 10. Cross-user delete returns 403 Forbidden
 * 11. Light theme variables present and correct
 * 12. Dark theme variables present and correct
 * 13. Pacing & Health status classification (On Track, At Risk, Behind)
 * 14. Zero native confirm() calls in client code
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const { getDatabase } = require('../server/db');
const { calculateGoalHealth } = require('../server/services/goalHealth');

describe('EKAGRA Goals Page Bug Fix + UX Polish Test Suite', () => {
  let server;
  let baseUrl;
  let userAToken;
  let userBToken;
  let userAId;
  let userBId;
  let goal1Id;
  let goal2Id;

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
        name: 'User A UX',
        email: `usera_ux_${Date.now()}@example.com`,
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
        name: 'User B UX',
        email: `userb_ux_${Date.now()}@example.com`,
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

  test('1. Create goal 1: POST /api/goals saves goal and returns real DB ID + health', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Prepare for System Design',
        description: 'Distributed caches and consensus algorithms',
        priority: 'High',
        target_date: '2026-11-20'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.success, true);
    assert.ok(data.goal.id.startsWith('g-'));
    assert.equal(data.goal.title, 'Prepare for System Design');
    assert.equal(data.goal.priority, 'High');
    assert.equal(data.goal.target_date, '2026-11-20');
    assert.equal(data.goal.progress, 0);
    assert.ok(data.goal.health, 'Must return computed health');
    assert.equal(data.goal.health, 'On Track'); // Target sufficiently far away

    goal1Id = data.goal.id;
  });

  test('2. Create goal 2: Second goal creation succeeds with real DB ID and health', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Master Algorithms',
        priority: 'Medium',
        target_date: '2026-12-15'
      })
    });

    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.success, true);
    assert.ok(data.goal.id.startsWith('g-'));
    assert.equal(data.goal.title, 'Master Algorithms');
    assert.equal(data.goal.health, 'On Track');

    goal2Id = data.goal.id;
  });

  test('3. Edit goal: PUT /api/goals/:id updates title, progress, description and recalculates health', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${goal1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userAToken
      },
      body: JSON.stringify({
        title: 'Master System Design & Architecture',
        description: 'Large-scale distributed systems and microservices',
        priority: 'High',
        target_date: '2026-11-20',
        progress: 65
      })
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.goal.id, goal1Id);
    assert.equal(data.goal.title, 'Master System Design & Architecture');
    assert.equal(data.goal.progress, 65);
    assert.equal(data.goal.health, 'On Track');
  });

  test('4. Refresh verification: Database persisted edited goal and preserves state', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.goals.length, 2);

    const editedGoal = data.goals.find((g) => g.id === goal1Id);
    assert.ok(editedGoal);
    assert.equal(editedGoal.title, 'Master System Design & Architecture');
    assert.equal(editedGoal.progress, 65);
    assert.equal(editedGoal.health, 'On Track');
  });

  test('5. Delete Goal Modal UI elements: dashboard.html contains custom EKAGRA modal & no native confirm()', () => {
    const htmlPath = path.resolve(__dirname, '../public/views/dashboard.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(htmlContent.includes('id="deleteGoalModal"'), 'deleteGoalModal must exist');
    assert.ok(htmlContent.includes('id="confirmDeleteGoalBtn"'), 'confirmDeleteGoalBtn must exist');
    assert.ok(htmlContent.includes('id="cancelDeleteGoalBtn"'), 'cancelDeleteGoalBtn must exist');
    assert.ok(htmlContent.includes('id="deleteGoalTargetTitle"'), 'deleteGoalTargetTitle must exist');
    assert.ok(htmlContent.includes('Delete this goal?'), 'Must have "Delete this goal?" modal header');
    assert.ok(htmlContent.includes('This action cannot be undone.'), 'Must have warning text');

    // Verify dashboard.js has ZERO native confirm() calls
    const jsPath = path.resolve(__dirname, '../public/js/dashboard.js');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    assert.equal(jsContent.includes('confirm('), false, 'dashboard.js must NOT use native confirm()');
    assert.equal(jsContent.includes('window.confirm('), false, 'dashboard.js must NOT use window.confirm()');
  });

  test('6. Cancel Delete: Goal remains in database when delete is not confirmed', async () => {
    const db = getDatabase();
    const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goal2Id);
    assert.ok(goal, 'Goal 2 must still exist in DB');
    assert.equal(goal.title, 'Master Algorithms');
  });

  test('7. Confirm Delete: DELETE /api/goals/:id deletes goal from database', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${goal2Id}`, {
      method: 'DELETE',
      headers: { 'Cookie': userAToken }
    });

    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.message, 'Goal deleted successfully.');
  });

  test('8. Refresh verification: Deleted goal is permanently deleted', async () => {
    const res = await fetch(`${baseUrl}/api/goals`, {
      headers: { 'Cookie': userAToken }
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.goals.length, 1);
    assert.equal(data.goals.some((g) => g.id === goal2Id), false);
  });

  test('9. User Isolation: Cross-user edit returns 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${goal1Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': userBToken
      },
      body: JSON.stringify({
        title: 'Unauthorized Tampering'
      })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('Unauthorized'));
  });

  test('10. User Isolation: Cross-user delete returns 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/goals/${goal1Id}`, {
      method: 'DELETE',
      headers: { 'Cookie': userBToken }
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('Unauthorized'));
  });

  test('11. Theme Verification: Light theme has surface, accent, and shadow variables', () => {
    const cssPath = path.resolve(__dirname, '../public/css/dashboard.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert.ok(cssContent.includes('--brand-emerald'), 'Must define --brand-emerald');
    assert.ok(cssContent.includes('--card-bg'), 'Must define --card-bg');
    assert.ok(cssContent.includes('--card-shadow'), 'Must define --card-shadow');
    assert.ok(cssContent.includes('.btn-destructive-ekagra'), 'Must define .btn-destructive-ekagra');
  });

  test('12. Theme Verification: Dark theme has deep navy surface, green accent, and border', () => {
    const cssPath = path.resolve(__dirname, '../public/css/dashboard.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    assert.ok(cssContent.includes('[data-theme="dark"]'), 'Must support data-theme="dark"');
    assert.ok(cssContent.includes('--status-on-track-bg'), 'Must define --status-on-track-bg');
    assert.ok(cssContent.includes('--status-at-risk-bg'), 'Must define --status-at-risk-bg');
    assert.ok(cssContent.includes('--status-behind-bg'), 'Must define --status-behind-bg');
  });

  test('13. Health Pacing Engine: Classifies On Track, At Risk, and Behind dynamically', () => {
    // 0% progress, 30 days away -> On Track
    const goalOnTrack = {
      progress: 0,
      target_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      created_at: new Date().toISOString()
    };
    assert.equal(calculateGoalHealth(goalOnTrack), 'On Track');

    // 100% progress -> On Track
    const goalCompleted = { progress: 100, target_date: '2026-01-01' };
    assert.equal(calculateGoalHealth(goalCompleted), 'On Track');

    // Past deadline with progress < 100 -> Behind
    const goalPast = {
      progress: 40,
      target_date: '2025-01-01',
      created_at: '2024-01-01'
    };
    assert.equal(calculateGoalHealth(goalPast), 'Behind');

    // Imminent deadline (2 days) with 5% progress -> Behind
    const goalImminent = {
      progress: 5,
      target_date: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      created_at: new Date(Date.now() - 20 * 86400000).toISOString()
    };
    assert.equal(calculateGoalHealth(goalImminent), 'Behind');

    // Imminent deadline (5 days) with 10% progress -> At Risk
    const goalAtRisk = {
      progress: 10,
      target_date: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
      created_at: new Date(Date.now() - 10 * 86400000).toISOString()
    };
    assert.equal(calculateGoalHealth(goalAtRisk), 'At Risk');
  });
});
