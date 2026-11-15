/**
 * EKAGRA — Priority-Based Scheduling Engine (Deterministic Interval Scheduler)
 * 
 * Implements:
 * 1. Routine Availability Filtering (Available/Flexible only; Fixed/Busy NEVER overlapped)
 * 2. Anti-Overwhelm 85% Daily Buffer (allows 100% only if tasks are overdue)
 * 3. Exact Multi-Factor Priority Scoring:
 *    Task_Score = W_goal + W_task + U_deadline + F_fairness
 * 4. Slot Selection with Bayesian Learned Time-Bucket Fit:
 *    Slot_Fit_Score = Task_Score * (1 + 0.5 * (P_complete(b) - 0.5))
 * 5. Online Adaptive Pace Calibration:
 *    Scheduled_Minutes = Math.round(estimated_minutes * C_pace)
 * 6. Multi-day overflow (spills over up to 7 days)
 * 
 * Strict User Isolation enforced on all DB operations.
 */

const {
  parseTimeToMinutes,
  minutesToTime24,
  calculateDayGaps,
  getUserScheduleSettings,
  getUserScheduleSettingsSync,
  getUserScheduleSettingsAsync
} = require('./routineService');

const {
  getTimeBucket,
  getUserLearningProfile,
  getUserLearningProfileSync,
  getUserLearningProfileAsync,
  getBucketStats,
  recordTaskCompletion,
  recordTaskCompletionSync,
  recordTaskCompletionAsync,
  recordTaskMissOrReschedule,
  recordTaskMissOrRescheduleSync,
  recordTaskMissOrRescheduleAsync
} = require('./adaptiveLearningService');

const W_GOAL = { High: 50, Medium: 30, Low: 10 };
const W_TASK = { High: 30, Medium: 15, Low: 5 };

function parseLocalDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0);
    }
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function calculateDaysUntilDeadline(targetDateStr) {
  if (!targetDateStr) return 999;
  const targetDate = parseLocalDate(targetDateStr);
  if (!targetDate) return 999;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const diffMs = targetDate.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function getGoalFairnessScoreSync(db, userId, goalId, goalCreatedAt) {
  if (!goalId) return 0;

  const lastBlock = db.prepare(`
    SELECT scheduled_date FROM scheduled_blocks
    WHERE user_id = ? AND goal_id = ?
    ORDER BY scheduled_date DESC, start_time DESC
    LIMIT 1
  `).get(userId, goalId);

  let refDateStr = null;
  if (lastBlock && lastBlock.scheduled_date) {
    refDateStr = lastBlock.scheduled_date;
  } else if (goalCreatedAt) {
    refDateStr = goalCreatedAt;
  }

  if (!refDateStr) {
    return 20;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const ref = parseLocalDate(refDateStr);
  const refDay = ref ? new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12, 0, 0) : today;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSince = Math.max(0, Math.round((today - refDay) / msPerDay));

  return Math.min(20, 2 * daysSince);
}

async function getGoalFairnessScoreAsync(db, userId, goalId, goalCreatedAt) {
  if (!goalId) return 0;

  const lastBlock = await db.prepare(`
    SELECT scheduled_date FROM scheduled_blocks
    WHERE user_id = ? AND goal_id = ?
    ORDER BY scheduled_date DESC, start_time DESC
    LIMIT 1
  `).get(userId, goalId);

  let refDateStr = null;
  if (lastBlock && lastBlock.scheduled_date) {
    refDateStr = lastBlock.scheduled_date;
  } else if (goalCreatedAt) {
    refDateStr = goalCreatedAt;
  }

  if (!refDateStr) {
    return 20;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const ref = parseLocalDate(refDateStr);
  const refDay = ref ? new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 12, 0, 0) : today;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysSince = Math.max(0, Math.round((today - refDay) / msPerDay));

  return Math.min(20, 2 * daysSince);
}

function getGoalFairnessScore(db, userId, goalId, goalCreatedAt) {
  if (db && db.isTurso) {
    return getGoalFairnessScoreAsync(db, userId, goalId, goalCreatedAt);
  }
  return getGoalFairnessScoreSync(db, userId, goalId, goalCreatedAt);
}

function computeTaskPriorityScore(...args) {
  let task, goal, fairnessScore;
  if (args.length >= 3 && args[0] && (typeof args[0].prepare === 'function' || typeof args[1] === 'string' || typeof args[1] === 'number')) {
    const db = args[0];
    const userId = args[1];
    task = args[2];
    goal = args[3] || null;
    const isGoalTask = Boolean(task && task.goal_id);
    fairnessScore = isGoalTask ? getGoalFairnessScoreSync(db, userId, task.goal_id, goal ? goal.created_at : null) : 0;
  } else {
    task = args[0] || {};
    goal = args[1] || null;
    fairnessScore = args[2] || 0;
  }

  const isIndependent = !task || !task.goal_id;

  let wGoal = 5;
  if (!isIndependent && goal) {
    wGoal = W_GOAL[goal.priority] || 30;
  }

  const wTask = W_TASK[task ? task.priority : 'Medium'] || 15;

  let uDeadline = 0;
  let isOverdue = false;
  const deadlineStr = task ? (task.due_date || (goal ? goal.target_date : null)) : null;
  if (deadlineStr) {
    const daysUntil = calculateDaysUntilDeadline(deadlineStr);
    if (daysUntil < 0) {
      isOverdue = true;
      uDeadline = 50;
    } else {
      uDeadline = Math.round(40 / (Math.max(0, daysUntil) + 1));
    }
  }

  const fFairness = isIndependent ? 0 : fairnessScore;
  const totalScore = wGoal + wTask + uDeadline + fFairness;

  return {
    totalScore,
    wGoal,
    wTask,
    uDeadline,
    fFairness,
    isOverdue
  };
}

function getDayGroupForDateSync(db, userId, dateStr) {
  const d = parseLocalDate(dateStr) || new Date(dateStr + 'T12:00:00');
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = isNaN(d.getTime()) ? 'Monday' : dayNames[d.getDay()];
  const settings = getUserScheduleSettingsSync(db, userId);

  let weekendDays = ['Saturday', 'Sunday'];
  if (settings && settings.weekends_days) {
    if (Array.isArray(settings.weekends_days)) {
      weekendDays = settings.weekends_days;
    } else if (typeof settings.weekends_days === 'string') {
      try {
        const parsed = JSON.parse(settings.weekends_days);
        if (Array.isArray(parsed)) weekendDays = parsed;
      } catch (e) {
        if (settings.weekends_days.includes(',')) {
          weekendDays = settings.weekends_days.split(',').map((s) => s.trim());
        }
      }
    }
  }

  const isWeekend = weekendDays.includes(dayName) || d.getDay() === 0 || d.getDay() === 6;
  return isWeekend ? 'weekends' : 'weekdays';
}

async function getDayGroupForDateAsync(db, userId, dateStr) {
  const d = parseLocalDate(dateStr) || new Date(dateStr + 'T12:00:00');
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = isNaN(d.getTime()) ? 'Monday' : dayNames[d.getDay()];
  const settings = await getUserScheduleSettingsAsync(db, userId);

  let weekendDays = ['Saturday', 'Sunday'];
  if (settings && settings.weekends_days) {
    if (Array.isArray(settings.weekends_days)) {
      weekendDays = settings.weekends_days;
    } else if (typeof settings.weekends_days === 'string') {
      try {
        const parsed = JSON.parse(settings.weekends_days);
        if (Array.isArray(parsed)) weekendDays = parsed;
      } catch (e) {
        if (settings.weekends_days.includes(',')) {
          weekendDays = settings.weekends_days.split(',').map((s) => s.trim());
        }
      }
    }
  }

  const isWeekend = weekendDays.includes(dayName) || d.getDay() === 0 || d.getDay() === 6;
  return isWeekend ? 'weekends' : 'weekdays';
}

function getDayGroupForDate(db, userId, dateStr) {
  if (db && db.isTurso) {
    return getDayGroupForDateAsync(db, userId, dateStr);
  }
  return getDayGroupForDateSync(db, userId, dateStr);
}

function getFreeIntervalsForDateSync(db, userId, dateStr, excludeBlockId = null) {
  const scheduleGroup = getDayGroupForDateSync(db, userId, dateStr);

  const routines = db.prepare(`
    SELECT * FROM routines
    WHERE user_id = ? AND schedule_group = ?
  `).all(userId, scheduleGroup);

  if (!routines || routines.length === 0) {
    const anyRoutines = db.prepare('SELECT id FROM routines WHERE user_id = ? LIMIT 1').get(userId);
    if (!anyRoutines) {
      return [
        { start: 540, end: 720 },
        { start: 840, end: 1080 }
      ];
    }
    return [];
  }

  const rawIntervals = [];
  for (const r of routines) {
    const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
    if (!isAvail) continue;

    const s = parseTimeToMinutes(r.start_time);
    const e = parseTimeToMinutes(r.end_time);
    if (s === null || e === null) continue;

    if (e > s) {
      rawIntervals.push({ start: s, end: e });
    } else if (e < s) {
      rawIntervals.push({ start: s, end: 1440 });
      rawIntervals.push({ start: 0, end: e });
    }
  }

  if (rawIntervals.length === 0) {
    return [];
  }

  rawIntervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const mergedAvailable = [];
  let cur = { start: rawIntervals[0].start, end: rawIntervals[0].end };

  for (let i = 1; i < rawIntervals.length; i++) {
    const next = rawIntervals[i];
    if (next.start <= cur.end) {
      cur.end = Math.max(cur.end, next.end);
    } else {
      mergedAvailable.push(cur);
      cur = { start: next.start, end: next.end };
    }
  }
  mergedAvailable.push(cur);

  const busyIntervals = [];
  for (const r of routines) {
    const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
    if (isAvail) continue;

    const s = parseTimeToMinutes(r.start_time);
    const e = parseTimeToMinutes(r.end_time);
    if (s === null || e === null) continue;

    if (e > s) {
      busyIntervals.push({ start: s, end: e });
    } else if (e < s) {
      busyIntervals.push({ start: s, end: 1440 });
      busyIntervals.push({ start: 0, end: e });
    }
  }

  const existingBlocks = excludeBlockId
    ? db.prepare(`
        SELECT start_time, end_time, status
        FROM scheduled_blocks
        WHERE user_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'completed') AND id != ?
      `).all(userId, dateStr, excludeBlockId)
    : db.prepare(`
        SELECT start_time, end_time, status
        FROM scheduled_blocks
        WHERE user_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'completed')
      `).all(userId, dateStr);

  for (const b of existingBlocks) {
    const s = parseTimeToMinutes(b.start_time);
    const e = parseTimeToMinutes(b.end_time);
    if (s !== null && e !== null && e > s) {
      busyIntervals.push({ start: s, end: e });
    }
  }

  if (busyIntervals.length === 0) {
    return mergedAvailable.filter((slot) => (slot.end - slot.start) >= 15);
  }

  let remaining = [...mergedAvailable];
  for (const busy of busyIntervals) {
    const nextRemaining = [];
    for (const free of remaining) {
      if (busy.end <= free.start || busy.start >= free.end) {
        nextRemaining.push(free);
      } else {
        if (busy.start > free.start) {
          nextRemaining.push({ start: free.start, end: busy.start });
        }
        if (busy.end < free.end) {
          nextRemaining.push({ start: busy.end, end: free.end });
        }
      }
    }
    remaining = nextRemaining;
  }

  return remaining
    .filter((slot) => (slot.end - slot.start) >= 15)
    .sort((a, b) => a.start - b.start);
}

async function getFreeIntervalsForDateAsync(db, userId, dateStr, excludeBlockId = null) {
  const scheduleGroup = await getDayGroupForDateAsync(db, userId, dateStr);

  const routines = await db.prepare(`
    SELECT * FROM routines
    WHERE user_id = ? AND schedule_group = ?
  `).all(userId, scheduleGroup);

  if (!routines || routines.length === 0) {
    const anyRoutines = await db.prepare('SELECT id FROM routines WHERE user_id = ? LIMIT 1').get(userId);
    if (!anyRoutines) {
      return [
        { start: 540, end: 720 },
        { start: 840, end: 1080 }
      ];
    }
    return [];
  }

  const rawIntervals = [];
  for (const r of routines) {
    const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
    if (!isAvail) continue;

    const s = parseTimeToMinutes(r.start_time);
    const e = parseTimeToMinutes(r.end_time);
    if (s === null || e === null) continue;

    if (e > s) {
      rawIntervals.push({ start: s, end: e });
    } else if (e < s) {
      rawIntervals.push({ start: s, end: 1440 });
      rawIntervals.push({ start: 0, end: e });
    }
  }

  if (rawIntervals.length === 0) {
    return [];
  }

  rawIntervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const mergedAvailable = [];
  let cur = { start: rawIntervals[0].start, end: rawIntervals[0].end };

  for (let i = 1; i < rawIntervals.length; i++) {
    const next = rawIntervals[i];
    if (next.start <= cur.end) {
      cur.end = Math.max(cur.end, next.end);
    } else {
      mergedAvailable.push(cur);
      cur = { start: next.start, end: next.end };
    }
  }
  mergedAvailable.push(cur);

  const busyIntervals = [];
  for (const r of routines) {
    const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
    if (isAvail) continue;

    const s = parseTimeToMinutes(r.start_time);
    const e = parseTimeToMinutes(r.end_time);
    if (s === null || e === null) continue;

    if (e > s) {
      busyIntervals.push({ start: s, end: e });
    } else if (e < s) {
      busyIntervals.push({ start: s, end: 1440 });
      busyIntervals.push({ start: 0, end: e });
    }
  }

  const existingBlocks = excludeBlockId
    ? await db.prepare(`
        SELECT start_time, end_time, status
        FROM scheduled_blocks
        WHERE user_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'completed') AND id != ?
      `).all(userId, dateStr, excludeBlockId)
    : await db.prepare(`
        SELECT start_time, end_time, status
        FROM scheduled_blocks
        WHERE user_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'completed')
      `).all(userId, dateStr);

  for (const b of existingBlocks) {
    const s = parseTimeToMinutes(b.start_time);
    const e = parseTimeToMinutes(b.end_time);
    if (s !== null && e !== null && e > s) {
      busyIntervals.push({ start: s, end: e });
    }
  }

  if (busyIntervals.length === 0) {
    return mergedAvailable.filter((slot) => (slot.end - slot.start) >= 15);
  }

  let remaining = [...mergedAvailable];
  for (const busy of busyIntervals) {
    const nextRemaining = [];
    for (const free of remaining) {
      if (busy.end <= free.start || busy.start >= free.end) {
        nextRemaining.push(free);
      } else {
        if (busy.start > free.start) {
          nextRemaining.push({ start: free.start, end: busy.start });
        }
        if (busy.end < free.end) {
          nextRemaining.push({ start: busy.end, end: free.end });
        }
      }
    }
    remaining = nextRemaining;
  }

  return remaining
    .filter((slot) => (slot.end - slot.start) >= 15)
    .sort((a, b) => a.start - b.start);
}

function getFreeIntervalsForDate(db, userId, dateStr, excludeBlockId = null) {
  if (db && db.isTurso) {
    return getFreeIntervalsForDateAsync(db, userId, dateStr, excludeBlockId);
  }
  return getFreeIntervalsForDateSync(db, userId, dateStr, excludeBlockId);
}

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Priority-Weighted Interval Scheduler (Sync)
 */
function generateScheduleSync(db, userId, options = {}) {
  const { startDate = null, daysAhead = 7, clearExisting = false } = options;

  const now = new Date();
  const baseDate = startDate ? new Date(startDate + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const profile = getUserLearningProfileSync(db, userId);
  const paceFactor = profile ? profile.pace_factor : 1.0;

  if (clearExisting) {
    const startIso = getLocalDateString(baseDate);
    db.prepare(`
      DELETE FROM scheduled_blocks
      WHERE user_id = ? AND scheduled_date >= ? AND status = 'scheduled'
    `).run(userId, startIso);
  }

  const goalsList = db.prepare('SELECT * FROM goals WHERE user_id = ?').all(userId);
  const goalsMap = new Map();
  for (const g of goalsList) {
    goalsMap.set(g.id, g);
  }

  db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND status = 'rescheduled'").run(userId);

  const allTasks = db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND (completed = 0 OR completed IS NULL)
  `).all(userId);

  const alreadyScheduledTaskIds = new Set(
    db.prepare(`
      SELECT task_id FROM scheduled_blocks
      WHERE user_id = ? AND status IN ('scheduled', 'completed')
    `).all(userId).map((b) => b.task_id)
  );

  const tasksToSchedule = allTasks.filter((t) => !alreadyScheduledTaskIds.has(t.id));

  if (tasksToSchedule.length === 0) {
    return {
      success: true,
      scheduled_count: 0,
      message: 'All tasks are already scheduled or completed.',
      blocks: []
    };
  }

  const scoredTasks = tasksToSchedule.map((t) => {
    const goal = t.goal_id ? goalsMap.get(t.goal_id) : null;
    const fairness = getGoalFairnessScoreSync(db, userId, t.goal_id, goal ? goal.created_at : null);
    const scoreDetails = computeTaskPriorityScore(t, goal, fairness);
    const rawDuration = Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30;
    const calibratedDuration = Math.max(15, Math.round((rawDuration * paceFactor) / 5) * 5);

    return {
      task: t,
      goal,
      scoreDetails,
      calibratedDuration
    };
  });

  scoredTasks.sort((a, b) => b.scoreDetails.totalScore - a.scoreDetails.totalScore);

  const placedBlocks = [];

  for (let offset = 0; offset < daysAhead; offset++) {
    const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset);
    const dateStr = getLocalDateString(targetDate);

    const existingMinutesRow = db.prepare(`
      SELECT COALESCE(SUM(allocated_minutes), 0) as total
      FROM scheduled_blocks
      WHERE user_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'completed')
    `).get(userId, dateStr);

    let scheduledMinutesToday = existingMinutesRow ? Number(existingMinutesRow.total) : 0;

    let availableIntervals = getFreeIntervalsForDateSync(db, userId, dateStr);
    if (!availableIntervals || availableIntervals.length === 0) continue;

    let totalDayCapacity = availableIntervals.reduce((acc, slot) => acc + (slot.end - slot.start), 0);
    let dayLimit = totalDayCapacity;

    let taskIdx = 0;
    while (taskIdx < scoredTasks.length) {
      const candidate = scoredTasks[taskIdx];
      const dur = candidate.calibratedDuration;

      const isOverdue = candidate.scoreDetails.isOverdue;
      const effectiveCap = isOverdue ? dayLimit : Math.floor(dayLimit * 0.85);

      if (scheduledMinutesToday + dur > effectiveCap) {
        taskIdx++;
        continue;
      }

      let bestSlot = null;
      let bestFitScore = -Infinity;

      for (let sIdx = 0; sIdx < availableIntervals.length; sIdx++) {
        const slot = availableIntervals[sIdx];
        if (slot.end - slot.start < dur) continue;

        const bucket = getTimeBucket(minutesToTime24(slot.start));
        const alpha = profile ? profile[`alpha_${bucket}`] : 2.0;
        const beta = profile ? profile[`beta_${bucket}`] : 2.0;
        const pComplete = alpha / (alpha + beta);

        const fitScore = candidate.scoreDetails.totalScore * (1 + 0.5 * (pComplete - 0.5));
        if (fitScore > bestFitScore) {
          bestFitScore = fitScore;
          bestSlot = { slotIndex: sIdx, start: slot.start, bucket };
        }
      }

      if (bestSlot) {
        const blockId = `sb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const start24 = minutesToTime24(bestSlot.start);
        const end24 = minutesToTime24(bestSlot.start + dur);
        const nowIso = new Date().toISOString();

        db.prepare(`
          INSERT INTO scheduled_blocks (
            id, user_id, task_id, goal_id, scheduled_date,
            start_time, end_time, allocated_minutes, time_bucket, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
        `).run(
          blockId,
          userId,
          candidate.task.id,
          candidate.task.goal_id || null,
          dateStr,
          start24,
          end24,
          dur,
          bestSlot.bucket,
          nowIso
        );

        placedBlocks.push({
          id: blockId,
          taskId: candidate.task.id,
          goalId: candidate.task.goal_id,
          title: candidate.task.title,
          scheduled_date: dateStr,
          start_time: start24,
          end_time: end24,
          allocated_minutes: dur,
          time_bucket: bestSlot.bucket,
          score: candidate.scoreDetails.totalScore
        });

        scheduledMinutesToday += dur;

        const targetInterval = availableIntervals[bestSlot.slotIndex];
        const newStart = bestSlot.start + dur;
        if (newStart >= targetInterval.end) {
          availableIntervals.splice(bestSlot.slotIndex, 1);
        } else {
          targetInterval.start = newStart;
        }

        scoredTasks.splice(taskIdx, 1);
      } else {
        taskIdx++;
      }
    }
  }

  return {
    success: true,
    scheduled_count: placedBlocks.length,
    unplaced_count: scoredTasks.length,
    blocks: placedBlocks,
    message: `Scheduled ${placedBlocks.length} task blocks successfully.`
  };
}

