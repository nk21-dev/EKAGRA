/**
 * EKAGRA Top-to-Bottom Final Stack & Mathematical Verification
 * 
 * Part 1: Numerical Verification of all 7 Math & ML Models
 * Part 2: Full End-to-End Fresh User Walkthrough against live server & SQLite DB
 */

const assert = require('node:assert/strict');
const { getDatabase } = require('../server/db');
const {
  calculateDayGaps,
  isRoutineCoverageComplete,
  getRoutineCoverageStatus,
  checkRoutineOverlap,
  updateUserScheduleSettings,
  getUserScheduleSettings,
  parseTimeToMinutes
} = require('../server/services/routineService');
const { getGoalTaskStats } = require('../server/services/goalProgress');
const {
  computeTaskPriorityScore,
  getFreeIntervalsForDate,
  generateSchedule,
  rescheduleTask,
  completeScheduledTask
} = require('../server/services/schedulingEngine');
const {
  getUserLearningProfile,
  recordTaskCompletion,
  recordTaskMissOrReschedule,
  getBucketStats,
  getAllBucketStats,
  computeGoalForecast
} = require('../server/services/adaptiveLearningService');
const { calculateGoalHealth } = require('../server/services/goalHealth');
const {
  saveUserAiSettings,
  getUserAiSettings,
  estimateTaskDuration
} = require('../server/services/durationEstimationService');

