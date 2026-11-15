const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../db');
const { getGoalTaskStats } = require('../services/goalProgress');
const { calculateGoalHealth } = require('../services/goalHealth');
const {
  estimateTaskDuration,
  testAiConnection,
  getUserAiSettings,
  saveUserAiSettings,
  deleteUserApiKey
} = require('../services/durationEstimationService');

async function syncGoalProgress(db, userId, goalId) {
  if (!goalId) return null;
  const stats = await getGoalTaskStats(db, userId, goalId);
  const goal = await db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId);
  if (!goal) return stats;

  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE goals
    SET progress = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(stats.progress, now, goalId, userId);

  return {
    ...stats,
    health: calculateGoalHealth({ ...goal, progress: stats.progress })
  };
}

// GET /api/tasks
// Returns tasks for the authenticated user, optionally filtered by goal_id, enriched with parent goal & scheduled slot
router.get('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { goal_id } = req.query;

  let tasks;
  if (goal_id) {
    tasks = await db.prepare(`
      SELECT 
        t.id, t.user_id, t.goal_id, t.title, t.description, t.priority, 
        t.duration_minutes, t.due_date, t.time_slot, t.completed, t.created_at, t.updated_at,
        COALESCE(g.title, 'Personal') as goal_title, 
        COALESCE(g.title, 'Personal') as goal_name, 
        g.priority as goal_priority,
        sb.scheduled_date, sb.start_time as scheduled_start_time, sb.end_time as scheduled_end_time, sb.status as schedule_status
      FROM tasks t
      LEFT JOIN goals g ON t.goal_id = g.id
      LEFT JOIN (
        SELECT task_id, scheduled_date, start_time, end_time, status
        FROM scheduled_blocks
        WHERE status IN ('scheduled', 'completed')
        GROUP BY task_id
      ) sb ON t.id = sb.task_id
      WHERE t.user_id = ? AND t.goal_id = ?
      ORDER BY t.created_at ASC
    `).all(userId, goal_id);
  } else {
    tasks = await db.prepare(`
      SELECT 
        t.id, t.user_id, t.goal_id, t.title, t.description, t.priority, 
        t.duration_minutes, t.due_date, t.time_slot, t.completed, t.created_at, t.updated_at,
        COALESCE(g.title, 'Personal') as goal_title, 
        COALESCE(g.title, 'Personal') as goal_name, 
        g.priority as goal_priority,
        sb.scheduled_date, sb.start_time as scheduled_start_time, sb.end_time as scheduled_end_time, sb.status as schedule_status
      FROM tasks t
      LEFT JOIN goals g ON t.goal_id = g.id
      LEFT JOIN (
        SELECT task_id, scheduled_date, start_time, end_time, status
        FROM scheduled_blocks
        WHERE status IN ('scheduled', 'completed')
        GROUP BY task_id
      ) sb ON t.id = sb.task_id
      WHERE t.user_id = ?
      ORDER BY t.created_at ASC
    `).all(userId);
  }

  return res.status(200).json({
    success: true,
    tasks: (tasks || []).map((t) => {
      const isGoalTask = Boolean(t.goal_id);
      return {
        ...t,
        completed: Boolean(t.completed),
        task_type: isGoalTask ? 'goal' : 'independent',
        goal_title: isGoalTask ? (t.goal_title && t.goal_title !== 'Personal' ? t.goal_title : (t.goal_name || 'Goal Task')) : 'Personal',
        goal_name: isGoalTask ? (t.goal_name || t.goal_title || 'Goal Task') : 'Personal',
        goal_priority: isGoalTask ? (t.goal_priority || 'Medium') : null
      };
    })
  });
});