/**
 * Priority-Weighted Interval Scheduler (Async)
 */
async function generateScheduleAsync(db, userId, options = {}) {
  const { startDate = null, daysAhead = 7, clearExisting = false } = options;

  const now = new Date();
  const baseDate = startDate ? new Date(startDate + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const profile = await getUserLearningProfileAsync(db, userId);
  const paceFactor = profile ? profile.pace_factor : 1.0;

  if (clearExisting) {
    const startIso = getLocalDateString(baseDate);
    await db.prepare(`
      DELETE FROM scheduled_blocks
      WHERE user_id = ? AND scheduled_date >= ? AND status = 'scheduled'
    `).run(userId, startIso);
  }

  const goalsList = await db.prepare('SELECT * FROM goals WHERE user_id = ?').all(userId);
  const goalsMap = new Map();
  for (const g of goalsList) {
    goalsMap.set(g.id, g);
  }

  await db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND status = 'rescheduled'").run(userId);

  const allTasks = await db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ? AND (completed = 0 OR completed IS NULL)
  `).all(userId);

  const alreadyScheduledRows = await db.prepare(`
    SELECT task_id FROM scheduled_blocks
    WHERE user_id = ? AND status IN ('scheduled', 'completed')
  `).all(userId);
  const alreadyScheduledTaskIds = new Set(alreadyScheduledRows.map((b) => b.task_id));

  const tasksToSchedule = allTasks.filter((t) => !alreadyScheduledTaskIds.has(t.id));

  if (tasksToSchedule.length === 0) {
    return {
      success: true,
      scheduled_count: 0,
      message: 'All tasks are already scheduled or completed.',
      blocks: []
    };
  }

  const scoredTasks = [];
  for (const t of tasksToSchedule) {
    const goal = t.goal_id ? goalsMap.get(t.goal_id) : null;
    const fairness = await getGoalFairnessScoreAsync(db, userId, t.goal_id, goal ? goal.created_at : null);
    const scoreDetails = computeTaskPriorityScore(t, goal, fairness);
    const rawDuration = Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30;
    const calibratedDuration = Math.max(15, Math.round((rawDuration * paceFactor) / 5) * 5);

    scoredTasks.push({
      task: t,
      goal,
      scoreDetails,
      calibratedDuration
    });
  }

  scoredTasks.sort((a, b) => b.scoreDetails.totalScore - a.scoreDetails.totalScore);

  const placedBlocks = [];

  for (let offset = 0; offset < daysAhead; offset++) {
    const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset);
    const dateStr = getLocalDateString(targetDate);

    const existingMinutesRow = await db.prepare(`
      SELECT COALESCE(SUM(allocated_minutes), 0) as total
      FROM scheduled_blocks
      WHERE user_id = ? AND scheduled_date = ? AND status IN ('scheduled', 'completed')
    `).get(userId, dateStr);

    let scheduledMinutesToday = existingMinutesRow ? Number(existingMinutesRow.total) : 0;

    let availableIntervals = await getFreeIntervalsForDateAsync(db, userId, dateStr);
    if (!availableIntervals || availableIntervals.length === 0) continue;

    let totalDayCapacity = availableIntervals.reduce((acc, slot) => acc + (slot.end - slot.start), 0);
    let dayLimit = totalDayCapacity;

    let taskIdx = 0;
    while (taskIdx < scoredTasks.length) {
      const candidate = scoredTasks[taskIdx];
      const dur = candidate.calibratedDuration;

      const isOverdue = candidate.scoreDetails.isOverdue;
      const effectiveCap = isOverdue ? dayLimit : Math.floor(dayLimit * 0.85);

      if (scheduledMinutesToday + dur > effectiveCap) {
        taskIdx++;
        continue;
      }

      let bestSlot = null;
      let bestFitScore = -Infinity;

      for (let sIdx = 0; sIdx < availableIntervals.length; sIdx++) {
        const slot = availableIntervals[sIdx];
        if (slot.end - slot.start < dur) continue;

        const bucket = getTimeBucket(minutesToTime24(slot.start));
        const alpha = profile ? profile[`alpha_${bucket}`] : 2.0;
        const beta = profile ? profile[`beta_${bucket}`] : 2.0;
        const pComplete = alpha / (alpha + beta);

        const fitScore = candidate.scoreDetails.totalScore * (1 + 0.5 * (pComplete - 0.5));
        if (fitScore > bestFitScore) {
          bestFitScore = fitScore;
          bestSlot = { slotIndex: sIdx, start: slot.start, bucket };
        }
      }

      if (bestSlot) {
        const blockId = `sb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const start24 = minutesToTime24(bestSlot.start);
        const end24 = minutesToTime24(bestSlot.start + dur);
        const nowIso = new Date().toISOString();

        await db.prepare(`
          INSERT INTO scheduled_blocks (
            id, user_id, task_id, goal_id, scheduled_date,
            start_time, end_time, allocated_minutes, time_bucket, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
        `).run(
          blockId,
          userId,
          candidate.task.id,
          candidate.task.goal_id || null,
          dateStr,
          start24,
          end24,
          dur,
          bestSlot.bucket,
          nowIso
        );

        placedBlocks.push({
          id: blockId,
          taskId: candidate.task.id,
          goalId: candidate.task.goal_id,
          title: candidate.task.title,
          scheduled_date: dateStr,
          start_time: start24,
          end_time: end24,
          allocated_minutes: dur,
          time_bucket: bestSlot.bucket,
          score: candidate.scoreDetails.totalScore
        });

        scheduledMinutesToday += dur;

        const targetInterval = availableIntervals[bestSlot.slotIndex];
        const newStart = bestSlot.start + dur;
        if (newStart >= targetInterval.end) {
          availableIntervals.splice(bestSlot.slotIndex, 1);
        } else {
          targetInterval.start = newStart;
        }

        scoredTasks.splice(taskIdx, 1);
      } else {
        taskIdx++;
      }
    }
  }

  return {
    success: true,
    scheduled_count: placedBlocks.length,
    unplaced_count: scoredTasks.length,
    blocks: placedBlocks,
    message: `Scheduled ${placedBlocks.length} task blocks successfully.`
  };
}