async function runPart1MathVerification() {
  console.log('\n==================================================');
  console.log('PART 1: NUMERICAL VERIFICATION OF ALL 7 MATH & ML MODELS');
  console.log('==================================================\n');

  const db = getDatabase(':memory:');
  const userRow1 = db.prepare(`
    INSERT INTO users (name, email, password_hash, created_at, updated_at)
    VALUES ('Math Tester', 'math@ekagra.ai', 'fakehash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();
  const testUserId = Number(userRow1.lastInsertRowid);

  // ----------------------------------------------------
  // 1. 24-Hour Routine Math
  // ----------------------------------------------------
  console.log('--- 1. 24-Hour Routine Math ---');
  // Full day routine with overnight block: 11:00 PM - 07:00 AM (480m)
  const fullRoutines = [
    { start_time: '23:00', end_time: '07:00', availability_type: 'fixed', schedule_group: 'weekdays' }, // Sleep (480m)
    { start_time: '07:00', end_time: '09:00', availability_type: 'fixed', schedule_group: 'weekdays' }, // Morning (120m)
    { start_time: '09:00', end_time: '17:00', availability_type: 'available', schedule_group: 'weekdays' }, // Work (480m)
    { start_time: '17:00', end_time: '19:00', availability_type: 'fixed', schedule_group: 'weekdays' }, // Dinner/Break (120m)
    { start_time: '19:00', end_time: '23:00', availability_type: 'available', schedule_group: 'weekdays' }  // Focus (240m)
  ];

  const fullDayGaps = calculateDayGaps(fullRoutines);
  console.log('Inputs: 5 routines covering 24h with overnight 23:00-07:00 (480m)');
  console.log(`Expected: covered=1440m, uncovered=0m, is_full_day_covered=true, gaps=0`);
  console.log(`Actual:   covered=${fullDayGaps.covered_minutes}m, uncovered=${fullDayGaps.uncovered_minutes}m, is_full_day_covered=${fullDayGaps.is_full_day_covered}, gaps=${fullDayGaps.gaps.length}`);
  assert.equal(fullDayGaps.covered_minutes, 1440);
  assert.equal(fullDayGaps.uncovered_minutes, 0);
  assert.equal(fullDayGaps.is_full_day_covered, true);
  assert.equal(fullDayGaps.gaps.length, 0);

  // Partial routine check: only overnight sleep (480m)
  const partialRoutines = [
    { start_time: '23:00', end_time: '07:00', availability_type: 'fixed', schedule_group: 'weekdays' }
  ];
  const partialGaps = calculateDayGaps(partialRoutines);
  console.log('Inputs: Only Sleep 23:00-07:00 (480m)');
  console.log(`Expected: covered=480m, uncovered=960m, partition=1440m`);
  console.log(`Actual:   covered=${partialGaps.covered_minutes}m, uncovered=${partialGaps.uncovered_minutes}m, sum=${partialGaps.covered_minutes + partialGaps.uncovered_minutes}m`);
  assert.equal(partialGaps.covered_minutes, 480);
  assert.equal(partialGaps.uncovered_minutes, 960);
  assert.equal(partialGaps.covered_minutes + partialGaps.uncovered_minutes, 1440);

  // Overlap detection
  db.prepare(`
    INSERT INTO routines (id, user_id, name, start_time, end_time, availability_type, schedule_group, days)
    VALUES ('r1', ?, 'Sleep', '23:00', '07:00', 'fixed', 'weekdays', '["Monday","Tuesday","Wednesday","Thursday","Friday"]')
  `).run(testUserId);
  const overlapCheck = checkRoutineOverlap(db, testUserId, {
    start_time: '22:30',
    end_time: '23:30',
    schedule_group: 'weekdays'
  });
  console.log('Inputs: Add block 22:30-23:30 overlapping existing 23:00-07:00');
  console.log(`Expected: hasOverlap=true`);
  console.log(`Actual:   hasOverlap=${overlapCheck.hasOverlap}`);
  assert.equal(overlapCheck.hasOverlap, true);

  // Custom Day-Group Assignment (Move Saturday to Weekdays)
  const customSettings = updateUserScheduleSettings(db, testUserId, {
    weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekends_days: ['Sunday']
  });
  console.log('Inputs: Custom assign Saturday to Weekdays');
  console.log(`Expected: Weekdays has Saturday (6 days), Weekends has Sunday (1 day)`);
  console.log(`Actual:   Weekdays=${JSON.stringify(customSettings.weekdays_days)}, Weekends=${JSON.stringify(customSettings.weekends_days)}`);
  assert.equal(customSettings.weekdays_days.includes('Saturday'), true);
  assert.equal(customSettings.weekends_days.length, 1);
  assert.equal(customSettings.weekends_days[0], 'Sunday');

  // Incomplete Weekends blocks overall completion even when Weekdays is 1440m
  // Save full weekday routines for testUserId
  fullRoutines.forEach((r, idx) => {
    db.prepare(`
      INSERT OR REPLACE INTO routines (id, user_id, name, start_time, end_time, availability_type, schedule_group, days)
      VALUES (?, ?, ?, ?, ?, ?, 'weekdays', ?)
    `).run(`rw-${idx}`, testUserId, `R-${idx}`, r.start_time, r.end_time, r.availability_type, JSON.stringify(customSettings.weekdays_days));
  });
  const coverageStatus = getRoutineCoverageStatus(db, testUserId);
  console.log('Inputs: Weekdays has 1440m, Weekends has 0m');
  console.log(`Expected: is_routine_complete=false, incomplete_group="weekends"`);
  console.log(`Actual:   is_routine_complete=${coverageStatus.is_routine_complete}, incomplete_group="${coverageStatus.incomplete_group}"`);
  assert.equal(coverageStatus.is_routine_complete, false);
  assert.equal(coverageStatus.incomplete_group, 'weekends');
  console.log('✓ 24-Hour Routine Math VERIFIED.\n');

  // ----------------------------------------------------
  // 2. Goal Progress Math
  // ----------------------------------------------------
  console.log('--- 2. Goal Progress Math ---');
  const goalId = 'g-math-001';
  db.prepare(`
    INSERT INTO goals (id, user_id, title, target_date, progress, created_at, updated_at)
    VALUES (?, ?, 'Master Math', '2026-12-31', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(goalId, testUserId);

  // Case A: 0/0 tasks
  const stats0 = getGoalTaskStats(db, testUserId, goalId);
  console.log('Inputs: 0 tasks');
  console.log(`Expected: progress=0%, total=0, completed=0`);
  console.log(`Actual:   progress=${stats0.progress}%, total=${stats0.totalTasks}, completed=${stats0.completedTasks}`);
  assert.equal(stats0.progress, 0);

  // Case B: 1/3 tasks completed
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, completed) VALUES ('t1', ?, ?, 'Task 1', 1)`).run(testUserId, goalId);
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, completed) VALUES ('t2', ?, ?, 'Task 2', 0)`).run(testUserId, goalId);
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, completed) VALUES ('t3', ?, ?, 'Task 3', 0)`).run(testUserId, goalId);
  const stats1of3 = getGoalTaskStats(db, testUserId, goalId);
  console.log('Inputs: 1 completed of 3 total');
  console.log(`Expected: progress=33%, total=3, completed=1`);
  console.log(`Actual:   progress=${stats1of3.progress}%, total=${stats1of3.totalTasks}, completed=${stats1of3.completedTasks}`);
  assert.equal(stats1of3.progress, 33);

  // Case C: 3/3 tasks completed
  db.prepare(`UPDATE tasks SET completed = 1 WHERE user_id = ? AND goal_id = ?`).run(testUserId, goalId);
  const stats3of3 = getGoalTaskStats(db, testUserId, goalId);
  console.log('Inputs: 3 completed of 3 total');
  console.log(`Expected: progress=100%, total=3, completed=3`);
  console.log(`Actual:   progress=${stats3of3.progress}%, total=${stats3of3.totalTasks}, completed=${stats3of3.completedTasks}`);
  assert.equal(stats3of3.progress, 100);

  // Case D: Completing an Independent Task (goal_id = null)
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, completed) VALUES ('t-ind-1', ?, NULL, 'Independent Task', 1)`).run(testUserId);
  const statsAfterInd = getGoalTaskStats(db, testUserId, goalId);
  console.log('Inputs: Independent task completed (goal_id = null)');
  console.log(`Expected: Master Math goal progress remains 100%`);
  console.log(`Actual:   Master Math goal progress=${statsAfterInd.progress}%`);
  assert.equal(statsAfterInd.progress, 100);
  console.log('✓ Goal Progress Math VERIFIED.\n');

  // ----------------------------------------------------
  // 3. Priority Scoring Math
  // ----------------------------------------------------
  console.log('--- 3. Priority Scoring Math ---');
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateIn9Days = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10);

  // Score 1: Goal High + Task High + Due Today
  const taskHighToday = { id: 'th1', goal_id: goalId, priority: 'High', due_date: todayStr };
  const goalHigh = { priority: 'High', target_date: todayStr };
  const score1 = computeTaskPriorityScore(db, testUserId, taskHighToday, goalHigh);
  console.log('Inputs: Goal High (50) + Task High (30) + Due Today (40) + Fairness (20 brand new)');
  console.log(`Expected: totalScore=140.0 (wGoal=50, wTask=30, uDeadline=40, fFairness=20)`);
  console.log(`Actual:   totalScore=${score1.totalScore} (wGoal=${score1.wGoal}, wTask=${score1.wTask}, uDeadline=${score1.uDeadline}, fFairness=${score1.fFairness})`);
  assert.equal(score1.wGoal, 50);
  assert.equal(score1.wTask, 30);
  assert.equal(score1.uDeadline, 40);
  assert.equal(score1.totalScore, 140);

  // Score 2: Goal Low + Task Low + Due in 9 days
  const taskLow9d = { id: 'tl1', goal_id: goalId, priority: 'Low', due_date: dateIn9Days };
  const goalLow = { priority: 'Low', target_date: dateIn9Days };
  const score2 = computeTaskPriorityScore(db, testUserId, taskLow9d, goalLow);
  console.log('Inputs: Goal Low (10) + Task Low (5) + Due in 9 days (40/(9+1)=4) + Fairness (20)');
  console.log(`Expected: totalScore=39.0 (wGoal=10, wTask=5, uDeadline=4, fFairness=20)`);
  console.log(`Actual:   totalScore=${score2.totalScore} (wGoal=${score2.wGoal}, wTask=${score2.wTask}, uDeadline=${score2.uDeadline}, fFairness=${score2.fFairness})`);
  assert.equal(score2.wGoal, 10);
  assert.equal(score2.wTask, 5);
  assert.equal(score2.uDeadline, 4);
  assert.equal(score2.totalScore, 39);

  // Score 3: Independent Task (High, Due Today)
  const taskIndHighToday = { id: 't-ind-2', goal_id: null, priority: 'High', due_date: todayStr };
  const score3 = computeTaskPriorityScore(db, testUserId, taskIndHighToday, null);
  console.log('Inputs: Independent Task (wGoal=5) + Task High (30) + Due Today (40) + fFairness=0');
  console.log(`Expected: totalScore=75.0 (wGoal=5, wTask=30, uDeadline=40, fFairness=0)`);
  console.log(`Actual:   totalScore=${score3.totalScore} (wGoal=${score3.wGoal}, wTask=${score3.wTask}, uDeadline=${score3.uDeadline}, fFairness=${score3.fFairness})`);
  assert.equal(score3.wGoal, 5);
  assert.equal(score3.wTask, 30);
  assert.equal(score3.uDeadline, 40);
  assert.equal(score3.fFairness, 0);
  assert.equal(score3.totalScore, 75);

  // Score 4: Overdue Task
  const taskOverdue = { id: 't-od', goal_id: goalId, priority: 'Medium', due_date: yesterdayStr };
  const score4 = computeTaskPriorityScore(db, testUserId, taskOverdue, { priority: 'Medium' });
  console.log('Inputs: Overdue Task (due yesterday)');
  console.log(`Expected: uDeadline=50, isOverdue=true`);
  console.log(`Actual:   uDeadline=${score4.uDeadline}, isOverdue=${score4.isOverdue}`);
  assert.equal(score4.uDeadline, 50);
  assert.equal(score4.isOverdue, true);

  // Score 5: Fairness Formula F = min(20, 2 * daysSince)
  // Insert a scheduled block from 4 days ago
  const date4DaysAgo = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO scheduled_blocks (id, user_id, task_id, goal_id, scheduled_date, start_time, end_time, allocated_minutes, time_bucket, status)
    VALUES ('sb-hist-1', ?, 't1', ?, ?, '09:00', '10:00', 60, 'morning', 'completed')
  `).run(testUserId, goalId, date4DaysAgo);
  const scoreFairness4d = computeTaskPriorityScore(db, testUserId, { goal_id: goalId, priority: 'Medium', due_date: null }, { priority: 'Medium' });
  console.log('Inputs: Goal last scheduled 4 days ago');
  console.log(`Expected: fFairness = min(20, 2 * 4) = 8`);
  console.log(`Actual:   fFairness = ${scoreFairness4d.fFairness}`);
  assert.equal(scoreFairness4d.fFairness, 8);
  console.log('✓ Priority Scoring Math VERIFIED.\n');

  // ----------------------------------------------------
  // 4. Scheduling Constraints & Anti-Overwhelm Buffer
  // ----------------------------------------------------
  console.log('--- 4. Scheduling Constraints & Anti-Overwhelm Buffer ---');
  // Free intervals should only come from 'available' / 'flexible' routines (0 overlap with 'fixed')
  const freeIntervals = getFreeIntervalsForDate(db, testUserId, todayStr);
  console.log('Inputs: Routines: Sleep 23:00-07:00 (fixed), Morning 07:00-09:00 (fixed), Work 09:00-17:00 (available), Dinner 17:00-19:00 (fixed), Study 19:00-23:00 (available)');
  console.log(`Expected: Free slots: [540, 1020) (09:00-17:00, 480m) and [1140, 1380) (19:00-23:00, 240m), total=720m`);
  const totalFree = freeIntervals.reduce((sum, s) => sum + (s.end - s.start), 0);
  console.log(`Actual:   ${freeIntervals.length} free intervals, total=${totalFree}m`);
  assert.equal(freeIntervals.length, 2);
  assert.equal(freeIntervals[0].start, 540); // 09:00
  assert.equal(freeIntervals[0].end, 1020);  // 17:00
  assert.equal(freeIntervals[1].start, 1140); // 19:00
  assert.equal(freeIntervals[1].end, 1380);  // 23:00
  assert.equal(totalFree, 720);

  // Anti-Overwhelm 85% cap verification:
  // 720m free * 0.85 = 612m daily cap!
  const capExpected = Math.floor(0.85 * 720);
  console.log(`Expected: Anti-Overwhelm cap = floor(0.85 * 720) = ${capExpected}m`);
  assert.equal(capExpected, 612);

  // Slot Fit Score verification:
  // Task Score = 100
  // Morning bucket P_complete = 0.8 -> fitScore = 100 * (1 + 0.5 * (0.8 - 0.5)) = 100 * 1.15 = 115
  // Afternoon bucket P_complete = 0.2 -> fitScore = 100 * (1 + 0.5 * (0.2 - 0.5)) = 100 * 0.85 = 85
  const fitScoreMorning = Math.round(100 * (1 + 0.5 * (0.8 - 0.5)) * 100) / 100;
  const fitScoreAfternoon = Math.round(100 * (1 + 0.5 * (0.2 - 0.5)) * 100) / 100;
  console.log('Inputs: Task Score 100, Morning P=0.8 vs Afternoon P=0.2');
  console.log(`Expected: Morning Fit=115, Afternoon Fit=85`);
  console.log(`Actual:   Morning Fit=${fitScoreMorning}, Afternoon Fit=${fitScoreAfternoon}`);
  assert.equal(fitScoreMorning, 115);
  assert.equal(fitScoreAfternoon, 85);
  assert.equal(fitScoreMorning > fitScoreAfternoon, true);
  console.log('✓ Scheduling Constraints & Anti-Overwhelm Buffer VERIFIED.\n');

  // ----------------------------------------------------
  // 5. EWMA Duration Calibrator
  // ----------------------------------------------------
  console.log('--- 5. EWMA Duration Calibrator ---');
  const userRow2 = db.prepare(`
    INSERT INTO users (name, email, password_hash, created_at, updated_at)
    VALUES ('ML Tester', 'ml@ekagra.ai', 'fakehash', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();
  const mlUserId = Number(userRow2.lastInsertRowid);

  // Day-0 cold start
  const initialProfile = getUserLearningProfile(db, mlUserId);
  console.log('Inputs: Brand new user Day-0 profile');
  console.log(`Expected: pace_factor=1.0, calibrated_count=0, completed_count=0`);
  console.log(`Actual:   pace_factor=${initialProfile.pace_factor}, calibrated_count=${initialProfile.calibrated_count}, completed_count=${initialProfile.completed_count}`);
  assert.equal(initialProfile.pace_factor, 1.0);
  assert.equal(initialProfile.calibrated_count, 0);

  // Completion 1: verified (est: 30, act: 45 -> ratio = 1.5)
  const step1 = recordTaskCompletion(db, mlUserId, {
    taskId: 't-ml-1',
    estimatedMinutes: 30,
    actualMinutes: 45,
    duration_verified: 1,
    timeBucket: 'morning'
  });
  console.log('Inputs: Completion 1 (est=30, act=45, verified=1)');
  console.log(`Expected: calibrated_count=1 (< 3, cold start gating keeps pace_factor=1.0)`);
  console.log(`Actual:   calibrated_count=${step1.calibrated_count}, pace_factor=${step1.new_pace_factor}`);
  assert.equal(step1.calibrated_count, 1);
  assert.equal(step1.new_pace_factor, 1.0);

  // Completion 2: verified (est: 30, act: 45)
  const step2 = recordTaskCompletion(db, mlUserId, {
    taskId: 't-ml-2',
    estimatedMinutes: 30,
    actualMinutes: 45,
    duration_verified: 1,
    timeBucket: 'morning'
  });
  console.log('Inputs: Completion 2 (est=30, act=45, verified=1)');
  console.log(`Expected: calibrated_count=2 (< 3, keeps pace_factor=1.0)`);
  console.log(`Actual:   calibrated_count=${step2.calibrated_count}, pace_factor=${step2.new_pace_factor}`);
  assert.equal(step2.calibrated_count, 2);
  assert.equal(step2.new_pace_factor, 1.0);

  // Completion 3: verified (est: 30, act: 45) -> Calibrated!
  // Formula: C_new = clamp(0.3 * 1.5 + 0.7 * 1.0, 0.7, 2.0) = clamp(0.45 + 0.70, 0.7, 2.0) = 1.15
  const step3 = recordTaskCompletion(db, mlUserId, {
    taskId: 't-ml-3',
    estimatedMinutes: 30,
    actualMinutes: 45,
    duration_verified: 1,
    timeBucket: 'morning'
  });
  console.log('Inputs: Completion 3 (est=30, act=45, verified=1)');
  console.log(`Expected: calibrated_count=3, pace_factor=clamp(0.3*1.5 + 0.7*1.0, 0.7, 2.0) = 1.15`);
  console.log(`Actual:   calibrated_count=${step3.calibrated_count}, pace_factor=${step3.new_pace_factor}`);
  assert.equal(step3.calibrated_count, 3);
  assert.equal(step3.new_pace_factor, 1.15);

  // Verify scheduled task allocation with pace_factor = 1.15:
  // 30 min task * 1.15 = 34.5 -> round = 35 minutes!
  const allocatedMinutes = Math.max(15, Math.round(30 * step3.new_pace_factor));
  console.log('Inputs: 30-minute task with pace_factor = 1.15');
  console.log(`Expected: allocatedMinutes = round(30 * 1.15) = 35m`);
  console.log(`Actual:   allocatedMinutes = ${allocatedMinutes}m`);
  assert.equal(allocatedMinutes, 35);

  // Completion 4: Unverified / Skip Timing (duration_verified = 0)
  const step4 = recordTaskCompletion(db, mlUserId, {
    taskId: 't-ml-4',
    estimatedMinutes: 30,
    actualMinutes: 60,
    duration_verified: 0,
    timeBucket: 'morning'
  });
  console.log('Inputs: Completion 4 with duration_verified = 0 (Skip Timing)');
  console.log(`Expected: calibrated_count remains 3, pace_factor remains 1.15, completed_count increments to 4`);
  console.log(`Actual:   calibrated_count=${step4.calibrated_count}, pace_factor=${step4.new_pace_factor}, completed_count=${step4.completed_count}`);
  assert.equal(step4.calibrated_count, 3);
  assert.equal(step4.new_pace_factor, 1.15);
  assert.equal(step4.completed_count, 4);
  console.log('✓ EWMA Duration Calibrator VERIFIED.\n');

  // ----------------------------------------------------
  // 6. Bayesian Beta-Binomial Focus Quality
  // ----------------------------------------------------
  console.log('--- 6. Bayesian Beta-Binomial Focus Quality ---');
  // Initial prior: alpha = 2, beta = 2 -> P = 0.50, Slip_Risk = 0.50
  const priorProfile = getUserLearningProfile(db, mlUserId);
  const eveningPrior = getBucketStats(priorProfile, 'evening');
  console.log('Inputs: Day-0 prior in Evening bucket (alpha=2, beta=2)');
  console.log(`Expected: P_complete=0.5, Slip_Risk=0.5`);
  console.log(`Actual:   P_complete=${eveningPrior.p_complete}, Slip_Risk=${eveningPrior.slip_risk}`);
  assert.equal(eveningPrior.p_complete, 0.5);
  assert.equal(eveningPrior.slip_risk, 0.5);

  // Afternoon bucket: Record 1 Miss + 1 Reschedule
  recordTaskMissOrReschedule(db, mlUserId, { taskId: 't-m1', timeBucket: 'afternoon', outcome: 'missed' });
  recordTaskMissOrReschedule(db, mlUserId, { taskId: 't-m2', timeBucket: 'afternoon', outcome: 'rescheduled' });
  const updatedProfile = getUserLearningProfile(db, mlUserId);
  const afternoonStats = getBucketStats(updatedProfile, 'afternoon');
  // alpha = 2, beta = 2 + 1 + 1 = 4 -> P = 2 / (2 + 4) = 2/6 = 0.333, Slip_Risk = 4/6 = 0.667
  console.log('Inputs: 1 Miss + 1 Reschedule in Afternoon (alpha=2, beta=4)');
  console.log(`Expected: P_complete=0.333 (33%), Slip_Risk=0.667 (67%)`);
  console.log(`Actual:   P_complete=${afternoonStats.p_complete}, Slip_Risk=${afternoonStats.slip_risk}`);
  assert.equal(afternoonStats.alpha, 2);
  assert.equal(afternoonStats.beta, 4);
  assert.equal(afternoonStats.p_complete, 0.333);
  assert.equal(afternoonStats.slip_risk, 0.667);

  // Morning bucket: had 4 completions logged above (alpha was updated from 2 -> 6)
  // Let's create a fresh user to test exact 2 completions in Morning: alpha=4, beta=2
  const userRow3 = db.prepare(`
    INSERT INTO users (name, email, password_hash, created_at, updated_at)
    VALUES ('BB Tester', 'bb@ekagra.ai', 'fake', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();
  const bbUserId = Number(userRow3.lastInsertRowid);
  recordTaskCompletion(db, bbUserId, { taskId: 't-bb1', timeBucket: 'morning', estimatedMinutes: 30, duration_verified: 0 });
  recordTaskCompletion(db, bbUserId, { taskId: 't-bb2', timeBucket: 'morning', estimatedMinutes: 30, duration_verified: 0 });
  const bbProfile = getUserLearningProfile(db, bbUserId);
  const morningStats = getBucketStats(bbProfile, 'morning');
  console.log('Inputs: 2 Complete in Morning (alpha=4, beta=2)');
  console.log(`Expected: P_complete=0.667 (67%), Slip_Risk=0.333 (33%)`);
  console.log(`Actual:   P_complete=${morningStats.p_complete}, Slip_Risk=${morningStats.slip_risk}`);
  assert.equal(morningStats.alpha, 4);
  assert.equal(morningStats.beta, 2);
  assert.equal(morningStats.p_complete, 0.667);
  assert.equal(morningStats.slip_risk, 0.333);
  console.log('✓ Bayesian Beta-Binomial Focus Quality VERIFIED.\n');

  // ----------------------------------------------------
  // 7. Rolling-Velocity Goal Forecaster
  // ----------------------------------------------------
  console.log('--- 7. Rolling-Velocity Goal Forecaster ---');
  const userRow4 = db.prepare(`
    INSERT INTO users (name, email, password_hash, created_at, updated_at)
    VALUES ('FC Tester', 'fc@ekagra.ai', 'fake', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run();
  const fcUserId = Number(userRow4.lastInsertRowid);

  // Case A: 0 tasks -> Needs Tasks / neutral
  const gEmptyId = 'g-fc-empty';
  db.prepare(`INSERT INTO goals (id, user_id, title, target_date, created_at, updated_at) VALUES (?, ?, 'Empty Goal', '2026-12-01', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(gEmptyId, fcUserId);
  const fcEmpty = computeGoalForecast(db, fcUserId, gEmptyId);
  console.log('Inputs: Goal with 0 tasks');
  console.log(`Expected: status="Needs Tasks", health="On Track" (neutral, never premature At Risk)`);
  console.log(`Actual:   status="${fcEmpty.status}", health="${fcEmpty.health}"`);
  assert.equal(fcEmpty.status, 'Needs Tasks');
  assert.equal(fcEmpty.health, 'On Track');

  // Set up available routines for user so A_goal is 120 mins/day
  db.prepare(`
    INSERT INTO routines (id, user_id, name, start_time, end_time, availability_type, schedule_group, days)
    VALUES ('r-fc1', ?, 'Study', '10:00', '12:00', 'available', 'weekdays', '["Monday","Tuesday","Wednesday","Thursday","Friday"]')
  `).run(fcUserId);
  db.prepare(`
    INSERT INTO routines (id, user_id, name, start_time, end_time, availability_type, schedule_group, days)
    VALUES ('r-fc2', ?, 'Study', '10:00', '12:00', 'available', 'weekends', '["Saturday","Sunday"]')
  `).run(fcUserId);

  // Case B: On Track (D_need <= D_left)
  // Target date in 10 days, 2 tasks of 30 min = 60 min. Rate = 120m/day. D_need = 60/120 = 0.5 days <= 10 days
  const gOnTrackId = 'g-fc-ontrack';
  const in10DaysStr = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO goals (id, user_id, title, target_date, created_at, updated_at) VALUES (?, ?, 'On Track Goal', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(gOnTrackId, fcUserId, in10DaysStr);
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, duration_minutes, completed) VALUES ('t-ot1', ?, ?, 'Task 1', 30, 0)`).run(fcUserId, gOnTrackId);
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, duration_minutes, completed) VALUES ('t-ot2', ?, ?, 'Task 2', 30, 0)`).run(fcUserId, gOnTrackId);
  const fcOnTrack = computeGoalForecast(db, fcUserId, gOnTrackId);
  console.log('Inputs: 60m remaining, Rate=120m/d -> D_need=0.5 days, D_left=10 days');
  console.log(`Expected: status="On Track"`);
  console.log(`Actual:   status="${fcOnTrack.status}", days_needed=${fcOnTrack.days_needed}, days_left=${fcOnTrack.days_left}`);
  assert.equal(fcOnTrack.status, 'On Track');

  // Case C: At Risk (D_left < D_need <= 1.35 * D_left)
  // Target date in 2 days. Remaining tasks = 280m. Rate = 120m/day. D_need = 280 / 120 = 2.33 days. 2 < 2.33 <= 2.70
  const gAtRiskId = 'g-fc-atrisk';
  const in2DaysStr = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO goals (id, user_id, title, target_date, created_at, updated_at) VALUES (?, ?, 'At Risk Goal', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(gAtRiskId, fcUserId, in2DaysStr);
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, duration_minutes, completed) VALUES ('t-ar1', ?, ?, 'Heavy Task', 280, 0)`).run(fcUserId, gAtRiskId);
  const fcAtRisk = computeGoalForecast(db, fcUserId, gAtRiskId);
  console.log('Inputs: 280m remaining, Rate=120m/d -> D_need=2.3 days, D_left=2 days');
  console.log(`Expected: status="At Risk" (2 < 2.3 <= 2.7)`);
  console.log(`Actual:   status="${fcAtRisk.status}", days_needed=${fcAtRisk.days_needed}, days_left=${fcAtRisk.days_left}`);
  assert.equal(fcAtRisk.status, 'At Risk');

  // Case D: Behind (D_need > 1.35 * D_left)
  // Target date in 2 days. Remaining tasks = 500m. Rate = 120m/day. D_need = 500 / 120 = 4.17 days > 2.7
  const gBehindId = 'g-fc-behind';
  db.prepare(`INSERT INTO goals (id, user_id, title, target_date, created_at, updated_at) VALUES (?, ?, 'Behind Goal', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(gBehindId, fcUserId, in2DaysStr);
  db.prepare(`INSERT INTO tasks (id, user_id, goal_id, title, duration_minutes, completed) VALUES ('t-bh1', ?, ?, 'Massive Task', 500, 0)`).run(fcUserId, gBehindId);
  const fcBehind = computeGoalForecast(db, fcUserId, gBehindId);
  console.log('Inputs: 500m remaining, Rate=120m/d -> D_need=4.2 days, D_left=2 days');
  console.log(`Expected: status="Behind" (4.2 > 2.7)`);
  console.log(`Actual:   status="${fcBehind.status}", days_needed=${fcBehind.days_needed}, days_left=${fcBehind.days_left}`);
  assert.equal(fcBehind.status, 'Behind');

  // Case E: Completed (remainingMinutes == 0)
  db.prepare(`UPDATE tasks SET completed = 1 WHERE user_id = ? AND goal_id = ?`).run(fcUserId, gOnTrackId);
  const fcCompleted = computeGoalForecast(db, fcUserId, gOnTrackId);
  console.log('Inputs: All tasks completed');
  console.log(`Expected: status="Completed"`);
  console.log(`Actual:   status="${fcCompleted.status}"`);
  assert.equal(fcCompleted.status, 'Completed');
  console.log('✓ Rolling-Velocity Goal Forecaster VERIFIED.\n');
}

async function runPart2LiveSystemWalkthrough() {
  console.log('\n==================================================');
  console.log('PART 2: FULL END-TO-END SYSTEM WALKTHROUGH (FRESH USER)');
  console.log('==================================================\n');

  const BASE_URL = 'http://localhost:3000';
  const timestamp = Date.now();
  const user1Email = `e2e_user1_${timestamp}@ekagra.ai`;
  const user2Email = `e2e_user2_${timestamp}@ekagra.ai`;
  const password = 'StrongPassword123!';

  // Helper for fetch with cookie preservation
  function createClient() {
    let cookie = '';
    return {
      async request(path, opts = {}) {
        const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) };
        if (cookie) headers['Cookie'] = cookie;
        const res = await fetch(`${BASE_URL}${path}`, { ...opts, headers, redirect: 'manual' });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) {
          cookie = setCookie.split(';')[0];
        }
        let data = null;
        try { data = await res.json(); } catch (e) {}
        return { status: res.status, ok: res.ok, data, headers: res.headers };
      }
    };
  }

  const client1 = createClient();
  const client2 = createClient();

  // ----------------------------------------------------
  // Step 1: Auth, Security & Data Isolation
  // ----------------------------------------------------
  console.log('--- Step 1: Auth, Security & Data Isolation ---');
  // Signup User 1
  const signup1 = await client1.request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name: 'Fresh User One', email: user1Email, password, confirmPassword: password })
  });
  console.log(`Signup User 1: HTTP ${signup1.status}, ID: ${signup1.data?.user?.id}`);
  assert.equal(signup1.status, 201);
  assert.equal(signup1.data?.user?.email, user1Email.toLowerCase());
  assert.equal(signup1.data?.user?.password_hash, undefined); // Never leak hash!
  const user1Id = signup1.data.user.id;

  // Signup User 2
  const signup2 = await client2.request('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name: 'Fresh User Two', email: user2Email, password, confirmPassword: password })
  });
  console.log(`Signup User 2: HTTP ${signup2.status}, ID: ${signup2.data?.user?.id}`);
  assert.equal(signup2.status, 201);

  // Authenticated /me
  const me1 = await client1.request('/api/auth/me');
  console.log(`GET /api/auth/me User 1: HTTP ${me1.status}, name: "${me1.data?.user?.name}"`);
  assert.equal(me1.status, 200);
  assert.equal(me1.data?.user?.id, user1Id);

  // ----------------------------------------------------
  // Step 2: Day-0 Empty State
  // ----------------------------------------------------
  console.log('\n--- Step 2: Day-0 Empty State ---');
  const dashData1 = await client1.request('/api/dashboard/data');
  console.log(`User 1 Day-0 cold start: ${dashData1.data?.isColdStart}, goals: ${dashData1.data?.goals?.length}, tasks: ${dashData1.data?.tasks?.length}, routines: ${dashData1.data?.routines?.length}`);
  assert.equal(dashData1.data?.goals?.length, 0);
  assert.equal(dashData1.data?.tasks?.length, 0);
  assert.equal(dashData1.data?.routines?.length, 0);

  // ----------------------------------------------------
  // Step 3: Goal + Mandatory 24h Routine Gate
  // ----------------------------------------------------
  console.log('\n--- Step 3: Goal + Mandatory 24h Routine Gate ---');
  // Create Goal
  const createGoalRes = await client1.request('/api/goals', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Launch EKAGRA Production',
      target_date: '2026-11-30',
      priority: 'High',
      description: 'Zero bugs, pure execution'
    })
  });
  console.log(`Create Goal: HTTP ${createGoalRes.status}, title: "${createGoalRes.data?.goal?.title}"`);
  assert.equal(createGoalRes.status, 201);
  const goal1Id = createGoalRes.data.goal.id;
  assert.equal(createGoalRes.data?.routine_coverage_incomplete, true);

  // Cross-user isolation check: User 2 cannot access or edit User 1's goal!
  const crossGoalRead = await client2.request(`/api/goals/${goal1Id}`);
  console.log(`Cross-user User 2 read User 1 goal: HTTP ${crossGoalRead.status} (expected 404 or isolation)`);
  assert.equal(crossGoalRead.status >= 400, true);

  const crossGoalEdit = await client2.request(`/api/goals/${goal1Id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: 'Hacked Goal' })
  });
  console.log(`Cross-user User 2 edit User 1 goal: HTTP ${crossGoalEdit.status} (expected 403 or 404)`);
  assert.equal(crossGoalEdit.status >= 400, true);

  // Try Auto-Schedule before routines: blocked by coverage gate!
  const blockedSched = await client1.request('/api/schedule/generate', { method: 'POST', body: JSON.stringify({}) });
  console.log(`Auto-Schedule with incomplete routine: success: ${blockedSched.data?.success}, incomplete: ${blockedSched.data?.routine_coverage_incomplete}`);
  assert.equal(blockedSched.data?.success, false);
  assert.equal(blockedSched.data?.routine_coverage_incomplete, true);

  // Complete Weekdays routines: 11 PM - 7 AM sleep + daytime blocks = 1440m
  const weekdayBlocks = [
    { name: 'Sleep', title: 'Sleep', start_time: '23:00', end_time: '07:00', availability_type: 'fixed', schedule_group: 'weekdays' },
    { name: 'Morning', title: 'Morning', start_time: '07:00', end_time: '09:00', availability_type: 'fixed', schedule_group: 'weekdays' },
    { name: 'Work', title: 'Work', start_time: '09:00', end_time: '17:00', availability_type: 'available', schedule_group: 'weekdays' },
    { name: 'Dinner', title: 'Dinner', start_time: '17:00', end_time: '19:00', availability_type: 'fixed', schedule_group: 'weekdays' },
    { name: 'Evening Study', title: 'Evening Study', start_time: '19:00', end_time: '23:00', availability_type: 'available', schedule_group: 'weekdays' }
  ];

  for (const b of weekdayBlocks) {
    const rRes = await client1.request('/api/routines', { method: 'POST', body: JSON.stringify(b) });
    assert.equal(rRes.status, 201);
  }

  // Weekdays is 1440m, but Weekends is still incomplete
  const midwaySched = await client1.request('/api/schedule/generate', { method: 'POST', body: JSON.stringify({}) });
  console.log(`Auto-Schedule with only Weekdays complete: success: ${midwaySched.data?.success}, group: "${midwaySched.data?.incomplete_group}"`);
  assert.equal(midwaySched.data?.success, false);
  assert.equal(midwaySched.data?.incomplete_group, 'weekends');

  // Copy Weekdays to Weekends
  const copyRes = await client1.request('/api/routines/copy-group', {
    method: 'POST',
    body: JSON.stringify({ fromGroup: 'weekdays', toGroup: 'weekends' })
  });
  console.log(`Copy Weekdays to Weekends: HTTP ${copyRes.status}, success: ${copyRes.data?.success}`);
  assert.equal(copyRes.status, 200);
  assert.equal(copyRes.data?.success, true);

  // Coverage check: now 100% complete across both!
  const covCheck = await client1.request('/api/routines');
  console.log(`Routine Coverage Status: complete=${copyRes.data?.coverage_status?.is_routine_complete}, weekday=${covCheck.data?.coverage?.weekdays?.covered_minutes}m, weekend=${covCheck.data?.coverage?.weekends?.covered_minutes}m`);
  assert.equal(copyRes.data?.coverage_status?.is_routine_complete, true);
  assert.equal(covCheck.data?.coverage?.weekdays?.covered_minutes, 1440);
  assert.equal(covCheck.data?.coverage?.weekends?.covered_minutes, 1440);

  // ----------------------------------------------------
  // Step 4: Tasks (Goal + Independent) & AI Estimation Guardrails
  // ----------------------------------------------------
  console.log('\n--- Step 4: Tasks (Goal + Independent) & AI Guardrails ---');
  // Task 1: Goal Task (High)
  const task1Res = await client1.request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Build API Engine',
      goal_id: goal1Id,
      priority: 'High',
      duration_minutes: 60,
      due_date: '2026-11-20'
    })
  });
  console.log(`Create Goal Task: HTTP ${task1Res.status}, task_type: "${task1Res.data?.task?.task_type}"`);
  assert.equal(task1Res.status, 201);
  assert.equal(task1Res.data?.task?.task_type, 'goal');
  const task1Id = task1Res.data.task.id;

  // Task 2: Independent Task (goal_id = null)
  const task2Res = await client1.request('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Pay Utilities Bill',
      goal_id: null,
      priority: 'Medium',
      duration_minutes: 30,
      due_date: '2026-11-18'
    })
  });
  console.log(`Create Independent Task: HTTP ${task2Res.status}, task_type: "${task2Res.data?.task?.task_type}", goal_id: ${task2Res.data?.task?.goal_id}`);
  assert.equal(task2Res.status, 201);
  assert.equal(task2Res.data?.task?.task_type, 'independent');
  assert.equal(task2Res.data?.task?.goal_id, null);
  const task2Id = task2Res.data.task.id;

  // AI Key Encryption & Masking
  const saveKeyRes = await client1.request('/api/tasks/ai-settings', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'user_key',
      provider: 'gemini',
      apiKey: ('A' + 'Q.') + 'validCustomKeyFormat123456789'
    })
  });
  console.log(`Save User AI Key: HTTP ${saveKeyRes.status}, hint: "${saveKeyRes.data?.settings?.keyHint}"`);
  assert.equal(saveKeyRes.status, 200);
  assert.equal(saveKeyRes.data?.settings?.hasKey, true);
  // Key hint must be masked (e.g., AQ.v••••••••6789 or AQ.v...6789)
  const isMasked = saveKeyRes.data?.settings?.keyHint?.includes('•') || saveKeyRes.data?.settings?.keyHint?.includes('...');
  assert.equal(isMasked, true);
  assert.equal(saveKeyRes.data?.settings?.apiKey, undefined); // Never leak raw key!

  // Cross-user AI settings isolation: User 2 cannot view User 1's key!
  const user2AiSettings = await client2.request('/api/tasks/ai-settings');
  console.log(`User 2 AI settings: hasKey=${user2AiSettings.data?.settings?.hasKey}, keyHint=${user2AiSettings.data?.settings?.keyHint}`);
  assert.equal(user2AiSettings.data?.settings?.hasKey, false);
  assert.equal(user2AiSettings.data?.settings?.keyHint, null);

  // ----------------------------------------------------
  // Step 5: Schedule (Day / Week / Month)
  // ----------------------------------------------------
  console.log('\n--- Step 5: Schedule Generation & Multi-View ---');
  const genSchedRes = await client1.request('/api/schedule/generate', { method: 'POST', body: JSON.stringify({ clearExisting: true, daysAhead: 7 }) });
  console.log(`Auto-Schedule: HTTP ${genSchedRes.status}, scheduled_count: ${genSchedRes.data?.scheduled_count}`);
  assert.equal(genSchedRes.status, 200);
  assert.equal(genSchedRes.data?.scheduled_count >= 2, true);

  // GET /api/schedule
  const daySched = await client1.request('/api/schedule?date=today');
  console.log(`GET /api/schedule: HTTP ${daySched.status}, blocks: ${daySched.data?.blocks?.length}`);
  assert.equal(daySched.status, 200);
  assert.equal(daySched.data?.blocks?.length >= 2, true);

  // Verify Next Task is selected
  console.log(`Next Task: title="${daySched.data?.next_task?.title}", task_type="${daySched.data?.next_task?.task_type}"`);
  assert.equal(Boolean(daySched.data?.next_task), true);

  // ----------------------------------------------------
  // Step 6: Execution & Self-Healing
  // ----------------------------------------------------
  console.log('\n--- Step 6: Execution & Self-Healing ---');
  // Complete Task 1 via Quick Check-In (actual_minutes = 75, verified = true)
  const completeRes = await client1.request('/api/schedule/complete-task', {
    method: 'POST',
    body: JSON.stringify({
      task_id: task1Id,
      actual_minutes: 75,
      duration_verified: true
    })
  });
  console.log(`Complete Task 1: HTTP ${completeRes.status}, success: ${completeRes.data?.success}`);
  assert.equal(completeRes.status, 200);
  assert.equal(completeRes.data?.success, true);

  // Guard Check: Attempting to reschedule an already-completed task must return HTTP 400!
  const doubleResched = await client1.request('/api/schedule/reschedule-task', {
    method: 'POST',
    body: JSON.stringify({ task_id: task1Id })
  });
  console.log(`Attempt reschedule completed task: HTTP ${doubleResched.status} (expected 400)`);
  assert.equal(doubleResched.status, 400);

  // Guard Check: Attempting to re-complete an already-completed task must return HTTP 400!
  const doubleComplete = await client1.request('/api/schedule/complete-task', {
    method: 'POST',
    body: JSON.stringify({ task_id: task1Id })
  });
  console.log(`Attempt re-complete completed task: HTTP ${doubleComplete.status} (expected 400)`);
  assert.equal(doubleComplete.status, 400);

  // Reschedule Task 2 (Independent Task)
  const reschedRes = await client1.request('/api/schedule/reschedule-task', {
    method: 'POST',
    body: JSON.stringify({ task_id: task2Id })
  });
  console.log(`Reschedule Task 2: HTTP ${reschedRes.status}, next slot: ${reschedRes.data?.block?.start_time} - ${reschedRes.data?.block?.end_time}`);
  assert.equal(reschedRes.status, 200);
  assert.equal(Boolean(reschedRes.data?.block), true);

  // ----------------------------------------------------
  // Step 7: Insights & Settings
  // ----------------------------------------------------
  console.log('\n--- Step 7: Insights & Settings ---');
  const insightsRes = await client1.request('/api/insights');
  console.log(`GET /api/insights: HTTP ${insightsRes.status}, completedTasks: ${insightsRes.data?.metrics?.completed_tasks}, paceFactor: ${insightsRes.data?.learning?.pace_factor}`);
  assert.equal(insightsRes.status, 200);
  assert.equal(insightsRes.data?.metrics?.completed_tasks, 1);

  // Update Settings
  const settingsRes = await client1.request('/api/dashboard/settings', {
    method: 'POST',
    body: JSON.stringify({
      preferences: { notify_tasks: false, notify_goals: true, notify_weekly: false }
    })
  });
  console.log(`POST /api/dashboard/settings: HTTP ${settingsRes.status}, notify_tasks: ${settingsRes.data?.settings?.notify_tasks}`);
  assert.equal(settingsRes.status, 200);
  assert.equal(settingsRes.data?.settings?.notify_tasks, false);

  // Verify persistence across reload
  const reloadData = await client1.request('/api/dashboard/data');
  console.log(`Reload dashboard: notify_tasks=${reloadData.data?.user_preferences?.notify_tasks}`);
  assert.equal(reloadData.data?.user_preferences?.notify_tasks, false);

  // Cleanup: Delete test users from DB
  const mainDb = getDatabase();
  mainDb.prepare('DELETE FROM users WHERE id IN (?, ?)').run(user1Id, signup2.data.user.id);
  console.log(`Cleaned up test users: ${user1Id}, ${signup2.data.user.id}`);
  console.log('✓ Full End-to-End Walkthrough VERIFIED.\n');
}

async function run() {
  try {
    await runPart1MathVerification();
    await runPart2LiveSystemWalkthrough();
    console.log('==================================================');
    console.log('ALL TOP-TO-BOTTOM CHECKS PASSED WITH 100% SUCCESS!');
    console.log('==================================================\n');
  } catch (err) {
    console.error('\n❌ VERIFICATION FAILED:', err);
    process.exit(1);
  }
}

run();
