const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../db');
const { calculateGoalHealth } = require('../services/goalHealth');
const { getGoalTaskStats } = require('../services/goalProgress');
const { getUserScheduleSettings, isRoutineCoverageComplete, getRoutineCoverageStatus } = require('../services/routineService');

// Helper: Get & Save User Preferences (Strict User Isolation)
async function getUserPreferences(db, userId) {
  const row = await db.prepare('SELECT payload FROM user_app_data WHERE user_id = ? AND entity_type = ?').get(userId, 'user_preferences');
  if (row && row.payload) {
    try {
      return JSON.parse(row.payload);
    } catch (e) {}
  }
  return {
    notify_tasks: true,
    notify_goals: true,
    notify_weekly: true
  };
}

async function saveUserPreferences(db, userId, prefs) {
  const incoming = (prefs && (prefs.preferences || prefs.settings)) ? (prefs.preferences || prefs.settings) : (prefs || {});
  const current = await getUserPreferences(db, userId);
  const updated = {
    ...current,
    ...incoming
  };
  const payload = JSON.stringify(updated);
  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT id FROM user_app_data WHERE user_id = ? AND entity_type = ?').get(userId, 'user_preferences');
  if (existing) {
    await db.prepare('UPDATE user_app_data SET payload = ? WHERE id = ?').run(payload, existing.id);
  } else {
    await db.prepare('INSERT INTO user_app_data (user_id, entity_type, payload, created_at) VALUES (?, ?, ?, ?)').run(
      userId,
      'user_preferences',
      payload,
      now
    );
  }
  return updated;
}