function generateSchedule(db, userId, options = {}) {
  if (db && db.isTurso) {
    return generateScheduleAsync(db, userId, options);
  }
  return generateScheduleSync(db, userId, options);
}

/**
 * Finds next available slot (Sync).
 */
function findNextAvailableSlotSync(db, userId, taskId, options = {}) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    return { success: false, error: 'Task not found.' };
  }
  if (task.completed === 1 || task.completed === true) {
    return { success: false, error: 'Cannot reschedule an already completed task.' };
  }

  const existingBlock = db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  const duration = (existingBlock && existingBlock.allocated_minutes)
    ? existingBlock.allocated_minutes
    : (task.duration_minutes || 30);

  const now = new Date();
  const todayStr = getLocalDateString(now);

  let startDateStr = options.startDate;
  let minStartMinsOnFirstDay = null;

  if (startDateStr) {
    if (existingBlock && existingBlock.scheduled_date === startDateStr) {
      minStartMinsOnFirstDay = parseTimeToMinutes(existingBlock.end_time);
    }
  } else {
    if (existingBlock && existingBlock.scheduled_date) {
      startDateStr = existingBlock.scheduled_date;
      minStartMinsOnFirstDay = parseTimeToMinutes(existingBlock.end_time);
    } else {
      startDateStr = todayStr;
      const currentMins = now.getHours() * 60 + now.getMinutes();
      minStartMinsOnFirstDay = currentMins;
    }
  }

  const baseDate = parseLocalDate(startDateStr) || new Date(startDateStr + 'T12:00:00');
  const daysAhead = options.daysAhead || 7;

  for (let offset = 0; offset < daysAhead; offset++) {
    const searchDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset);
    const dateStr = getLocalDateString(searchDate);

    const freeIntervals = getFreeIntervalsForDateSync(db, userId, dateStr, existingBlock ? existingBlock.id : null);
    const minMins = (offset === 0 && minStartMinsOnFirstDay !== null) ? minStartMinsOnFirstDay : 0;

    for (const slot of freeIntervals) {
      const candidateStart = Math.max(slot.start, minMins);
      const candidateEnd = candidateStart + duration;

      if (candidateEnd <= slot.end) {
        return {
          success: true,
          date: dateStr,
          scheduled_date: dateStr,
          start_time: minutesToTime24(candidateStart),
          end_time: minutesToTime24(candidateEnd),
          duration_minutes: duration
        };
      }
    }
  }

  return {
    success: false,
    error: 'No free routine window available in the next 7 days.'
  };
}

