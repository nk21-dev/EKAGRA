const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../db');
const { calculateGoalHealth } = require('../services/goalHealth');
const { getGoalTaskStats } = require('../services/goalProgress');

async function getTasksForGoal(db, userId, goalId) {
  try {
    const raw = await db.prepare(`
      SELECT 
        t.id, t.user_id, t.goal_id, t.title, t.description, t.priority, 
        t.duration_minutes, t.due_date, t.time_slot, t.completed, t.created_at, t.updated_at,
        sb.scheduled_date, sb.start_time as scheduled_start_time, sb.end_time as scheduled_end_time, sb.status as schedule_status
      FROM tasks t
      LEFT JOIN scheduled_blocks sb ON t.id = sb.task_id AND sb.status IN ('scheduled', 'completed')
      WHERE t.user_id = ? AND t.goal_id = ?
      ORDER BY t.created_at ASC
    `).all(userId, goalId);
    return (raw || []).map((t) => ({ ...t, completed: Boolean(t.completed) }));
  } catch (e) {
    return [];
  }
}

// GET /api/goals
// Returns all goals for the authenticated user, strictly isolated by user_id
router.get('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;

  const rawGoals = await db.prepare(`
    SELECT id, user_id, title, description, priority, target_date, progress, created_at, updated_at
    FROM goals
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  const dbGoals = rawGoals || [];

  const goals = await Promise.all(dbGoals.map(async (g) => {
    const stats = await getGoalTaskStats(db, userId, g.id);
    const progress = stats.hasTasks ? stats.progress : (g.progress || 0);
    const tasks = await getTasksForGoal(db, userId, g.id);
    return {
      ...g,
      progress,
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      deadline: g.target_date,
      health: calculateGoalHealth({ ...g, progress, totalTasks: stats.totalTasks, tasks }),
      tasks
    };
  }));

  return res.status(200).json({
    success: true,
    goals
  });
});

// GET /api/goals/:id
// Returns a single goal for the authenticated user, strictly isolated by user_id
router.get('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const goalId = req.params.id;

  const goal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  if (!goal) {
    return res.status(404).json({ error: 'Goal not found.' });
  }

  if (goal.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this goal.' });
  }

  const stats = await getGoalTaskStats(db, userId, goal.id);
  const progress = stats.hasTasks ? stats.progress : (goal.progress || 0);
  const tasks = await getTasksForGoal(db, userId, goal.id);

  return res.status(200).json({
    success: true,
    goal: {
      ...goal,
      progress,
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      deadline: goal.target_date,
      health: calculateGoalHealth({ ...goal, progress, totalTasks: stats.totalTasks, tasks }),
      tasks
    }
  });
});

// POST /api/goals
// Creates a new goal for the authenticated user (Progress is strictly task-derived, starts at 0)
router.post('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { title, name, description, priority, target_date, deadline } = req.body;

  const goalTitle = (title || name || '').trim();
  const targetDate = (target_date || deadline || '').trim();
  const goalDesc = (description || '').trim();
  const goalPriority = ['Low', 'Medium', 'High'].includes(priority) ? priority : 'Medium';
  // Progress is never set from frontend input; defaults to 0
  const goalProgress = 0;

  if (!goalTitle) {
    return res.status(400).json({ error: 'Goal Name is required.' });
  }

  if (!targetDate) {
    return res.status(400).json({ error: 'Target Date is required.' });
  }

  const goalId = `g-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO goals (id, user_id, title, description, priority, target_date, progress, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    goalId,
    userId,
    goalTitle,
    goalDesc,
    goalPriority,
    targetDate,
    goalProgress,
    now,
    now
  );

  const createdGoal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  const goalWithHealth = {
    ...createdGoal,
    progress: 0,
    totalTasks: 0,
    completedTasks: 0,
    deadline: createdGoal.target_date,
    health: calculateGoalHealth({ ...createdGoal, progress: 0, totalTasks: 0, tasks: [] }),
    tasks: []
  };

  // Sync to user_app_data activity log if dashboard_state exists
  try {
    const row = await db.prepare('SELECT id, payload FROM user_app_data WHERE user_id = ? AND entity_type = ?').get(userId, 'dashboard_state');
    if (row && row.payload) {
      const state = JSON.parse(row.payload);
      const newActivity = {
        id: `act-${Date.now()}`,
        title: 'Added goal',
        subtitle: goalTitle,
        time: 'Just now'
      };
      state.activities = [newActivity, ...(state.activities || []).slice(0, 9)];
      await db.prepare('UPDATE user_app_data SET payload = ? WHERE id = ?').run(JSON.stringify(state), row.id);
    }
  } catch (err) {
    // Non-fatal activity sync
  }

  const goalCountRow = await db.prepare('SELECT count(*) as count FROM goals WHERE user_id = ?').get(userId);
  const isFirstGoal = goalCountRow ? goalCountRow.count === 1 : true;
  const { getUserScheduleSettings, hasValidRoutineSetup, getRoutineCoverageStatus } = require('../services/routineService');
  const scheduleSettings = await getUserScheduleSettings(db, userId);
  const isValidRoutine = await hasValidRoutineSetup(db, userId);
  const coverageStatus = await getRoutineCoverageStatus(db, userId);
  const showRoutineSetup = !isValidRoutine;

  return res.status(201).json({
    success: true,
    goal: goalWithHealth,
    is_first_goal: isFirstGoal,
    routine_setup_status: scheduleSettings.routine_setup_status,
    has_valid_routine_setup: isValidRoutine,
    needs_routine_setup: !isValidRoutine,
    show_routine_setup: showRoutineSetup,
    routine_coverage_status: coverageStatus,
    routine_coverage_incomplete: coverageStatus.routine_coverage_incomplete,
    is_routine_complete: coverageStatus.is_routine_complete,
    incomplete_group: coverageStatus.incomplete_group,
    routine_warning_message: coverageStatus.message,
    schedule_settings: scheduleSettings
  });
});