// POST /api/tasks
// Creates an inline task inside a goal or as an independent task
router.post('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { title, name, goal_id, goalId, description, priority, duration_minutes, duration, due_date, deadline, time_slot } = req.body;

  const taskTitle = (title || name || '').trim();
  const targetGoalId = goal_id || goalId || null;
  const taskDesc = (description || '').trim();
  const taskPriority = ['Low', 'Medium', 'High'].includes(priority) ? priority : 'Medium';
  const taskDuration = parseInt(duration_minutes || duration, 10) || null;
  const taskDueDate = (due_date || deadline || '').trim() || null;
  const taskTimeSlot = (time_slot || '').trim();

  if (!taskTitle) {
    return res.status(400).json({ error: 'Task title is required.' });
  }

  // Validate goal ownership if goal_id is provided
  if (targetGoalId) {
    const parentGoal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(targetGoalId);
    if (!parentGoal) {
      return res.status(404).json({ error: 'Parent goal not found.' });
    }
    if (parentGoal.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized: You do not own the parent goal.' });
    }
  }

  const taskId = `t-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  await db.prepare(`
    INSERT INTO tasks (id, user_id, goal_id, title, description, priority, duration_minutes, due_date, time_slot, completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    taskId,
    userId,
    targetGoalId,
    taskTitle,
    taskDesc,
    taskPriority,
    taskDuration,
    taskDueDate,
    taskTimeSlot,
    now,
    now
  );

  const createdTask = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  const goalStats = targetGoalId ? await syncGoalProgress(db, userId, targetGoalId) : null;

  // Auto-schedule if 24-hour routine coverage is complete
  try {
    const { isRoutineCoverageComplete } = require('../services/routineService');
    const { generateSchedule } = require('../services/schedulingEngine');
    const isComplete = await isRoutineCoverageComplete(db, userId);
    if (isComplete) {
      await generateSchedule(db, userId);
    }
  } catch (err) {
    // Non-blocking auto-schedule
  }

  const isGoalTask = Boolean(targetGoalId);
  return res.status(201).json({
    success: true,
    task: {
      ...createdTask,
      completed: Boolean(createdTask.completed),
      task_type: isGoalTask ? 'goal' : 'independent'
    },
    goalProgress: goalStats
  });
});