/**
 * Finds next available slot (Async).
 */
async function findNextAvailableSlotAsync(db, userId, taskId, options = {}) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    return { success: false, error: 'Task not found.' };
  }
  if (task.completed === 1 || task.completed === true) {
    return { success: false, error: 'Cannot reschedule an already completed task.' };
  }

  const existingBlock = await db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  const duration = (existingBlock && existingBlock.allocated_minutes)
    ? existingBlock.allocated_minutes
    : (task.duration_minutes || 30);

  const now = new Date();
  const todayStr = getLocalDateString(now);

  let startDateStr = options.startDate;
  let minStartMinsOnFirstDay = null;

  if (startDateStr) {
    if (existingBlock && existingBlock.scheduled_date === startDateStr) {
      minStartMinsOnFirstDay = parseTimeToMinutes(existingBlock.end_time);
    }
  } else {
    if (existingBlock && existingBlock.scheduled_date) {
      startDateStr = existingBlock.scheduled_date;
      minStartMinsOnFirstDay = parseTimeToMinutes(existingBlock.end_time);
    } else {
      startDateStr = todayStr;
      const currentMins = now.getHours() * 60 + now.getMinutes();
      minStartMinsOnFirstDay = currentMins;
    }
  }

  const baseDate = parseLocalDate(startDateStr) || new Date(startDateStr + 'T12:00:00');
  const daysAhead = options.daysAhead || 7;

  for (let offset = 0; offset < daysAhead; offset++) {
    const searchDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset);
    const dateStr = getLocalDateString(searchDate);

    const freeIntervals = await getFreeIntervalsForDateAsync(db, userId, dateStr, existingBlock ? existingBlock.id : null);
    const minMins = (offset === 0 && minStartMinsOnFirstDay !== null) ? minStartMinsOnFirstDay : 0;

    for (const slot of freeIntervals) {
      const candidateStart = Math.max(slot.start, minMins);
      const candidateEnd = candidateStart + duration;

      if (candidateEnd <= slot.end) {
        return {
          success: true,
          date: dateStr,
          scheduled_date: dateStr,
          start_time: minutesToTime24(candidateStart),
          end_time: minutesToTime24(candidateEnd),
          duration_minutes: duration
        };
      }
    }
  }

  return {
    success: false,
    error: 'No free routine window available in the next 7 days.'
  };
}