// Sample collage template data matching Screens 1-12
const SAMPLE_COLLAGE_DATA = {
  goals: [
    {
      id: 'g-1',
      title: 'AI/ML Internship Preparation',
      deadline: 'Nov 15, 2026',
      target_date: 'Nov 15, 2026',
      priority: 'High',
      progress: 72,
      health: 'On Track',
      description: 'Master transformers, RAG architectures, and fine-tuning pipelines.'
    },
    {
      id: 'g-2',
      title: 'DSA',
      deadline: 'Dec 20, 2026',
      target_date: 'Dec 20, 2026',
      priority: 'Medium',
      progress: 35,
      health: 'At Risk',
      description: 'Complete NeetCode 150 and core dynamic programming patterns.'
    },
    {
      id: 'g-3',
      title: 'RAG Project',
      deadline: 'Jan 15, 2027',
      target_date: 'Jan 15, 2027',
      priority: 'Medium',
      progress: 50,
      health: 'At Risk',
      description: 'Build enterprise hybrid search with vector and lexical retrieval.'
    },
    {
      id: 'g-4',
      title: 'GATE',
      deadline: 'Feb 01, 2027',
      target_date: 'Feb 01, 2027',
      priority: 'Low',
      progress: 20,
      health: 'Behind',
      description: 'Computer science core fundamentals revision and test series.'
    }
  ],
  tasks: [
    {
      id: 't-1',
      title: 'Wake up & freshen up',
      goalId: null,
      goalTag: 'Personal',
      timeSlot: '06:30 – 08:00',
      category: 'Personal',
      completed: true,
      priority: 'Medium',
      date: 'Today'
    },
    {
      id: 't-2',
      title: 'College',
      goalId: null,
      goalTag: 'College',
      timeSlot: '08:00 – 04:30',
      category: 'College',
      completed: true,
      priority: 'High',
      date: 'Today'
    },
    {
      id: 't-3',
      title: 'Travel',
      goalId: null,
      goalTag: 'Travel',
      timeSlot: '04:30 – 05:30',
      category: 'Travel',
      completed: true,
      priority: 'Low',
      date: 'Today'
    },
    {
      id: 't-4',
      title: 'Gym',
      goalId: null,
      goalTag: 'Fitness',
      timeSlot: '05:30 – 07:00',
      category: 'Fitness',
      completed: false,
      priority: 'Medium',
      date: 'Today'
    },
    {
      id: 't-5',
      title: 'Free Time',
      goalId: null,
      goalTag: 'Flexible',
      timeSlot: '07:00 – 08:00',
      category: 'Flexible',
      completed: false,
      priority: 'Low',
      date: 'Today'
    },
    {
      id: 't-6',
      title: 'Backpropagation',
      goalId: 'g-1',
      goalTag: 'AI/ML',
      timeSlot: '08:00 – 09:15',
      category: 'AI/ML',
      completed: false,
      priority: 'High',
      date: 'Today'
    },
    {
      id: 't-7',
      title: 'DSA',
      goalId: 'g-2',
      goalTag: 'DSA',
      timeSlot: '09:15 – 10:30',
      category: 'DSA',
      completed: false,
      priority: 'Medium',
      date: 'Today'
    },
    {
      id: 't-8',
      title: 'RAG Project',
      goalId: 'g-3',
      goalTag: 'Projects',
      timeSlot: '10:30 – 11:30',
      category: 'Projects',
      completed: false,
      priority: 'Medium',
      date: 'Today'
    }
  ],
  routines: [
    {
      id: 'r-1',
      name: 'Morning Routine',
      frequency: 'Daily',
      completionCount: 3,
      totalCount: 3,
      adherence: 100,
      badgeColor: '#10B981'
    },
    {
      id: 'r-2',
      name: 'Study Routine',
      frequency: 'Daily',
      completionCount: 2,
      totalCount: 3,
      adherence: 67,
      badgeColor: '#06B6D4'
    },
    {
      id: 'r-3',
      name: 'Workout Routine',
      frequency: 'Mon, Wed, Fri',
      completionCount: 1,
      totalCount: 1,
      adherence: 100,
      badgeColor: '#14B8A6'
    },
    {
      id: 'r-4',
      name: 'Evening Routine',
      frequency: 'Daily',
      completionCount: 4,
      totalCount: 5,
      adherence: 80,
      badgeColor: '#F59E0B'
    }
  ],
  metrics: {
    completedToday: 3,
    missedToday: 1,
    rescheduledToday: 1,
    streak: 5,
    focusHours: 28,
    totalCompletedTasks: 18
  },
  insights: [
    {
      id: 'i-1',
      type: 'peak',
      title: "You're consistent in the evening",
      detail: "You've completed 4/5 evening tasks this week. Keep using this time for high-priority work.",
      badge: 'Peak Window'
    },
    {
      id: 'i-2',
      type: 'warning',
      title: "DSA often gets rescheduled",
      detail: "This task was rescheduled 3 times this week. Consider breaking it into smaller chunks.",
      badge: 'Slip Detection'
    },
    {
      id: 'i-3',
      type: 'pace',
      title: "You're progressing well on AI/ML",
      detail: "Your completion rate for AI/ML tasks is 18% higher than other goals this week.",
      badge: 'Momentum'
    }
  ],
  activities: [
    { id: 'a-1', title: 'Completed task', subtitle: 'Wake up & freshen up', time: '08:02 AM' },
    { id: 'a-2', title: 'Added goal', subtitle: 'AI/ML Internship Preparation', time: '2 days ago' },
    { id: 'a-3', title: 'Updated task', subtitle: 'Backpropagation time slot', time: '2 days ago' },
    { id: 'a-4', title: 'Completed routine', subtitle: 'Morning Routine', time: '3 days ago' }
  ]
};

