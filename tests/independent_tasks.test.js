const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../server');
const { getDatabase } = require('../server/db');
const { computeTaskPriorityScore } = require('../server/services/schedulingEngine');
const { getUserLearningProfile } = require('../server/services/adaptiveLearningService');

test('EKAGRA Independent vs Goal Tasks End-to-End Suite', async (t) => {
  let server;
  let baseUrl;
  let userToken;
  let userId;
  const db = getDatabase();

  const timestamp = Date.now();
  const userEmail = `indep_user_${timestamp}@ekagra.ai`;
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

  // Step 1: Register User & Establish 24h Routines
  await t.test('1. Setup: Register user & establish 24-hour routines', async () => {
    const signupRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Independent Task User', email: userEmail, password, confirmPassword: password })
    });
    assert.equal(signupRes.status, 201);
    const signupData = await signupRes.json();
    userToken = signupData.token;
    userId = signupData.user.id;
    assert.ok(userToken);
    assert.ok(userId);

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
          { name: 'Fixed Work', start_time: '08:00', end_time: '16:00', schedule_group: 'weekdays', type: 'Fixed', availability_type: 'busy' },
          { name: 'Focus Window', start_time: '16:00', end_time: '24:00', schedule_group: 'weekdays', type: 'Flexible', availability_type: 'available' },
          { name: 'Sleep', start_time: '00:00', end_time: '08:00', schedule_group: 'weekends', type: 'Fixed', availability_type: 'busy' },
          { name: 'Weekend Free', start_time: '08:00', end_time: '24:00', schedule_group: 'weekends', type: 'Flexible', availability_type: 'available' }
        ]
      })
    });
    assert.equal(routineRes.status, 200);
    const routineData = await routineRes.json();
    assert.equal(routineData.success, true);
  });

  let goalId;
  let goalTaskId;
  let independentTaskId;

  // Step 2: Create a Goal and a Goal Task
  await t.test('2. Goal & Goal Task Creation: returns task_type = "goal"', async () => {
    const goalRes = await fetch(`${baseUrl}/api/goals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        title: 'Master TypeScript',
        description: 'Complete TS advanced course',
        priority: 'High',
        target_date: '2027-01-01'
      })
    });
    assert.equal(goalRes.status, 201);
    const goalData = await goalRes.json();
    goalId = goalData.goal.id;
    assert.ok(goalId);

    const taskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        title: 'Learn Generics & Type Narrowing',
        goal_id: goalId,
        priority: 'High',
        duration_minutes: 45
      })
    });
    assert.equal(taskRes.status, 201);
    const taskData = await taskRes.json();
    assert.equal(taskData.success, true);
    assert.equal(taskData.task.task_type, 'goal');
    assert.equal(taskData.task.goal_id, goalId);
    goalTaskId = taskData.task.id;
    assert.ok(goalTaskId);
  });

  // Step 3: Create an Independent Task (No Goal)
  await t.test('3. Independent Task Creation: goal_id = null returns task_type = "independent"', async () => {
    const taskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        title: 'Renew Passport & Submit Documents',
        goal_id: null,
        description: 'Personal errand unrelated to any study goal',
        priority: 'Medium',
        duration_minutes: 30
      })
    });
    assert.equal(taskRes.status, 201);
    const taskData = await taskRes.json();
    assert.equal(taskData.success, true);
    assert.equal(taskData.task.task_type, 'independent');
    assert.equal(taskData.task.goal_id, null);
    assert.equal(taskData.goalProgress, null);
    independentTaskId = taskData.task.id;
    assert.ok(independentTaskId);
  });

  // Step 4: GET /api/tasks verifies task_type and goal titles
  await t.test('4. GET /api/tasks: Cleanly separates goal vs independent tasks', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.tasks.length, 2);

    const goalTask = data.tasks.find((t) => t.id === goalTaskId);
    const indepTask = data.tasks.find((t) => t.id === independentTaskId);

    assert.ok(goalTask);
    assert.equal(goalTask.task_type, 'goal');
    assert.equal(goalTask.goal_title, 'Master TypeScript');

    assert.ok(indepTask);
    assert.equal(indepTask.task_type, 'independent');
    assert.equal(indepTask.goal_id, null);
    assert.equal(indepTask.goal_title, 'Personal');
  });

  // Step 5: Priority Scoring verification
  await t.test('5. Priority Scoring Formula: Base W_goal = 5 and F_fairness = 0 for Independent Tasks', async () => {
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    // High Priority Independent Task due today: W_goal(5) + W_task(30) + U_deadline(40) + F_fairness(0) = 75
    const indepScore = computeTaskPriorityScore(db, userId, {
      goal_id: null,
      priority: 'High',
      due_date: todayStr
    }, null);

    assert.equal(indepScore.wGoal, 5);
    assert.equal(indepScore.wTask, 30);
    assert.equal(indepScore.uDeadline, 40);
    assert.equal(indepScore.fFairness, 0);
    assert.equal(indepScore.totalScore, 75);

    // Goal Task with High Goal & High Task due today: W_goal(50) + W_task(30) + U_deadline(40) = 120
    const goalScore = computeTaskPriorityScore(db, userId, {
      goal_id: goalId,
      priority: 'High',
      due_date: todayStr
    }, { priority: 'High', created_at: new Date().toISOString() });

    assert.equal(goalScore.wGoal, 50);
    assert.equal(goalScore.wTask, 30);
    assert.equal(goalScore.totalScore >= 120, true);
  });

  // Step 6: Schedule generation & GET /api/schedule
  await t.test('6. Schedule & Timeline: Independent task scheduled and labeled cleanly', async () => {
    const autoRes = await fetch(`${baseUrl}/api/schedule/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      }
    });
    assert.equal(autoRes.status, 200);

    const schedRes = await fetch(`${baseUrl}/api/schedule?date=today`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    assert.equal(schedRes.status, 200);
    const schedData = await schedRes.json();
    assert.equal(schedData.success, true);
    assert.equal(schedData.blocks.length >= 2, true);

    const indepBlock = schedData.blocks.find((b) => b.task_id === independentTaskId);
    assert.ok(indepBlock);
    assert.equal(indepBlock.task_type, 'independent');
    assert.equal(indepBlock.goal_id, null);
    assert.equal(indepBlock.goal_title, 'Personal');

    const goalBlock = schedData.blocks.find((b) => b.task_id === goalTaskId);
    assert.ok(goalBlock);
    assert.equal(goalBlock.task_type, 'goal');
    assert.equal(goalBlock.goal_title, 'Master TypeScript');
  });

  // Step 7: Complete Independent Task with verified duration
  await t.test('7. Complete Independent Task: updates ML profile, logs execution, without altering goal progress', async () => {
    const initialGoal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
    assert.equal(initialGoal.progress, 0);

    const compRes = await fetch(`${baseUrl}/api/schedule/complete-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`
      },
      body: JSON.stringify({
        taskId: independentTaskId,
        actualMinutes: 35,
        duration_verified: true
      })
    });
    assert.equal(compRes.status, 200);
    const compData = await compRes.json();
    assert.equal(compData.success, true);

    // Goal progress must still be 0 (unaffected by independent task!)
    const goalAfter = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
    assert.equal(goalAfter.progress, 0);

    // Execution log created with goal_id = null
    const log = db.prepare('SELECT * FROM execution_logs WHERE user_id = ? AND task_id = ?').get(userId, independentTaskId);
    assert.ok(log);
    assert.equal(log.goal_id, null);
    assert.equal(log.duration_verified, 1);
    assert.equal(log.actual_minutes, 35);

    // ML learning profile completed_count incremented
    const profile = getUserLearningProfile(db, userId);
    assert.equal(profile.completed_count, 1);
    assert.equal(profile.calibrated_count, 1);
  });

  // Step 8: Static File UI & Field Integrity
  await t.test('8. UI Integrity: Modal fields, filter pills, and legacy cleanups verified', () => {
    const htmlPath = path.join(__dirname, '../public/views/dashboard.html');
    const jsPath = path.join(__dirname, '../public/js/dashboard.js');
    const cssPath = path.join(__dirname, '../public/css/dashboard.css');

    const html = fs.readFileSync(htmlPath, 'utf8');
    const js = fs.readFileSync(jsPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');

    // HTML checks
    assert.equal(html.includes('id="newTaskTitle"'), true, 'Modal has newTaskTitle');
    assert.equal(html.includes('id="newTaskGoalId"'), true, 'Modal has newTaskGoalId dropdown');
    assert.equal(html.includes('id="newTaskDesc"'), true, 'Modal has newTaskDesc');
    assert.equal(html.includes('id="newTaskPriority"'), true, 'Modal has newTaskPriority');
    assert.equal(html.includes('id="newTaskDuration"'), true, 'Modal has newTaskDuration');
    assert.equal(html.includes('id="newTaskDueDate"'), true, 'Modal has newTaskDueDate');
    assert.equal(html.includes('handleAddTaskFormSubmit'), true, 'Modal form binds handleAddTaskFormSubmit');
    assert.equal(html.includes('id="tasksTypePillsRow"'), true, 'Tasks view has tasksTypePillsRow');
    assert.equal(html.includes('data-type="goal"'), true, 'Tasks view has Goal Tasks filter pill');
    assert.equal(html.includes('data-type="independent"'), true, 'Tasks view has Independent Tasks filter pill');

    // Legacy fields removed
    assert.equal(html.includes('id="newTaskCategory"'), false, 'Legacy newTaskCategory is removed from HTML');
    assert.equal(html.includes('id="newTaskTime"'), false, 'Legacy newTaskTime is removed from HTML');
    assert.equal(js.includes('newTaskCategory'), false, 'Legacy newTaskCategory is removed from JS');
    assert.equal(js.includes('newTaskTime'), false, 'Legacy newTaskTime is removed from JS');

    // JS checks
    assert.equal(js.includes('window.setTaskTypeFilter'), true, 'JS defines window.setTaskTypeFilter');
    assert.equal(js.includes('window.handleAddTaskFormSubmit'), true, 'JS defines window.handleAddTaskFormSubmit');
    assert.equal(js.includes('pill-independent'), true, 'JS renders pill-independent');
    assert.equal(js.includes('pill-goal'), true, 'JS renders pill-goal');

    // CSS checks
    assert.equal(css.includes('.task-type-pill'), true, 'CSS defines .task-type-pill');
    assert.equal(css.includes('.pill-independent'), true, 'CSS defines .pill-independent');
  });
});