// PUT /api/goals/:id
// Updates an existing goal (strict ownership verification)
router.put('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const goalId = req.params.id;

  const existingGoal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  if (!existingGoal) {
    return res.status(404).json({ error: 'Goal not found.' });
  }

  if (existingGoal.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this goal.' });
  }

  const { title, name, description, priority, target_date, deadline, progress } = req.body;

  const updatedTitle = title !== undefined || name !== undefined ? (title || name || '').trim() : existingGoal.title;
  const updatedDesc = description !== undefined ? description.trim() : existingGoal.description;
  const updatedPriority = priority !== undefined && ['Low', 'Medium', 'High'].includes(priority) ? priority : existingGoal.priority;
  const updatedTargetDate = target_date !== undefined || deadline !== undefined ? (target_date || deadline || '').trim() : existingGoal.target_date;

  // Task-derived progress calculation
  const taskStats = await getGoalTaskStats(db, userId, goalId);
  let updatedProgress;
  if (taskStats.hasTasks) {
    // Strictly task-derived: frontend cannot override progress
    updatedProgress = taskStats.progress;
  } else if (progress !== undefined) {
    // Backward compatibility for existing tests without task records
    updatedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  } else {
    updatedProgress = existingGoal.progress || 0;
  }

  if (!updatedTitle) {
    return res.status(400).json({ error: 'Goal Name cannot be empty.' });
  }

  if (!updatedTargetDate) {
    return res.status(400).json({ error: 'Target Date cannot be empty.' });
  }

  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE goals
    SET title = ?, description = ?, priority = ?, target_date = ?, progress = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    updatedTitle,
    updatedDesc,
    updatedPriority,
    updatedTargetDate,
    updatedProgress,
    now,
    goalId,
    userId
  );

  const updatedGoal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  const tasks = await getTasksForGoal(db, userId, goalId);
  const goalWithHealth = {
    ...updatedGoal,
    progress: updatedProgress,
    totalTasks: taskStats.totalTasks,
    completedTasks: taskStats.completedTasks,
    deadline: updatedGoal.target_date,
    health: calculateGoalHealth({ ...updatedGoal, progress: updatedProgress }),
    tasks
  };

  return res.status(200).json({
    success: true,
    goal: goalWithHealth
  });
});

// PATCH /api/goals/:id
// Partial update for goal (alias to update logic)
router.patch('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const goalId = req.params.id;

  const existingGoal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  if (!existingGoal) {
    return res.status(404).json({ error: 'Goal not found.' });
  }

  if (existingGoal.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this goal.' });
  }

  const { title, name, description, priority, target_date, deadline, progress } = req.body;

  const updatedTitle = title !== undefined || name !== undefined ? (title || name || '').trim() : existingGoal.title;
  const updatedDesc = description !== undefined ? description.trim() : existingGoal.description;
  const updatedPriority = priority !== undefined && ['Low', 'Medium', 'High'].includes(priority) ? priority : existingGoal.priority;
  const updatedTargetDate = target_date !== undefined || deadline !== undefined ? (target_date || deadline || '').trim() : existingGoal.target_date;

  // Task-derived progress calculation
  const taskStats = await getGoalTaskStats(db, userId, goalId);
  let updatedProgress;
  if (taskStats.hasTasks) {
    // Strictly task-derived: frontend cannot override progress
    updatedProgress = taskStats.progress;
  } else if (progress !== undefined) {
    // Backward compatibility for existing tests without task records
    updatedProgress = Math.max(0, Math.min(100, Number(progress) || 0));
  } else {
    updatedProgress = existingGoal.progress || 0;
  }

  if (title !== undefined && !updatedTitle) {
    return res.status(400).json({ error: 'Goal Name cannot be empty.' });
  }

  if (target_date !== undefined && !updatedTargetDate) {
    return res.status(400).json({ error: 'Target Date cannot be empty.' });
  }

  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE goals
    SET title = ?, description = ?, priority = ?, target_date = ?, progress = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    updatedTitle,
    updatedDesc,
    updatedPriority,
    updatedTargetDate,
    updatedProgress,
    now,
    goalId,
    userId
  );

  const updatedGoalPatch = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  const tasks = await getTasksForGoal(db, userId, goalId);
  const patchWithHealth = {
    ...updatedGoalPatch,
    progress: updatedProgress,
    totalTasks: taskStats.totalTasks,
    completedTasks: taskStats.completedTasks,
    deadline: updatedGoalPatch.target_date,
    health: calculateGoalHealth({ ...updatedGoalPatch, progress: updatedProgress }),
    tasks
  };

  return res.status(200).json({
    success: true,
    goal: patchWithHealth
  });
});

// DELETE /api/goals/:id
// Deletes a goal (strict ownership verification)
router.delete('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const goalId = req.params.id;

  const existingGoal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  if (!existingGoal) {
    return res.status(404).json({ error: 'Goal not found.' });
  }

  if (existingGoal.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this goal.' });
  }

  await db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(goalId, userId);

  return res.status(200).json({
    success: true,
    message: 'Goal deleted successfully.'
  });
});

module.exports = router;
