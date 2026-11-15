/**
 * EKAGRA Goal Health & Execution Pacing Engine
 * Classifies goals into 'On Track', 'At Risk', or 'Behind' based on:
 * - Deadline elapsed vs total timeline
 * - Current progress vs expected completion curve
 * - Days remaining threshold heuristics
 * - Task-derived neutral state for new / 0-task goals
 */

function parseLocalDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // If it's a date-only string like YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parts = trimmed.split('-');
      return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    }
    // Full ISO timestamp or parseable datetime string
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
    }
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function calculateGoalHealth(goal) {
  if (!goal) return 'On Track';

  const progress = Number(goal.progress) || 0;
  if (progress >= 100) {
    return 'On Track';
  }

  const rawTarget = goal.target_date || goal.deadline;
  if (!rawTarget) return 'On Track';

  const targetDate = parseLocalDate(rawTarget);
  if (!targetDate) return 'On Track';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 12, 0, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.round((targetDay - today) / msPerDay);

  // If deadline has passed and progress < 100%, status is Behind
  if (daysRemaining < 0) {
    return 'Behind';
  }

  // If goal has 0 tasks explicitly noted, status is neutral / On Track (never premature At Risk)
  if (goal.totalTasks === 0 || goal.total_tasks === 0 || (Array.isArray(goal.tasks) && goal.tasks.length === 0)) {
    return 'On Track';
  }

  // Parse creation date
  let createdDay = today;
  if (goal.created_at) {
    const parsedCreated = parseLocalDate(goal.created_at);
    if (parsedCreated) {
      createdDay = new Date(parsedCreated.getFullYear(), parsedCreated.getMonth(), parsedCreated.getDate(), 12, 0, 0);
    }
  }

  const totalDays = Math.max(1, Math.round((targetDay - createdDay) / msPerDay));
  const elapsedDays = Math.max(0, Math.round((today - createdDay) / msPerDay));

  // If brand new goal created today with 0 progress, it is neutral / On Track
  if (elapsedDays <= 0 && progress === 0) {
    return 'On Track';
  }

  // Imminent deadline warning checks (for goals with elapsed time)
  if (daysRemaining <= 3 && progress < 20) {
    return 'Behind';
  }
  if (daysRemaining <= 7 && progress < 15) {
    return 'At Risk';
  }

  // Timeline pacing calculation
  const expectedProgress = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  const delta = progress - expectedProgress;

  if (delta >= -15) {
    return 'On Track';
  } else if (delta >= -35) {
    return 'At Risk';
  } else {
    return 'Behind';
  }
}

module.exports = { calculateGoalHealth };
