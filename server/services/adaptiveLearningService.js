/**
 * EKAGRA — Online Adaptive Learning & Real ML Behavioral Engine
 * 
 * Implements:
 * 1. Model 1: Online Adaptive Pace Calibration (Speed Learner via EWMA).
 * 2. Model 2: Focus Quality & Slip Risk Classifier (Beta-Binomial Bayesian Update).
 * 3. Model 3: Rolling-Velocity Goal Health Forecaster (7-day rolling burn rate).
 * 
 * Strict User Isolation: All learning records are strictly isolated by authenticated user_id.
 */

const { parseTimeToMinutes } = require('./routineService');

const TIME_BUCKETS = ['morning', 'afternoon', 'evening', 'night'];

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

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

function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Maps a 24h HH:MM time string to a standard 4-phase time bucket:
 * - morning:   05:00 – 11:59
 * - afternoon: 12:00 – 16:59
 * - evening:   17:00 – 20:59
 * - night:     21:00 – 04:59
 */
function getTimeBucket(timeStr) {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return 'morning';

  if (mins >= 300 && mins < 720) return 'morning';       // 05:00 - 11:59
  if (mins >= 720 && mins < 1020) return 'afternoon';     // 12:00 - 16:59
  if (mins >= 1020 && mins < 1260) return 'evening';     // 17:00 - 20:59
  return 'night';                                        // 21:00 - 04:59
}

/**
 * Gets or creates the online adaptive profile for the given user (Sync).
 */
function getUserLearningProfileSync(db, userId) {
  if (!userId) return null;

  let profile = db.prepare('SELECT * FROM user_learning_profile WHERE user_id = ?').get(userId);
  if (!profile) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_learning_profile (
        user_id, pace_factor, completed_count, calibrated_count,
        alpha_morning, beta_morning,
        alpha_afternoon, beta_afternoon,
        alpha_evening, beta_evening,
        alpha_night, beta_night,
        updated_at
      ) VALUES (?, 1.0, 0, 0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, ?)
    `).run(userId, now);

    profile = db.prepare('SELECT * FROM user_learning_profile WHERE user_id = ?').get(userId);
  }

  if (profile && profile.calibrated_count === undefined) {
    profile.calibrated_count = 0;
  }
  return profile;
}

/**
 * Gets or creates the online adaptive profile for the given user (Async).
 */
async function getUserLearningProfileAsync(db, userId) {
  if (!userId) return null;

  let profile = await db.prepare('SELECT * FROM user_learning_profile WHERE user_id = ?').get(userId);
  if (!profile) {
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO user_learning_profile (
        user_id, pace_factor, completed_count, calibrated_count,
        alpha_morning, beta_morning,
        alpha_afternoon, beta_afternoon,
        alpha_evening, beta_evening,
        alpha_night, beta_night,
        updated_at
      ) VALUES (?, 1.0, 0, 0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, ?)
    `).run(userId, now);

    profile = await db.prepare('SELECT * FROM user_learning_profile WHERE user_id = ?').get(userId);
  }

  if (profile && profile.calibrated_count === undefined) {
    profile.calibrated_count = 0;
  }
  return profile;
}

function getUserLearningProfile(db, userId) {
  if (db && db.isTurso) {
    return getUserLearningProfileAsync(db, userId);
  }
  return getUserLearningProfileSync(db, userId);
}

/**
 * Calculates Beta-Binomial completion probability and slip risk for a bucket.
 */
function getBucketStats(profileOrAlpha, bucketOrBeta) {
  let alpha = 2.0;
  let beta = 2.0;
  let b = 'morning';

  if (typeof profileOrAlpha === 'number') {
    alpha = profileOrAlpha;
    beta = typeof bucketOrBeta === 'number' ? bucketOrBeta : 2.0;
  } else if (profileOrAlpha && typeof profileOrAlpha === 'object') {
    b = TIME_BUCKETS.includes(bucketOrBeta) ? bucketOrBeta : 'morning';
    alpha = Number(profileOrAlpha[`alpha_${b}`]) || 2.0;
    beta = Number(profileOrAlpha[`beta_${b}`]) || 2.0;
  }

  const a = Math.max(alpha, 0.5);
  const bt = Math.max(beta, 0.5);
  const p = a / (a + bt);
  const pComplete = Math.round(p * 1000) / 1000;
  const slipRisk = Math.round((1 - p) * 1000) / 1000;

  return {
    bucket: b,
    alpha: a,
    beta: bt,
    p_complete: pComplete,
    completion_rate: Math.round(p * 100),
    slip_risk: slipRisk
  };
}

