const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../db');
const {
  getUserLearningProfile,
  getAllBucketStats,
  computeGoalForecast,
  getUserDailyAvailableMinutes
} = require('../services/adaptiveLearningService');
const { parseTimeToMinutes } = require('../services/routineService');

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function getInsightsPayload(db, userId) {
  // 1. Learning Profile & Time Bucket Focus
  const profile = await getUserLearningProfile(db, userId);
  const bucketStats = getAllBucketStats(profile);

  // Peak focus window determination
  let peakBucket = 'morning';
  let highestP = -1;
  for (const [bName, bData] of Object.entries(bucketStats)) {
    if (bData.p_complete > highestP) {
      highestP = bData.p_complete;
      peakBucket = bName;
    }
  }
  const bucketLabels = {
    morning: 'Morning (05:00 AM – 12:00 PM)',
    afternoon: 'Afternoon (12:00 PM – 05:00 PM)',
    evening: 'Evening (05:00 PM – 09:00 PM)',
    night: 'Night (09:00 PM – 05:00 AM)'
  };

  // 2. Available Capacity
  const dailyAvailableMins = await getUserDailyAvailableMinutes(db, userId);
  const rawRoutines = await db.prepare('SELECT * FROM routines WHERE user_id = ?').all(userId);
  const routines = rawRoutines || [];

  let weekdayBusy = 0;
  let weekdayAvail = 0;
  let weekendBusy = 0;
  let weekendAvail = 0;

  for (const r of routines) {
    let group = r.schedule_group;
    if (!group) {
      let days = [];
      try { days = JSON.parse(r.days); } catch(e) { days = (r.days || '').split(','); }
      group = days.some((d) => ['Saturday', 'Sunday'].includes(d.trim())) ? 'weekends' : 'weekdays';
    }

    const s = parseTimeToMinutes(r.start_time);
    const e = parseTimeToMinutes(r.end_time);
    if (s === null || e === null) continue;
    const dur = e >= s ? (e - s) : (1440 - s + e);

    const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
    if (group === 'weekends') {
      if (isAvail) weekendAvail += dur; else weekendBusy += dur;
    } else {
      if (isAvail) weekdayAvail += dur; else weekdayBusy += dur;
    }
  }

  // 3. Goal Health & Rolling-Velocity Forecasts
  const rawGoals = await db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY target_date ASC').all(userId);
  const goals = rawGoals || [];
  const goalForecasts = await Promise.all(goals.map(async (g) => {
    const forecast = await computeGoalForecast(db, userId, g.id);
    return {
      id: g.id,
      title: g.title,
      priority: g.priority,
      target_date: g.target_date,
      forecast
    };
  }));

  // 4. Real Task & Execution Counts (Zero Fake Data)
  const totalTasksRow = await db.prepare('SELECT count(*) as count FROM tasks WHERE user_id = ?').get(userId);
  const totalTasks = totalTasksRow ? totalTasksRow.count : 0;

  const completedTasksRow = await db.prepare('SELECT count(*) as count FROM tasks WHERE user_id = ? AND completed = 1').get(userId);
  const completedTasks = completedTasksRow ? completedTasksRow.count : 0;

  // Real focus minutes completed
  const execMinutesRow = await db.prepare(`
    SELECT COALESCE(SUM(actual_minutes), 0) as total
    FROM execution_logs
    WHERE user_id = ? AND outcome = 'completed'
  `).get(userId);

  let focusMinutesCompleted = execMinutesRow ? Number(execMinutesRow.total) : 0;
  if (focusMinutesCompleted === 0 && completedTasks > 0) {
    const taskMinutesRow = await db.prepare(`
      SELECT COALESCE(SUM(duration_minutes), 0) as total
      FROM tasks
      WHERE user_id = ? AND completed = 1
    `).get(userId);
    focusMinutesCompleted = taskMinutesRow ? Number(taskMinutesRow.total) : (completedTasks * 30);
  }
  const focusHours = Math.round((focusMinutesCompleted / 60) * 10) / 10;

  // Real active streak calculation
  const rawDates = await db.prepare(`
    SELECT DISTINCT SUBSTR(logged_at, 1, 10) as day
    FROM execution_logs
    WHERE user_id = ? AND outcome = 'completed'
    UNION
    SELECT DISTINCT SUBSTR(updated_at, 1, 10) as day
    FROM tasks
    WHERE user_id = ? AND completed = 1
    ORDER BY day DESC
  `).all(userId, userId);
  const activityDates = (rawDates || []).map((r) => r.day);

  let streak = 0;
  if (activityDates.length > 0) {
    const todayStr = getLocalDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterday);

    // Must have activity today or yesterday to have an active streak
    if (activityDates.includes(todayStr) || activityDates.includes(yesterdayStr)) {
      let checkDate = activityDates.includes(todayStr) ? new Date() : yesterday;
      while (true) {
        const checkStr = getLocalDateString(checkDate);
        if (activityDates.includes(checkStr)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }
  }

  // Real Productivity Trend (last 7 days completed minutes per day)
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const trendDays = [];
  const trendValues = [];
  const trendTaskCounts = [];
  let trendHasData = false;

  for (let i = 6; i >= 0; i--) {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - i);
    const dateStr = getLocalDateString(targetDate);
    const dayLabel = dayNames[targetDate.getDay()];

    const dayMinsRow = await db.prepare(`
      SELECT COALESCE(SUM(actual_minutes), 0) as total, COUNT(*) as task_count
      FROM execution_logs
      WHERE user_id = ? AND SUBSTR(logged_at, 1, 10) = ? AND outcome = 'completed'
    `).get(userId, dateStr);

    let dayMins = dayMinsRow ? Number(dayMinsRow.total) : 0;
    let dayTasks = dayMinsRow ? Number(dayMinsRow.task_count) : 0;

    // Fallback: Check completed tasks updated on dateStr if execution_logs didn't record
    if (dayMins === 0 && dayTasks === 0) {
      const taskMinsRow = await db.prepare(`
        SELECT COALESCE(SUM(duration_minutes), 0) as total, COUNT(*) as task_count
        FROM tasks
        WHERE user_id = ? AND SUBSTR(updated_at, 1, 10) = ? AND completed = 1
      `).get(userId, dateStr);
      if (taskMinsRow && Number(taskMinsRow.task_count) > 0) {
        dayMins = Number(taskMinsRow.total) || (Number(taskMinsRow.task_count) * 30);
        dayTasks = Number(taskMinsRow.task_count);
      }
    }

    if (dayMins > 0 || dayTasks > 0) trendHasData = true;

    trendDays.push(dayLabel);
    trendValues.push(dayMins);
    trendTaskCounts.push(dayTasks);
  }

  // Real Task Breakdown
  const scheduledIncompleteRow = await db.prepare(`
    SELECT count(DISTINCT task_id) as count
    FROM scheduled_blocks sb
    JOIN tasks t ON sb.task_id = t.id
    WHERE sb.user_id = ? AND sb.status = 'scheduled' AND (t.completed = 0 OR t.completed IS NULL)
  `).get(userId);
  const scheduledIncompleteTasks = scheduledIncompleteRow ? scheduledIncompleteRow.count : 0;

  const missedIncompleteRow = await db.prepare(`
    SELECT count(DISTINCT t.id) as count
    FROM tasks t
    WHERE t.user_id = ? AND (t.completed = 0 OR t.completed IS NULL)
      AND EXISTS (SELECT 1 FROM scheduled_blocks sb WHERE sb.task_id = t.id AND sb.status = 'missed')
      AND NOT EXISTS (SELECT 1 FROM scheduled_blocks sb WHERE sb.task_id = t.id AND sb.status = 'scheduled')
  `).get(userId);
  const missedIncompleteTasks = missedIncompleteRow ? missedIncompleteRow.count : 0;

  const unscheduledTasks = Math.max(0, totalTasks - completedTasks - scheduledIncompleteTasks - missedIncompleteTasks);

  const taskBreakdown = {
    completed: completedTasks,
    scheduled: scheduledIncompleteTasks,
    missed: missedIncompleteTasks,
    unscheduled: unscheduledTasks,
    total: totalTasks,
    has_data: totalTasks > 0
  };

  // 5. Recent Execution Logs
  const rawRecentLogs = await db.prepare(`
    SELECT el.*, t.title as task_title, g.title as goal_title
    FROM execution_logs el
    LEFT JOIN tasks t ON el.task_id = t.id
    LEFT JOIN goals g ON el.goal_id = g.id
    WHERE el.user_id = ?
    ORDER BY el.logged_at DESC
    LIMIT 20
  `).all(userId);
  const recentLogs = rawRecentLogs || [];

  return {
    success: true,
    metrics: {
      completed_tasks: completedTasks,
      total_tasks: totalTasks,
      focus_hours: focusHours,
      focus_minutes_completed: focusMinutesCompleted,
      streak: streak
    },
    productivity_trend: {
      days: trendDays,
      values: trendValues,
      task_counts: trendTaskCounts,
      has_data: trendHasData
    },
    task_breakdown: taskBreakdown,
    learning: {
      pace_factor: profile.pace_factor,
      completed_count: profile.completed_count,
      calibrated_count: Number(profile.calibrated_count) || 0,
      bucket_stats: bucketStats,
      peak_focus_window: bucketLabels[peakBucket] || 'Morning',
      peak_bucket: peakBucket
    },
    capacity: {
      daily_available_mins: dailyAvailableMins,
      daily_available_hours: Math.round((dailyAvailableMins / 60) * 10) / 10,
      weekday: { busy_mins: weekdayBusy, available_mins: weekdayAvail },
      weekend: { busy_mins: weekendBusy, available_mins: weekendAvail }
    },
    goal_forecasts: goalForecasts,
    recent_logs: recentLogs
  };
}

// GET /api/insights
// 100% Real behavioral ML metrics, capacity analytics, streak, and goal health forecasts
router.get('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;

  try {
    const payload = await getInsightsPayload(db, userId);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[GET /api/insights Error]', err);
    return res.status(500).json({ error: 'Failed to fetch insights.' });
  }
});

router.getInsightsPayload = getInsightsPayload;
module.exports = router;