function findNextAvailableSlot(db, userId, taskId, options = {}) {
  if (db && db.isTurso) {
    return findNextAvailableSlotAsync(db, userId, taskId, options);
  }
  return findNextAvailableSlotSync(db, userId, taskId, options);
}

/**
 * Reschedules a task (Sync).
 */
function rescheduleTaskSync(db, userId, taskId, newDate = null, newStartTime = null) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    throw new Error('Task not found.');
  }
  if (task.completed === 1 || task.completed === true) {
    throw new Error('Cannot reschedule an already completed task.');
  }

  const existingBlock = db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  const duration = (existingBlock && existingBlock.allocated_minutes) ? existingBlock.allocated_minutes : (task.duration_minutes || 30);

  if (!newDate || !newStartTime) {
    const nextSlot = findNextAvailableSlotSync(db, userId, taskId, existingBlock ? { startDate: existingBlock.scheduled_date } : {});
    if (!nextSlot.success) {
      throw new Error(nextSlot.error || 'No free routine window available in the next 7 days.');
    }
    newDate = nextSlot.date;
    newStartTime = nextSlot.start_time;
  }

  const startMins = parseTimeToMinutes(newStartTime);
  if (startMins === null) {
    throw new Error('Invalid start time format.');
  }
  const endMins = startMins + duration;
  const end24 = minutesToTime24(endMins);
  const newBucket = getTimeBucket(newStartTime);

  const freeIntervals = getFreeIntervalsForDateSync(db, userId, newDate, existingBlock ? existingBlock.id : null);
  const fitsInFreeSlot = freeIntervals.some((slot) => startMins >= slot.start && endMins <= slot.end);

  if (!fitsInFreeSlot) {
    throw new Error('Cannot reschedule into a fixed routine commitment or another scheduled task.');
  }

  if (existingBlock) {
    db.prepare("UPDATE scheduled_blocks SET status = 'rescheduled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existingBlock.id);
  }
  db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'rescheduled' AND id != ?").run(
    userId, taskId, existingBlock ? existingBlock.id : ''
  );

  const blockId = `sb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  db.prepare(`
    INSERT INTO scheduled_blocks (
      id, user_id, task_id, goal_id, scheduled_date,
      start_time, end_time, allocated_minutes, time_bucket, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
  `).run(
    blockId,
    userId,
    taskId,
    task.goal_id || null,
    newDate,
    newStartTime,
    end24,
    duration,
    newBucket,
    nowIso
  );

  const scheduleGroup = getDayGroupForDateSync(db, userId, newDate);
  const dayType = scheduleGroup === 'weekends' ? 'weekend' : 'weekday';

  recordTaskMissOrRescheduleSync(db, userId, {
    taskId,
    goalId: task.goal_id,
    taskPriority: task.priority || 'Medium',
    estimatedMinutes: duration,
    timeBucket: newBucket,
    dayType,
    outcome: 'rescheduled'
  });

  return {
    success: true,
    block_id: blockId,
    scheduled_date: newDate,
    start_time: newStartTime,
    end_time: end24,
    block: {
      id: blockId,
      scheduled_date: newDate,
      start_time: newStartTime,
      end_time: end24
    }
  };
}

/**
 * Reschedules a task (Async).
 */
async function rescheduleTaskAsync(db, userId, taskId, newDate = null, newStartTime = null) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    throw new Error('Task not found.');
  }
  if (task.completed === 1 || task.completed === true) {
    throw new Error('Cannot reschedule an already completed task.');
  }

  const existingBlock = await db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  const duration = (existingBlock && existingBlock.allocated_minutes) ? existingBlock.allocated_minutes : (task.duration_minutes || 30);

  if (!newDate || !newStartTime) {
    const nextSlot = await findNextAvailableSlotAsync(db, userId, taskId, existingBlock ? { startDate: existingBlock.scheduled_date } : {});
    if (!nextSlot.success) {
      throw new Error(nextSlot.error || 'No free routine window available in the next 7 days.');
    }
    newDate = nextSlot.date;
    newStartTime = nextSlot.start_time;
  }

  const startMins = parseTimeToMinutes(newStartTime);
  if (startMins === null) {
    throw new Error('Invalid start time format.');
  }
  const endMins = startMins + duration;
  const end24 = minutesToTime24(endMins);
  const newBucket = getTimeBucket(newStartTime);

  const freeIntervals = await getFreeIntervalsForDateAsync(db, userId, newDate, existingBlock ? existingBlock.id : null);
  const fitsInFreeSlot = freeIntervals.some((slot) => startMins >= slot.start && endMins <= slot.end);

  if (!fitsInFreeSlot) {
    throw new Error('Cannot reschedule into a fixed routine commitment or another scheduled task.');
  }

  if (existingBlock) {
    await db.prepare("UPDATE scheduled_blocks SET status = 'rescheduled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existingBlock.id);
  }
  await db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'rescheduled' AND id != ?").run(
    userId, taskId, existingBlock ? existingBlock.id : ''
  );

  const blockId = `sb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const nowIso = new Date().toISOString();
  await db.prepare(`
    INSERT INTO scheduled_blocks (
      id, user_id, task_id, goal_id, scheduled_date,
      start_time, end_time, allocated_minutes, time_bucket, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
  `).run(
    blockId,
    userId,
    taskId,
    task.goal_id || null,
    newDate,
    newStartTime,
    end24,
    duration,
    newBucket,
    nowIso
  );

  const scheduleGroup = await getDayGroupForDateAsync(db, userId, newDate);
  const dayType = scheduleGroup === 'weekends' ? 'weekend' : 'weekday';

  await recordTaskMissOrRescheduleAsync(db, userId, {
    taskId,
    goalId: task.goal_id,
    taskPriority: task.priority || 'Medium',
    estimatedMinutes: duration,
    timeBucket: newBucket,
    dayType,
    outcome: 'rescheduled'
  });

  return {
    success: true,
    block_id: blockId,
    scheduled_date: newDate,
    start_time: newStartTime,
    end_time: end24,
    block: {
      id: blockId,
      scheduled_date: newDate,
      start_time: newStartTime,
      end_time: end24
    }
  };
}

