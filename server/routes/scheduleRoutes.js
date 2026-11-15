const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../db');
const {
  isRoutineCoverageComplete,
  getRoutineCoverageStatus,
  getUserScheduleSettings
} = require('../services/routineService');
const {
  generateSchedule,
  rescheduleTask,
  completeScheduledTask,
  missScheduledTask,
  findNextAvailableSlot,
  getDayGroupForDate
} = require('../services/schedulingEngine');

// POST /api/schedule/generate
// Deterministic priority scheduling for incomplete tasks
router.post('/generate', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;

  // Strict Routine Coverage Gate
  const coverageStatus = await getRoutineCoverageStatus(db, userId);
  if (coverageStatus.routine_coverage_incomplete) {
    return res.status(200).json({
      success: false,
      routine_coverage_incomplete: true,
      incomplete_group: coverageStatus.incomplete_group,
      message: coverageStatus.message || 'Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.'
    });
  }

  try {
    const result = await generateSchedule(db, userId, {
      clearExisting: Boolean(req.body.clearExisting),
      daysAhead: req.body.daysAhead ? Number(req.body.daysAhead) : 7
    });

    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (err) {
    console.error('[Generate Schedule Error]', err);
    return res.status(500).json({ error: 'Failed to generate schedule: ' + err.message });
  }
});

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getSchedulePayload(db, userId, rawDate = 'today') {
  let targetDateStr = (rawDate || '').trim();
  if (!targetDateStr || targetDateStr === 'today') {
    targetDateStr = getLocalDateString();
  }

  const scheduleGroup = await getDayGroupForDate(db, userId, targetDateStr);
  const coverageStatus = await getRoutineCoverageStatus(db, userId);

  const blocks = (await db.prepare(`
    SELECT 
      sb.*, 
      t.title as task_title, 
      t.priority as task_priority, 
      t.duration_minutes as task_duration,
      t.due_date as task_due_date,
      t.completed as task_completed,
      COALESCE(g.title, 'Personal') as goal_title,
      COALESCE(g.title, 'Personal') as goal_name,
      g.priority as goal_priority
    FROM scheduled_blocks sb
    LEFT JOIN tasks t ON sb.task_id = t.id
    LEFT JOIN goals g ON sb.goal_id = g.id
    WHERE sb.user_id = ? AND sb.scheduled_date = ? AND sb.status IN ('scheduled', 'completed')
    ORDER BY sb.start_time ASC
  `).all(userId, targetDateStr)) || [];

  const routines = (await db.prepare(`
    SELECT id, name, start_time, end_time, type, availability_type, schedule_group
    FROM routines
    WHERE user_id = ? AND (schedule_group = ? OR (schedule_group IS NULL AND ? = 'weekdays'))
    ORDER BY start_time ASC
  `).all(userId, scheduleGroup, scheduleGroup)) || [];

  const enrichedBlocks = blocks.map((b) => {
    const isGoalTask = Boolean(b.goal_id);
    const isTaskCompleted = Boolean(b.task_completed || b.status === 'completed');
    return {
      ...b,
      status: isTaskCompleted ? 'completed' : b.status,
      title: b.task_title,
      task_type: isGoalTask ? 'goal' : 'independent',
      goal_title: isGoalTask ? (b.goal_title && b.goal_title !== 'Personal' ? b.goal_title : (b.goal_name || 'Goal Task')) : 'Personal',
      goal_name: isGoalTask ? (b.goal_name || b.goal_title || 'Goal Task') : 'Personal',
      goal_priority: isGoalTask ? (b.goal_priority || 'Medium') : null
    };
  });

  const incompleteBlocks = enrichedBlocks.filter((b) => b.status === 'scheduled' && !b.task_completed);
  const nextTask = incompleteBlocks.length > 0 ? incompleteBlocks[0] : null;

  return {
    success: true,
    date: targetDateStr,
    schedule_group: scheduleGroup,
    blocks: enrichedBlocks,
    routines,
    next_task: nextTask,
    routine_coverage_status: coverageStatus,
    is_routine_complete: coverageStatus.is_routine_complete,
    routine_coverage_incomplete: coverageStatus.routine_coverage_incomplete,
    incomplete_group: coverageStatus.incomplete_group,
    routine_warning_message: coverageStatus.message
  };
}

// GET /api/schedule
// Returns scheduled blocks and routine events for a target date (default today)
router.get('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;

  try {
    const payload = await getSchedulePayload(db, userId, req.query.date);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[GET /api/schedule Error]', err);
    return res.status(500).json({ error: 'Failed to fetch schedule.' });
  }
});

// POST /api/schedule/reschedule-task
router.post('/reschedule-task', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const targetTaskId = req.body.taskId || req.body.task_id;
  let targetDate = req.body.newDate || req.body.new_date;
  let targetStartTime = req.body.newStartTime || req.body.new_start_time;

  if (!targetTaskId) {
    return res.status(400).json({ error: 'taskId is required.' });
  }

  try {
    // If targetDate or targetStartTime not provided, auto-find next strictly available slot
    if (!targetDate || !targetStartTime) {
      const nextSlot = await findNextAvailableSlot(db, userId, targetTaskId);
      if (!nextSlot.success) {
        return res.status(400).json({ error: nextSlot.error || 'No free routine window available in the next 7 days.' });
      }
      targetDate = nextSlot.date;
      targetStartTime = nextSlot.start_time;
    }

    const result = await rescheduleTask(db, userId, targetTaskId, targetDate, targetStartTime);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/schedule/complete-task
router.post('/complete-task', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const targetTaskId = req.body.taskId || req.body.task_id;

  if (!targetTaskId) {
    return res.status(400).json({ error: 'taskId is required.' });
  }

  const mins = (req.body.actualMinutes !== undefined && req.body.actualMinutes !== null)
    ? req.body.actualMinutes
    : req.body.actual_minutes;
  const isVerified = (req.body.duration_verified !== undefined)
    ? Boolean(req.body.duration_verified)
    : ((req.body.durationVerified !== undefined) ? Boolean(req.body.durationVerified) : true);

  try {
    const result = await completeScheduledTask(db, userId, targetTaskId, mins, isVerified);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/schedule/miss-task
router.post('/miss-task', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { taskId } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required.' });
  }

  try {
    const result = await missScheduledTask(db, userId, taskId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

router.getSchedulePayload = getSchedulePayload;
module.exports = router;