// GET /api/dashboard/data
// Returns user-isolated dashboard state. If new user with 0 records, returns Day-0 Cold Start!
router.get('/data', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;

  const rawGoals = await db.prepare(`
    SELECT id, user_id, title, description, priority, target_date, progress, created_at, updated_at
    FROM goals
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
  const dbGoals = rawGoals || [];

  const rawTasks = await db.prepare(`
    SELECT 
      t.id, t.user_id, t.goal_id, t.title, t.description, t.priority, 
      t.duration_minutes, t.due_date, t.time_slot, t.completed, t.created_at, t.updated_at,
      g.title as goal_title,
      g.title as goal_name,
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
  const dbTasks = (rawTasks || []).map((t) => {
    const isGoalTask = Boolean(t.goal_id);
    return {
      ...t,
      completed: Boolean(t.completed),
      task_type: isGoalTask ? 'goal' : 'independent',
      goal_title: isGoalTask ? (t.goal_title && t.goal_title !== 'Personal' ? t.goal_title : (t.goal_name || 'Goal Task')) : 'Personal',
      goal_name: isGoalTask ? (t.goal_name || t.goal_title || 'Goal Task') : 'Personal',
      goal_priority: isGoalTask ? (t.goal_priority || 'Medium') : null
    };
  });

  const scheduleSettings = await getUserScheduleSettings(db, userId);

  const rawRoutines = await db.prepare(`
    SELECT id, user_id, name, start_time, end_time, days, schedule_group, type, availability_type, created_at, updated_at
    FROM routines
    WHERE user_id = ?
    ORDER BY start_time ASC
  `).all(userId);
  const dbRoutines = (rawRoutines || []).map((r) => {
    let days = [];
    try {
      days = JSON.parse(r.days);
    } catch (e) {
      days = (r.days || '').split(',').map((s) => s.trim());
    }
    const scheduleGroup = r.schedule_group || (days.some((d) => ['Saturday', 'Sunday'].includes(d)) && !days.some((d) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(d)) ? 'weekends' : 'weekdays');
    return { ...r, schedule_group: scheduleGroup, days };
  });

  const formattedGoals = await Promise.all(dbGoals.map(async (g) => {
    const stats = await getGoalTaskStats(db, userId, g.id);
    const progress = stats.hasTasks ? stats.progress : (g.progress || 0);
    const goalTasks = dbTasks.filter((t) => t.goal_id === g.id);
    return {
      id: g.id,
      title: g.title,
      description: g.description || '',
      priority: g.priority || 'Medium',
      target_date: g.target_date,
      deadline: g.target_date,
      progress,
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      health: calculateGoalHealth({ ...g, progress }),
      created_at: g.created_at,
      updated_at: g.updated_at,
      tasks: goalTasks
    };
  }));

  const row = await db.prepare('SELECT payload FROM user_app_data WHERE user_id = ? AND entity_type = ?').get(userId, 'dashboard_state');

  if (!row || !row.payload) {
    // Clean Day-0 Cold Start (Zero State)
    const coverageStatus = await getRoutineCoverageStatus(db, req.user.id);
    const userPrefs = await getUserPreferences(db, req.user.id);
    return res.status(200).json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        created_at: req.user.created_at
      },
      isColdStart: formattedGoals.length === 0 && dbTasks.length === 0 && dbRoutines.length === 0,
      goals: formattedGoals,
      tasks: dbTasks,
      routines: dbRoutines,
      schedule_settings: scheduleSettings,
      has_valid_routine_setup: scheduleSettings.has_valid_routine_setup,
      needs_routine_setup: scheduleSettings.needs_routine_setup,
      routine_coverage_status: coverageStatus,
      is_routine_complete: coverageStatus.is_routine_complete,
      routine_coverage_incomplete: coverageStatus.routine_coverage_incomplete,
      incomplete_group: coverageStatus.incomplete_group,
      routine_warning_message: coverageStatus.message,
      preferences: userPrefs,
      user_preferences: userPrefs,
      metrics: {
        completedToday: dbTasks.filter((t) => t.completed).length,
        missedToday: 0,
        rescheduledToday: 0,
        streak: 0,
        focusHours: 0,
        totalCompletedTasks: dbTasks.filter((t) => t.completed).length
      },
      insights: [],
      activities: []
    });
  }

  try {
    const savedState = JSON.parse(row.payload);
    const coverageStatus = await getRoutineCoverageStatus(db, req.user.id);
    const userPrefs = await getUserPreferences(db, req.user.id);
    // Goals from dedicated table always take priority
    const finalGoals = formattedGoals.length > 0 ? formattedGoals : (Array.isArray(savedState.goals) ? savedState.goals.map(({ category, categoryIcon, ...rest }) => rest) : []);
    const finalTasks = dbTasks.length > 0 ? dbTasks : (savedState.tasks || []);
    const finalRoutines = dbRoutines.length > 0 ? dbRoutines : (savedState.routines || []);

    return res.status(200).json({
      ...savedState,
      goals: finalGoals,
      tasks: finalTasks,
      routines: finalRoutines,
      schedule_settings: scheduleSettings,
      has_valid_routine_setup: scheduleSettings.has_valid_routine_setup,
      needs_routine_setup: scheduleSettings.needs_routine_setup,
      routine_coverage_status: coverageStatus,
      is_routine_complete: coverageStatus.is_routine_complete,
      routine_coverage_incomplete: coverageStatus.routine_coverage_incomplete,
      incomplete_group: coverageStatus.incomplete_group,
      routine_warning_message: coverageStatus.message,
      preferences: userPrefs,
      user_preferences: userPrefs,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        created_at: req.user.created_at
      },
      isColdStart: finalGoals.length === 0 && finalTasks.length === 0 && finalRoutines.length === 0
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to parse saved state' });
  }
});