function rescheduleTask(db, userId, taskId, newDate = null, newStartTime = null) {
  if (db && db.isTurso) {
    return rescheduleTaskAsync(db, userId, taskId, newDate, newStartTime);
  }
  return rescheduleTaskSync(db, userId, taskId, newDate, newStartTime);
}

/**
 * Marks task and blocks completed (Sync).
 */
function completeScheduledTaskSync(db, userId, taskId, actualMinutesInput = null, durationVerified = true) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    throw new Error('Task not found.');
  }
  if (task.completed === 1 || task.completed === true) {
    throw new Error('Task is already completed.');
  }

  const block = db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  const estimatedMinutes = (block && block.allocated_minutes) ? block.allocated_minutes : (task.duration_minutes || 30);
  const actualMinutes = (actualMinutesInput && Number(actualMinutesInput) > 0) ? Number(actualMinutesInput) : estimatedMinutes;
  const bucket = block ? block.time_bucket : getTimeBucket(task.time_slot || '09:00');

  db.prepare('UPDATE tasks SET completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(taskId, userId);
  db.prepare("UPDATE scheduled_blocks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND task_id = ? AND status = 'scheduled'").run(userId, taskId);
  db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'rescheduled'").run(userId, taskId);

  const goal = task.goal_id ? db.prepare('SELECT priority FROM goals WHERE id = ?').get(task.goal_id) : null;
  const goalPriority = goal ? goal.priority : 'Medium';
  const nowD = new Date();
  const dayType = (nowD.getDay() === 0 || nowD.getDay() === 6) ? 'weekend' : 'weekday';

  const learningResult = recordTaskCompletionSync(db, userId, {
    taskId,
    goalId: task.goal_id,
    goalPriority,
    taskPriority: task.priority || 'Medium',
    estimatedMinutes,
    actualMinutes,
    durationVerified: Boolean(durationVerified),
    timeBucket: bucket,
    dayType,
    outcome: 'completed'
  });

  return {
    success: true,
    learning: learningResult
  };
}