/**
 * Helper to compute stats for all 4 time buckets from a user profile.
 */
function getAllBucketStats(profile) {
  const result = {};
  for (const b of TIME_BUCKETS) {
    const alpha = profile ? profile[`alpha_${b}`] : 2.0;
    const beta = profile ? profile[`beta_${b}`] : 2.0;
    result[b] = getBucketStats(alpha, beta);
  }
  return result;
}

/**
 * Model 1 (EWMA Pace) & Model 2 (Focus Quality Update) on Task Completion (Sync).
 */
function recordTaskCompletionSync(db, userId, data) {
  const {
    taskId,
    goalId = null,
    goalPriority = 'Medium',
    taskPriority = 'Medium',
    estimatedMinutes = 0,
    actualMinutes = 0,
    timeBucket = 'morning',
    dayType = 'weekday',
    outcome = 'completed'
  } = data;

  const isVerified = (data.duration_verified !== undefined)
    ? Boolean(data.duration_verified)
    : (data.durationVerified !== undefined ? Boolean(data.durationVerified) : (actualMinutes !== undefined && Number(actualMinutes) > 0));
  const durationVerifiedInt = isVerified ? 1 : 0;

  const profile = getUserLearningProfileSync(db, userId);
  const validBucket = TIME_BUCKETS.includes(timeBucket) ? timeBucket : 'morning';
  const validDayType = ['weekday', 'weekend'].includes(dayType) ? dayType : 'weekday';

  let newPaceFactor = Number(profile.pace_factor) || 1.0;
  const currentCompletedCount = Number(profile.completed_count) || 0;
  const nextCompletedCount = currentCompletedCount + 1;
  let nextCalibratedCount = Number(profile.calibrated_count) || 0;

  if (isVerified) {
    nextCalibratedCount += 1;
    if (estimatedMinutes > 0 && actualMinutes > 0) {
      const ratio = clamp(actualMinutes / estimatedMinutes, 0.5, 2.5);
      if (nextCalibratedCount < 3) {
        newPaceFactor = 1.0;
      } else {
        newPaceFactor = clamp(0.3 * ratio + 0.7 * (Number(profile.pace_factor) || 1.0), 0.7, 2.0);
      }
    }
  }

  const alphaCol = `alpha_${validBucket}`;
  const newAlpha = (profile[alphaCol] || 2.0) + 1.0;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE user_learning_profile
    SET pace_factor = ?,
        completed_count = ?,
        calibrated_count = ?,
        ${alphaCol} = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(Math.round(newPaceFactor * 1000) / 1000, nextCompletedCount, nextCalibratedCount, newAlpha, now, userId);

  const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const finalActualMinutes = (actualMinutes && Number(actualMinutes) > 0) ? Math.round(Number(actualMinutes)) : Math.round(estimatedMinutes);

  db.prepare(`
    INSERT INTO execution_logs (
      id, user_id, task_id, goal_id, goal_priority, task_priority,
      estimated_minutes, actual_minutes, duration_verified, outcome, time_bucket, day_type, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    logId,
    userId,
    taskId,
    goalId,
    goalPriority,
    taskPriority,
    Math.round(estimatedMinutes),
    finalActualMinutes,
    durationVerifiedInt,
    outcome,
    validBucket,
    validDayType,
    now
  );

  return {
    success: true,
    log_id: logId,
    new_pace_factor: Math.round(newPaceFactor * 1000) / 1000,
    completed_count: nextCompletedCount,
    calibrated_count: nextCalibratedCount,
    duration_verified: isVerified,
    bucket_updated: validBucket,
    new_alpha: newAlpha
  };
}

/**
 * Model 1 & Model 2 on Task Completion (Async).
 */
async function recordTaskCompletionAsync(db, userId, data) {
  const {
    taskId,
    goalId = null,
    goalPriority = 'Medium',
    taskPriority = 'Medium',
    estimatedMinutes = 0,
    actualMinutes = 0,
    timeBucket = 'morning',
    dayType = 'weekday',
    outcome = 'completed'
  } = data;

  const isVerified = (data.duration_verified !== undefined)
    ? Boolean(data.duration_verified)
    : (data.durationVerified !== undefined ? Boolean(data.durationVerified) : (actualMinutes !== undefined && Number(actualMinutes) > 0));
  const durationVerifiedInt = isVerified ? 1 : 0;

  const profile = await getUserLearningProfileAsync(db, userId);
  const validBucket = TIME_BUCKETS.includes(timeBucket) ? timeBucket : 'morning';
  const validDayType = ['weekday', 'weekend'].includes(dayType) ? dayType : 'weekday';

  let newPaceFactor = Number(profile.pace_factor) || 1.0;
  const currentCompletedCount = Number(profile.completed_count) || 0;
  const nextCompletedCount = currentCompletedCount + 1;
  let nextCalibratedCount = Number(profile.calibrated_count) || 0;

  if (isVerified) {
    nextCalibratedCount += 1;
    if (estimatedMinutes > 0 && actualMinutes > 0) {
      const ratio = clamp(actualMinutes / estimatedMinutes, 0.5, 2.5);
      if (nextCalibratedCount < 3) {
        newPaceFactor = 1.0;
      } else {
        newPaceFactor = clamp(0.3 * ratio + 0.7 * (Number(profile.pace_factor) || 1.0), 0.7, 2.0);
      }
    }
  }

  const alphaCol = `alpha_${validBucket}`;
  const newAlpha = (profile[alphaCol] || 2.0) + 1.0;
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE user_learning_profile
    SET pace_factor = ?,
        completed_count = ?,
        calibrated_count = ?,
        ${alphaCol} = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(Math.round(newPaceFactor * 1000) / 1000, nextCompletedCount, nextCalibratedCount, newAlpha, now, userId);

  const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const finalActualMinutes = (actualMinutes && Number(actualMinutes) > 0) ? Math.round(Number(actualMinutes)) : Math.round(estimatedMinutes);

  await db.prepare(`
    INSERT INTO execution_logs (
      id, user_id, task_id, goal_id, goal_priority, task_priority,
      estimated_minutes, actual_minutes, duration_verified, outcome, time_bucket, day_type, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    logId,
    userId,
    taskId,
    goalId,
    goalPriority,
    taskPriority,
    Math.round(estimatedMinutes),
    finalActualMinutes,
    durationVerifiedInt,
    outcome,
    validBucket,
    validDayType,
    now
  );

  return {
    success: true,
    log_id: logId,
    new_pace_factor: Math.round(newPaceFactor * 1000) / 1000,
    completed_count: nextCompletedCount,
    calibrated_count: nextCalibratedCount,
    duration_verified: isVerified,
    bucket_updated: validBucket,
    new_alpha: newAlpha
  };
}

function recordTaskCompletion(db, userId, data) {
  if (db && db.isTurso) {
    return recordTaskCompletionAsync(db, userId, data);
  }
  return recordTaskCompletionSync(db, userId, data);
}

/**
 * Model 2 Update on Task Missed or Rescheduled (Sync).
 */
function recordTaskMissOrRescheduleSync(db, userId, data) {
  const {
    taskId,
    goalId = null,
    goalPriority = 'Medium',
    taskPriority = 'Medium',
    estimatedMinutes = 0,
    timeBucket = 'morning',
    dayType = 'weekday',
    outcome = 'missed'
  } = data;

  const profile = getUserLearningProfileSync(db, userId);
  const validBucket = TIME_BUCKETS.includes(timeBucket) ? timeBucket : 'morning';
  const validDayType = ['weekday', 'weekend'].includes(dayType) ? dayType : 'weekday';

  const betaCol = `beta_${validBucket}`;
  const newBeta = (profile[betaCol] || 2.0) + 1.0;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE user_learning_profile
    SET ${betaCol} = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(newBeta, now, userId);

  const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  db.prepare(`
    INSERT INTO execution_logs (
      id, user_id, task_id, goal_id, goal_priority, task_priority,
      estimated_minutes, actual_minutes, outcome, time_bucket, day_type, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    logId,
    userId,
    taskId,
    goalId,
    goalPriority,
    taskPriority,
    Math.round(estimatedMinutes),
    outcome,
    validBucket,
    validDayType,
    now
  );

  return {
    success: true,
    log_id: logId,
    bucket_updated: validBucket,
    new_beta: newBeta
  };
}

/**
 * Model 2 Update on Task Missed or Rescheduled (Async).
 */
async function recordTaskMissOrRescheduleAsync(db, userId, data) {
  const {
    taskId,
    goalId = null,
    goalPriority = 'Medium',
    taskPriority = 'Medium',
    estimatedMinutes = 0,
    timeBucket = 'morning',
    dayType = 'weekday',
    outcome = 'missed'
  } = data;

  const profile = await getUserLearningProfileAsync(db, userId);
  const validBucket = TIME_BUCKETS.includes(timeBucket) ? timeBucket : 'morning';
  const validDayType = ['weekday', 'weekend'].includes(dayType) ? dayType : 'weekday';

  const betaCol = `beta_${validBucket}`;
  const newBeta = (profile[betaCol] || 2.0) + 1.0;
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE user_learning_profile
    SET ${betaCol} = ?,
        updated_at = ?
    WHERE user_id = ?
  `).run(newBeta, now, userId);

  const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await db.prepare(`
    INSERT INTO execution_logs (
      id, user_id, task_id, goal_id, goal_priority, task_priority,
      estimated_minutes, actual_minutes, outcome, time_bucket, day_type, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    logId,
    userId,
    taskId,
    goalId,
    goalPriority,
    taskPriority,
    Math.round(estimatedMinutes),
    outcome,
    validBucket,
    validDayType,
    now
  );

  return {
    success: true,
    log_id: logId,
    bucket_updated: validBucket,
    new_beta: newBeta
  };
}

function recordTaskMissOrReschedule(db, userId, data) {
  if (db && db.isTurso) {
    return recordTaskMissOrRescheduleAsync(db, userId, data);
  }
  return recordTaskMissOrRescheduleSync(db, userId, data);
}

/**
 * Calculates user's available daily routine minutes (Sync).
 */
function getUserDailyAvailableMinutesSync(db, userId) {
  try {
    const routines = db.prepare(`
      SELECT start_time, end_time, availability_type, schedule_group, days
      FROM routines
      WHERE user_id = ?
    `).all(userId);

    if (!routines || routines.length === 0) {
      return 180;
    }

    let weekdayAvailable = 0;
    let weekendAvailable = 0;

    for (const r of routines) {
      const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
      if (!isAvail) continue;

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

      if (group === 'weekends') {
        weekendAvailable += dur;
      } else {
        weekdayAvailable += dur;
      }
    }

    const avgDaily = (weekdayAvailable * 5 + weekendAvailable * 2) / 7;
    return avgDaily > 0 ? Math.round(avgDaily) : 180;
  } catch (err) {
    return 180;
  }
}

/**
 * Calculates user's available daily routine minutes (Async).
 */
async function getUserDailyAvailableMinutesAsync(db, userId) {
  try {
    const routines = await db.prepare(`
      SELECT start_time, end_time, availability_type, schedule_group, days
      FROM routines
      WHERE user_id = ?
    `).all(userId);

    if (!routines || routines.length === 0) {
      return 180;
    }

    let weekdayAvailable = 0;
    let weekendAvailable = 0;

    for (const r of routines) {
      const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
      if (!isAvail) continue;

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

      if (group === 'weekends') {
        weekendAvailable += dur;
      } else {
        weekdayAvailable += dur;
      }
    }

    const avgDaily = (weekdayAvailable * 5 + weekendAvailable * 2) / 7;
    return avgDaily > 0 ? Math.round(avgDaily) : 180;
  } catch (err) {
    return 180;
  }
}

function getUserDailyAvailableMinutes(db, userId) {
  if (db && db.isTurso) {
    return getUserDailyAvailableMinutesAsync(db, userId);
  }
  return getUserDailyAvailableMinutesSync(db, userId);
}

/**
 * Model 3 — Rolling-Velocity Goal Health Forecaster (Sync).
 */
function computeGoalForecastSync(db, userId, goalId) {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId);
  if (!goal) return null;

  const tasks = db.prepare('SELECT * FROM tasks WHERE goal_id = ? AND user_id = ?').all(goalId, userId);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => Boolean(t.completed));
  const incompleteTasks = tasks.filter((t) => !t.completed);

  if (totalTasks === 0) {
    return {
      status: 'Needs Tasks',
      health: 'On Track',
      total_tasks: 0,
      completed_tasks: 0,
      remaining_minutes: 0,
      days_left: 0,
      days_needed: 0,
      burn_rate_mins_day: 0,
      projected_completion_date: null
    };
  }

  let remainingMinutes = 0;
  for (const t of incompleteTasks) {
    remainingMinutes += (t.duration_minutes && t.duration_minutes > 0 ? t.duration_minutes : 30);
  }

  if (remainingMinutes === 0 && totalTasks > 0) {
    return {
      status: 'Completed',
      health: 'On Track',
      total_tasks: totalTasks,
      completed_tasks: completedTasks.length,
      remaining_minutes: 0,
      days_left: 0,
      days_needed: 0,
      burn_rate_mins_day: 0,
      projected_completion_date: getLocalDateString(new Date())
    };
  }

  const targetDate = parseLocalDate(goal.target_date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const targetDay = targetDate ? new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 12, 0, 0) : today;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLeft = Math.max(0, Math.round((targetDay - today) / msPerDay));

  const aGoal = getUserDailyAvailableMinutesSync(db, userId);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const logs = db.prepare(`
    SELECT actual_minutes, outcome, logged_at
    FROM execution_logs
    WHERE user_id = ? AND logged_at >= ? AND outcome = 'completed'
  `).all(userId, sevenDaysAgo);

  const completedMinutes7d = logs.reduce((sum, l) => sum + (Number(l.actual_minutes) || 0), 0);
  const v7dayAvg = completedMinutes7d / 7;

  const logCountRow = db.prepare('SELECT count(*) as count FROM execution_logs WHERE user_id = ?').get(userId);
  const totalLogs = logCountRow ? logCountRow.count : 0;

  let burnRate = aGoal;
  if (totalLogs >= 3) {
    burnRate = 0.6 * v7dayAvg + 0.4 * aGoal;
  }

  const effectiveRate = Math.max(burnRate, 15);
  const daysNeeded = remainingMinutes / effectiveRate;

  let status = 'On Track';
  if (daysLeft === 0 && remainingMinutes > 0) {
    status = 'Behind';
  } else if (daysNeeded <= daysLeft) {
    status = 'On Track';
  } else if (daysNeeded <= 1.35 * daysLeft) {
    status = 'At Risk';
  } else {
    status = 'Behind';
  }

  const projDate = new Date();
  projDate.setDate(projDate.getDate() + Math.ceil(daysNeeded));
  const projectedCompletionDate = getLocalDateString(projDate);

  return {
    status,
    health: status,
    total_tasks: totalTasks,
    completed_tasks: completedTasks.length,
    remaining_minutes: remainingMinutes,
    days_left: daysLeft,
    days_needed: Math.round(daysNeeded * 10) / 10,
    burn_rate_mins_day: Math.round(burnRate),
    projected_completion_date: projectedCompletionDate,
    a_goal: aGoal,
    v_7day_avg: Math.round(v7dayAvg)
  };
}

/**
 * Model 3 — Rolling-Velocity Goal Health Forecaster (Async).
 */
async function computeGoalForecastAsync(db, userId, goalId) {
  const goal = await db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(goalId, userId);
  if (!goal) return null;

  const tasks = await db.prepare('SELECT * FROM tasks WHERE goal_id = ? AND user_id = ?').all(goalId, userId);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => Boolean(t.completed));
  const incompleteTasks = tasks.filter((t) => !t.completed);

  if (totalTasks === 0) {
    return {
      status: 'Needs Tasks',
      health: 'On Track',
      total_tasks: 0,
      completed_tasks: 0,
      remaining_minutes: 0,
      days_left: 0,
      days_needed: 0,
      burn_rate_mins_day: 0,
      projected_completion_date: null
    };
  }

  let remainingMinutes = 0;
  for (const t of incompleteTasks) {
    remainingMinutes += (t.duration_minutes && t.duration_minutes > 0 ? t.duration_minutes : 30);
  }

  if (remainingMinutes === 0 && totalTasks > 0) {
    return {
      status: 'Completed',
      health: 'On Track',
      total_tasks: totalTasks,
      completed_tasks: completedTasks.length,
      remaining_minutes: 0,
      days_left: 0,
      days_needed: 0,
      burn_rate_mins_day: 0,
      projected_completion_date: getLocalDateString(new Date())
    };
  }

  const targetDate = parseLocalDate(goal.target_date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const targetDay = targetDate ? new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 12, 0, 0) : today;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysLeft = Math.max(0, Math.round((targetDay - today) / msPerDay));

  const aGoal = await getUserDailyAvailableMinutesAsync(db, userId);

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const logs = await db.prepare(`
    SELECT actual_minutes, outcome, logged_at
    FROM execution_logs
    WHERE user_id = ? AND logged_at >= ? AND outcome = 'completed'
  `).all(userId, sevenDaysAgo);

  const completedMinutes7d = logs.reduce((sum, l) => sum + (Number(l.actual_minutes) || 0), 0);
  const v7dayAvg = completedMinutes7d / 7;

  const logCountRow = await db.prepare('SELECT count(*) as count FROM execution_logs WHERE user_id = ?').get(userId);
  const totalLogs = logCountRow ? logCountRow.count : 0;

  let burnRate = aGoal;
  if (totalLogs >= 3) {
    burnRate = 0.6 * v7dayAvg + 0.4 * aGoal;
  }

  const effectiveRate = Math.max(burnRate, 15);
  const daysNeeded = remainingMinutes / effectiveRate;

  let status = 'On Track';
  if (daysLeft === 0 && remainingMinutes > 0) {
    status = 'Behind';
  } else if (daysNeeded <= daysLeft) {
    status = 'On Track';
  } else if (daysNeeded <= 1.35 * daysLeft) {
    status = 'At Risk';
  } else {
    status = 'Behind';
  }

  const projDate = new Date();
  projDate.setDate(projDate.getDate() + Math.ceil(daysNeeded));
  const projectedCompletionDate = getLocalDateString(projDate);

  return {
    status,
    health: status,
    total_tasks: totalTasks,
    completed_tasks: completedTasks.length,
    remaining_minutes: remainingMinutes,
    days_left: daysLeft,
    days_needed: Math.round(daysNeeded * 10) / 10,
    burn_rate_mins_day: Math.round(burnRate),
    projected_completion_date: projectedCompletionDate,
    a_goal: aGoal,
    v_7day_avg: Math.round(v7dayAvg)
  };
}

function computeGoalForecast(db, userId, goalId) {
  if (db && db.isTurso) {
    return computeGoalForecastAsync(db, userId, goalId);
  }
  return computeGoalForecastSync(db, userId, goalId);
}

module.exports = {
  TIME_BUCKETS,
  clamp,
  getTimeBucket,
  getUserLearningProfile,
  getUserLearningProfileSync,
  getUserLearningProfileAsync,
  getBucketStats,
  getAllBucketStats,
  recordTaskCompletion,
  recordTaskCompletionSync,
  recordTaskCompletionAsync,
  recordTaskMissOrReschedule,
  recordTaskMissOrRescheduleSync,
  recordTaskMissOrRescheduleAsync,
  getUserDailyAvailableMinutes,
  getUserDailyAvailableMinutesSync,
  getUserDailyAvailableMinutesAsync,
  computeGoalForecast,
  computeGoalForecastSync,
  computeGoalForecastAsync
};