// POST /api/dashboard/data
// Mutates/saves the user's reactive dashboard state
router.post('/data', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { goals, tasks, routines, metrics, insights, activities } = req.body;

  // Sanitize goals: strictly remove any category or categoryIcon
  const sanitizedGoals = Array.isArray(goals) ? goals.map(({ category, categoryIcon, ...rest }) => rest) : [];

  const payload = JSON.stringify({
    goals: sanitizedGoals,
    tasks: tasks || [],
    routines: routines || [],
    metrics: metrics || { completedToday: 0, missedToday: 0, rescheduledToday: 0, streak: 0, focusHours: 0, totalCompletedTasks: 0 },
    insights: insights || [],
    activities: activities || []
  });

  const now = new Date().toISOString();
  const existing = await db.prepare('SELECT id FROM user_app_data WHERE user_id = ? AND entity_type = ?').get(userId, 'dashboard_state');

  if (existing) {
    await db.prepare('UPDATE user_app_data SET payload = ? WHERE id = ?').run(payload, existing.id);
  } else {
    await db.prepare('INSERT INTO user_app_data (user_id, entity_type, payload, created_at) VALUES (?, ?, ?, ?)').run(
      userId,
      'dashboard_state',
      payload,
      now
    );
  }

  return res.status(200).json({ success: true });
});

// POST /api/dashboard/load-sample
// Populates the collage demo dataset for quick evaluation
router.post('/load-sample', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const payload = JSON.stringify(SAMPLE_COLLAGE_DATA);
  const now = new Date().toISOString();

  const existing = await db.prepare('SELECT id FROM user_app_data WHERE user_id = ? AND entity_type = ?').get(userId, 'dashboard_state');
  if (existing) {
    await db.prepare('UPDATE user_app_data SET payload = ? WHERE id = ?').run(payload, existing.id);
  } else {
    await db.prepare('INSERT INTO user_app_data (user_id, entity_type, payload, created_at) VALUES (?, ?, ?, ?)').run(
      userId,
      'dashboard_state',
      payload,
      now
    );
  }

  return res.status(200).json({ success: true, data: SAMPLE_COLLAGE_DATA });
});

// POST /api/dashboard/reset
// Resets user back to clean Day-0 Cold Start
router.post('/reset', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  await db.prepare('DELETE FROM user_app_data WHERE user_id = ? AND entity_type = ?').run(userId, 'dashboard_state');
  return res.status(200).json({ success: true, message: 'Reset to Day-0 Cold Start' });
});

// GET /api/dashboard/settings
// Returns user notification preferences (strictly isolated by req.user.id)
router.get('/settings', requireAuth, async (req, res) => {
  const db = getDatabase();
  const settings = await getUserPreferences(db, req.user.id);
  return res.status(200).json({ success: true, settings });
});

// POST /api/dashboard/settings
// Updates user notification preferences (strictly isolated by req.user.id)
router.post('/settings', requireAuth, async (req, res) => {
  const db = getDatabase();
  const settings = await saveUserPreferences(db, req.user.id, req.body || {});
  return res.status(200).json({ success: true, settings });
});

module.exports = router;
