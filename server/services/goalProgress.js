/**
 * EKAGRA Goal Progress Service
 * 
 * Computes goal progress strictly derived from its associated tasks.
 * Formula:
 *   progress = (completed tasks / total tasks) * 100
 * 
 * Strict User Isolation:
 *   Always scoped by authenticated user_id to ensure cross-user isolation.
 */

function getGoalTaskStatsSync(db, userId, goalId) {
  if (!db || !userId || !goalId) {
    return { progress: 0, totalTasks: 0, completedTasks: 0, hasTasks: false };
  }

  let totalTasks = 0;
  let completedTasks = 0;
  let hasTasks = false;

  // 1. Primary Source of Truth: SQLite tasks table
  try {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    if (tableExists) {
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
        FROM tasks 
        WHERE user_id = ? AND goal_id = ?
      `).get(userId, goalId);

      if (stats && Number(stats.total) > 0) {
        totalTasks = Number(stats.total) || 0;
        completedTasks = Number(stats.completed) || 0;
        hasTasks = true;
      }
    }
  } catch (err) {
    // Graceful fallback if table query fails
  }

  // 2. Secondary/Reactive Source: user_app_data (dashboard_state)
  if (!hasTasks) {
    try {
      const row = db.prepare("SELECT payload FROM user_app_data WHERE user_id = ? AND entity_type = 'dashboard_state'").get(userId);
      if (row && row.payload) {
        const state = JSON.parse(row.payload);
        if (Array.isArray(state.tasks) && state.tasks.length > 0) {
          const matchingTasks = state.tasks.filter((t) => (t.goalId === goalId || t.goal_id === goalId));
          if (matchingTasks.length > 0) {
            totalTasks = matchingTasks.length;
            completedTasks = matchingTasks.filter((t) => Boolean(t.completed)).length;
            hasTasks = true;
          }
        }
      }
    } catch (err) {
      // Graceful fallback if payload parsing fails
    }
  }

  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    progress,
    totalTasks,
    completedTasks,
    hasTasks
  };
}

async function getGoalTaskStatsAsync(db, userId, goalId) {
  if (!db || !userId || !goalId) {
    return { progress: 0, totalTasks: 0, completedTasks: 0, hasTasks: false };
  }

  let totalTasks = 0;
  let completedTasks = 0;
  let hasTasks = false;

  try {
    const tableExists = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'").get();
    if (tableExists) {
      const stats = await db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
        FROM tasks 
        WHERE user_id = ? AND goal_id = ?
      `).get(userId, goalId);

      if (stats && Number(stats.total) > 0) {
        totalTasks = Number(stats.total) || 0;
        completedTasks = Number(stats.completed) || 0;
        hasTasks = true;
      }
    }
  } catch (err) {}

  if (!hasTasks) {
    try {
      const row = await db.prepare("SELECT payload FROM user_app_data WHERE user_id = ? AND entity_type = 'dashboard_state'").get(userId);
      if (row && row.payload) {
        const state = JSON.parse(row.payload);
        if (Array.isArray(state.tasks) && state.tasks.length > 0) {
          const matchingTasks = state.tasks.filter((t) => (t.goalId === goalId || t.goal_id === goalId));
          if (matchingTasks.length > 0) {
            totalTasks = matchingTasks.length;
            completedTasks = matchingTasks.filter((t) => Boolean(t.completed)).length;
            hasTasks = true;
          }
        }
      }
    } catch (err) {}
  }

  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    progress,
    totalTasks,
    completedTasks,
    hasTasks
  };
}

function getGoalTaskStats(db, userId, goalId) {
  if (db && db.isTurso) {
    return getGoalTaskStatsAsync(db, userId, goalId);
  }
  return getGoalTaskStatsSync(db, userId, goalId);
}

module.exports = {
  getGoalTaskStats,
  getGoalTaskStatsSync,
  getGoalTaskStatsAsync,
};