/**
 * Marks task and blocks completed (Async).
 */
async function completeScheduledTaskAsync(db, userId, taskId, actualMinutesInput = null, durationVerified = true) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    throw new Error('Task not found.');
  }
  if (task.completed === 1 || task.completed === true) {
    throw new Error('Task is already completed.');
  }

  const block = await db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  const estimatedMinutes = (block && block.allocated_minutes) ? block.allocated_minutes : (task.duration_minutes || 30);
  const actualMinutes = (actualMinutesInput && Number(actualMinutesInput) > 0) ? Number(actualMinutesInput) : estimatedMinutes;
  const bucket = block ? block.time_bucket : getTimeBucket(task.time_slot || '09:00');

  await db.prepare('UPDATE tasks SET completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(taskId, userId);
  await db.prepare("UPDATE scheduled_blocks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND task_id = ? AND status = 'scheduled'").run(userId, taskId);
  await db.prepare("DELETE FROM scheduled_blocks WHERE user_id = ? AND task_id = ? AND status = 'rescheduled'").run(userId, taskId);

  const goal = task.goal_id ? await db.prepare('SELECT priority FROM goals WHERE id = ?').get(task.goal_id) : null;
  const goalPriority = goal ? goal.priority : 'Medium';
  const nowD = new Date();
  const dayType = (nowD.getDay() === 0 || nowD.getDay() === 6) ? 'weekend' : 'weekday';

  const learningResult = await recordTaskCompletionAsync(db, userId, {
    taskId,
    goalId: task.goal_id,
    goalPriority,
    taskPriority: task.priority || 'Medium',
    estimatedMinutes,
    actualMinutes,
    durationVerified: Boolean(durationVerified),
    timeBucket: bucket,
    dayType,
    outcome: 'completed'
  });

  return {
    success: true,
    learning: learningResult
  };
}

function completeScheduledTask(db, userId, taskId, actualMinutesInput = null, durationVerified = true) {
  if (db && db.isTurso) {
    return completeScheduledTaskAsync(db, userId, taskId, actualMinutesInput, durationVerified);
  }
  return completeScheduledTaskSync(db, userId, taskId, actualMinutesInput, durationVerified);
}

/**
 * Marks task missed (Sync).
 */
function missScheduledTaskSync(db, userId, taskId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    throw new Error('Task not found.');
  }

  const block = db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  if (block) {
    db.prepare("UPDATE scheduled_blocks SET status = 'missed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(block.id);
  }

  const bucket = block ? block.time_bucket : 'morning';

  const learningResult = recordTaskMissOrRescheduleSync(db, userId, {
    taskId,
    goalId: task.goal_id,
    taskPriority: task.priority || 'Medium',
    estimatedMinutes: block ? block.allocated_minutes : (task.duration_minutes || 30),
    timeBucket: bucket,
    outcome: 'missed'
  });

  return {
    success: true,
    learning: learningResult
  };
}

/**
 * Marks task missed (Async).
 */
async function missScheduledTaskAsync(db, userId, taskId) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) {
    throw new Error('Task not found.');
  }

  const block = await db.prepare(`
    SELECT * FROM scheduled_blocks
    WHERE user_id = ? AND task_id = ? AND status = 'scheduled'
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, taskId);

  if (block) {
    await db.prepare("UPDATE scheduled_blocks SET status = 'missed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(block.id);
  }

  const bucket = block ? block.time_bucket : 'morning';

  const learningResult = await recordTaskMissOrRescheduleAsync(db, userId, {
    taskId,
    goalId: task.goal_id,
    taskPriority: task.priority || 'Medium',
    estimatedMinutes: block ? block.allocated_minutes : (task.duration_minutes || 30),
    timeBucket: bucket,
    outcome: 'missed'
  });

  return {
    success: true,
    learning: learningResult
  };
}

function missScheduledTask(db, userId, taskId) {
  if (db && db.isTurso) {
    return missScheduledTaskAsync(db, userId, taskId);
  }
  return missScheduledTaskSync(db, userId, taskId);
}

module.exports = {
  W_GOAL,
  W_TASK,
  computeTaskPriorityScore,
  getDayGroupForDate,
  getDayGroupForDateSync,
  getDayGroupForDateAsync,
  getFreeIntervalsForDate,
  getFreeIntervalsForDateSync,
  getFreeIntervalsForDateAsync,
  findNextAvailableSlot,
  findNextAvailableSlotSync,
  findNextAvailableSlotAsync,
  generateSchedule,
  generateScheduleSync,
  generateScheduleAsync,
  rescheduleTask,
  rescheduleTaskSync,
  rescheduleTaskAsync,
  completeScheduledTask,
  completeScheduledTaskSync,
  completeScheduledTaskAsync,
  missScheduledTask,
  missScheduledTaskSync,
  missScheduledTaskAsync
};