// PUT /api/tasks/:id
// Updates a task with strict user isolation
router.put('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const taskId = req.params.id;

  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  if (existing.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this task.' });
  }

  const { title, name, description, priority, duration_minutes, duration, due_date, deadline, completed } = req.body;

  const updatedTitle = title !== undefined || name !== undefined ? (title || name || '').trim() : existing.title;
  const updatedDesc = description !== undefined ? description.trim() : existing.description;
  const updatedPriority = priority !== undefined && ['Low', 'Medium', 'High'].includes(priority) ? priority : existing.priority;
  const updatedDuration = duration_minutes !== undefined || duration !== undefined ? (parseInt(duration_minutes || duration, 10) || null) : existing.duration_minutes;
  const updatedDueDate = due_date !== undefined || deadline !== undefined ? ((due_date || deadline || '').trim() || null) : existing.due_date;
  const updatedCompleted = completed !== undefined ? (completed ? 1 : 0) : existing.completed;

  if (!updatedTitle) {
    return res.status(400).json({ error: 'Task title cannot be empty.' });
  }

  const now = new Date().toISOString();

  // If transitioning to completed, calibrate ML via completeScheduledTask first
  const isBecomingCompleted = (updatedCompleted === 1 && !existing.completed);
  const isVerified = (req.body && req.body.duration_verified !== undefined)
    ? Boolean(req.body.duration_verified)
    : (req.body && req.body.durationVerified !== undefined ? Boolean(req.body.durationVerified) : false);
  const customActual = (req.body && (req.body.actualMinutes || req.body.actual_minutes)) ? (req.body.actualMinutes || req.body.actual_minutes) : updatedDuration;

  if (isBecomingCompleted) {
    try {
      const { completeScheduledTask } = require('../services/schedulingEngine');
      await completeScheduledTask(db, userId, taskId, customActual, isVerified);
    } catch (e) {}
    await db.prepare("UPDATE scheduled_blocks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND task_id = ? AND status = 'scheduled'").run(userId, taskId);
    await db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'rescheduled'").run(userId, taskId);
  }

  await db.prepare(`
    UPDATE tasks
    SET title = ?, description = ?, priority = ?, duration_minutes = ?, due_date = ?, completed = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    updatedTitle,
    updatedDesc,
    updatedPriority,
    updatedDuration,
    updatedDueDate,
    updatedCompleted,
    now,
    taskId,
    userId
  );

  const updatedTask = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  const goalStats = updatedTask.goal_id ? await syncGoalProgress(db, userId, updatedTask.goal_id) : null;

  if (!isBecomingCompleted && updatedCompleted === 0) {
    // If other fields updated, refresh schedule if routine complete
    try {
      const { isRoutineCoverageComplete } = require('../services/routineService');
      const { generateSchedule } = require('../services/schedulingEngine');
      const isComplete = await isRoutineCoverageComplete(db, userId);
      if (isComplete) {
        await generateSchedule(db, userId);
      }
    } catch (e) {}
  }

  const isGoalTask = Boolean(updatedTask.goal_id);
  return res.status(200).json({
    success: true,
    task: {
      ...updatedTask,
      completed: Boolean(updatedTask.completed),
      task_type: isGoalTask ? 'goal' : 'independent'
    },
    goalProgress: goalStats
  });
});

// PATCH /api/tasks/:id/toggle
// Toggles completion status of a task and recalculates parent goal progress immediately
router.patch('/:id/toggle', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const taskId = req.params.id;

  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  if (existing.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this task.' });
  }

  const nextCompleted = existing.completed ? 0 : 1;
  const now = new Date().toISOString();

  // If completed changed to true, run completeScheduledTask to trigger ML calibration & logs
  if (nextCompleted === 1) {
    const isVerified = (req.body && req.body.duration_verified !== undefined)
      ? Boolean(req.body.duration_verified)
      : (req.body && req.body.durationVerified !== undefined ? Boolean(req.body.durationVerified) : false);
    const customActual = (req.body && (req.body.actualMinutes || req.body.actual_minutes)) ? (req.body.actualMinutes || req.body.actual_minutes) : null;
    try {
      const { completeScheduledTask } = require('../services/schedulingEngine');
      await completeScheduledTask(db, userId, taskId, customActual, isVerified);
    } catch (e) {
      await db.prepare(`UPDATE tasks SET completed = 1, updated_at = ? WHERE id = ? AND user_id = ?`).run(now, taskId, userId);
    }
    await db.prepare("UPDATE scheduled_blocks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND task_id = ? AND status = 'scheduled'").run(userId, taskId);
    await db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'rescheduled'").run(userId, taskId);
  } else {
    await db.prepare(`UPDATE tasks SET completed = 0, updated_at = ? WHERE id = ? AND user_id = ?`).run(now, taskId, userId);
    try {
      const { isRoutineCoverageComplete } = require('../services/routineService');
      const { generateSchedule } = require('../services/schedulingEngine');
      const isComplete = await isRoutineCoverageComplete(db, userId);
      if (isComplete) {
        await generateSchedule(db, userId);
      }
    } catch (e) {}
  }

  const updatedTask = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  const goalStats = updatedTask.goal_id ? await syncGoalProgress(db, userId, updatedTask.goal_id) : null;

  const isGoalTask = Boolean(updatedTask.goal_id);
  return res.status(200).json({
    success: true,
    task: {
      ...updatedTask,
      completed: Boolean(updatedTask.completed),
      task_type: isGoalTask ? 'goal' : 'independent'
    },
    goalProgress: goalStats
  });
});

// DELETE /api/tasks/:id
// Deletes a task and recalculates parent goal progress immediately
router.delete('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const taskId = req.params.id;

  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  if (existing.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this task.' });
  }

  const parentGoalId = existing.goal_id;
  await db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(taskId, userId);

  const goalStats = parentGoalId ? await syncGoalProgress(db, userId, parentGoalId) : null;

  return res.status(200).json({
    success: true,
    message: 'Task deleted successfully.',
    goalProgress: goalStats
  });
});

// GET /api/tasks/ai-settings
// Returns user AI estimation preferences & availability status (strictly masked keys)
router.get('/ai-settings', requireAuth, async (req, res) => {
  const db = getDatabase();
  const settings = await getUserAiSettings(db, req.user.id);
  return res.status(200).json({ success: true, settings });
});

// POST /api/tasks/ai-settings
// Updates user AI mode (default vs user_key) and securely encrypts personal API key at rest
router.post('/ai-settings', requireAuth, async (req, res) => {
  const db = getDatabase();
  const { mode, provider, apiKey } = req.body;

  const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : null;

  if (mode === 'user_key' && apiKey !== undefined && !trimmedKey) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid, non-empty Gemini API key.'
    });
  }

  const selectedMode = trimmedKey ? 'user_key' : (mode === 'user_key' ? 'user_key' : 'default');

  const updated = await saveUserAiSettings(db, req.user.id, {
    mode: selectedMode,
    provider: provider || 'gemini',
    apiKey: trimmedKey
  });

  return res.status(200).json({
    success: true,
    message: 'AI estimation settings saved successfully.',
    settings: updated
  });
});

// DELETE /api/tasks/ai-settings/key
// Deletes personal API key and reverts to default mode
router.delete('/ai-settings/key', requireAuth, async (req, res) => {
  const db = getDatabase();
  const updated = await deleteUserApiKey(db, req.user.id);
  return res.status(200).json({
    success: true,
    message: 'Personal API key removed successfully.',
    settings: updated
  });
});

// POST /api/tasks/ai-settings/test-connection
// Minimal non-destructive connection test using user's saved key
router.post('/ai-settings/test-connection', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userApiKey = req.body?.apiKey || req.headers['x-ai-key'] || null;
  const result = await testAiConnection({
    userId: req.user.id,
    userApiKey,
    db
  });
  return res.status(200).json(result);
});

// Alias for test-connection
router.post('/test-ai-connection', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userApiKey = req.body?.apiKey || req.headers['x-ai-key'] || null;
  const result = await testAiConnection({
    userId: req.user.id,
    userApiKey,
    db
  });
  return res.status(200).json(result);
});

// POST /api/tasks/estimate-duration
// Structured AI task duration estimation with smart clarification and strict validation
router.post('/estimate-duration', requireAuth, async (req, res) => {
  const db = getDatabase();
  const {
    title,
    description,
    priority,
    clarification_answer,
    clarificationAnswer,
    clarification_history,
    clarificationHistory
  } = req.body;
  const userApiKey = req.headers['x-ai-key'] || null;

  const result = await estimateTaskDuration({
    userId: req.user.id,
    title: (title || '').trim(),
    description: (description || '').trim(),
    priority: priority || 'Medium',
    clarificationAnswer: clarification_answer || clarificationAnswer || null,
    clarificationHistory: clarification_history || clarificationHistory || [],
    userApiKey,
    db
  });

  if (result.error_code === 'EMPTY_TASK_TITLE') {
    return res.status(400).json(result);
  }

  if (result.error_code === 'RATE_LIMIT_EXCEEDED') {
    return res.status(429).json(result);
  }

  if (result.error_code === 'INVALID_API_KEY' || result.error_code === 'UNSUPPORTED_KEY_TYPE') {
    return res.status(401).json(result);
  }

  if (result.error_code === 'PERMISSION_DENIED') {
    return res.status(403).json(result);
  }

  if (result.error_code === 'PROVIDER_QUOTA_EXHAUSTED') {
    return res.status(429).json(result);
  }

  return res.status(200).json(result);
});

module.exports = router;
