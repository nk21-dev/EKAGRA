const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDatabase } = require('../db');
const {
  DAY_NAMES,
  normalizeDays,
  formatDaysForStorage,
  getUserScheduleSettings,
  updateUserScheduleSettings,
  setInitialSetupStatus,
  getBlockIntervals,
  checkRoutineOverlap,
  formatTime12Hour,
  normalizeTo24Hour,
  calculateDayGaps,
  getIntervalsForBlock,
  doBlocksOverlap,
  checkSingleBlockConflict,
  deduplicateRoutineBlocks,
  getRoutineCoverageStatus
} = require('../services/routineService');

// GET /api/routines
// Returns all routine blocks strictly isolated to the authenticated user along with their schedule settings and coverage
router.get('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { group } = req.query;

  const settings = await getUserScheduleSettings(db, userId);

  let query = `
    SELECT id, user_id, name, start_time, end_time, days, schedule_group, type,
           activity_classification, availability_type, is_reviewed, created_at, updated_at
    FROM routines
    WHERE user_id = ?
  `;
  const params = [userId];

  if (group === 'weekdays' || group === 'weekends') {
    query += ` AND schedule_group = ?`;
    params.push(group);
  }

  query += ` ORDER BY start_time ASC`;

  const rows = (await db.prepare(query).all(...params)) || [];

  const routines = rows.map((r) => {
    let parsedDays = [];
    try {
      parsedDays = JSON.parse(r.days);
    } catch (e) {
      parsedDays = (r.days || '').split(',').map((s) => s.trim());
    }

    // Default schedule_group if not set
    const scheduleGroup = r.schedule_group || (parsedDays.some((d) => ['Saturday', 'Sunday'].includes(d)) && !parsedDays.some((d) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(d)) ? 'weekends' : 'weekdays');

    return {
      ...r,
      schedule_group: scheduleGroup,
      days: parsedDays,
      activity_classification: r.activity_classification || '',
      availability_type: r.availability_type || (r.type === 'Flexible' ? 'flexible' : 'busy'),
      is_reviewed: r.is_reviewed !== undefined ? r.is_reviewed : 1
    };
  });

  // Calculate day coverage for both groups
  const allUserRoutines = (await db.prepare(`SELECT * FROM routines WHERE user_id = ?`).all(userId)) || [];
  const weekdaysRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekdays');
  const weekendsRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekends');
  const coverage = {
    weekdays: calculateDayGaps(weekdaysRoutines),
    weekends: calculateDayGaps(weekendsRoutines)
  };

  return res.status(200).json({
    success: true,
    routines,
    settings,
    coverage
  });
});

// GET /api/routines/settings
// Returns user-isolated schedule groups day assignments and one-time setup status
router.get('/settings', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const settings = await getUserScheduleSettings(db, userId);

  return res.status(200).json({
    success: true,
    settings
  });
});

// PUT /api/routines/settings
// Updates user-isolated schedule groups day assignments
router.put('/settings', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { weekdays_days, weekends_days } = req.body;

  try {
    const updated = await updateUserScheduleSettings(db, userId, { weekdays_days, weekends_days });
    return res.status(200).json({
      success: true,
      settings: updated
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || 'Failed to update schedule settings.'
    });
  }
});

// POST /api/routines/initial-setup-status
// Authoritatively updates the user's initial routine setup status in database ('completed' or 'skipped')
router.post('/initial-setup-status', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { status } = req.body;

  if (!status || !['completed', 'skipped', 'pending'].includes(status)) {
    return res.status(400).json({ error: "Valid status required ('completed', 'skipped', or 'pending')." });
  }

  try {
    await setInitialSetupStatus(db, userId, status);
    const settings = await getUserScheduleSettings(db, userId);
    return res.status(200).json({
      success: true,
      status,
      settings
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/routines/initial-setup
// Atomically saves day assignments and routine blocks from initial routine setup
router.post('/initial-setup', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { weekdays_days, weekends_days, routines } = req.body;

  try {
    // 1. Validate & update schedule day settings
    const updatedSettings = await updateUserScheduleSettings(db, userId, { weekdays_days, weekends_days });

    // 2. Validate all provided routine blocks (atomically with duplicate and overlap detection)
    const validBlocks = [];
    const seenExactKeys = new Set();
    const rawList = Array.isArray(routines) ? routines : [];

    // Filter exact duplicate items first (e.g. repeated click submissions of exact same block)
    const deduplicatedInput = [];
    for (const r of rawList) {
      if (!r || !r.name) continue;
      const start = normalizeTo24Hour((r.start_time || '').trim());
      const end = normalizeTo24Hour((r.end_time || '').trim());
      const grp = r.schedule_group === 'weekends' ? 'weekends' : 'weekdays';
      const key = `${(r.name || '').trim().toLowerCase()}_${grp}_${start}_${end}`;
      if (!seenExactKeys.has(key)) {
        seenExactKeys.add(key);
        deduplicatedInput.push(r);
      }
    }

    if (deduplicatedInput.length > 0) {
      for (const r of deduplicatedInput) {
        const name = (r.name || '').trim();
        const startTime = normalizeTo24Hour((r.start_time || '').trim());
        const endTime = normalizeTo24Hour((r.end_time || '').trim());
        const group = r.schedule_group === 'weekends' ? 'weekends' : 'weekdays';
        const type = r.type === 'Flexible' ? 'Flexible' : 'Fixed';

        if (!name || !startTime || !endTime) continue;

        const groupDays = group === 'weekdays' ? updatedSettings.weekdays_days : updatedSettings.weekends_days;
        const activityClass = (r.activity_classification || '').trim();
        const availType = r.availability_type || (name.toLowerCase().includes('available') ? 'available' : (type === 'Flexible' ? 'flexible' : 'busy'));
        const isReviewed = r.is_reviewed !== undefined ? (r.is_reviewed ? 1 : 0) : 1;

        const blockData = {
          name,
          start_time: startTime,
          end_time: endTime,
          schedule_group: group,
          type,
          activity_classification: activityClass,
          availability_type: availType,
          is_reviewed: isReviewed,
          days: groupDays
        };

        // Check against other blocks in the same batch
        const blockIntervals = getBlockIntervals(blockData, groupDays);
        for (const prev of validBlocks) {
          const prevDays = prev.schedule_group === 'weekdays' ? updatedSettings.weekdays_days : updatedSettings.weekends_days;
          const prevIntervals = getBlockIntervals(prev, prevDays);

          for (let day = 0; day < 7; day++) {
            const curInts = blockIntervals[day] || [];
            const prevInts = prevIntervals[day] || [];
            for (const c of curInts) {
              for (const p of prevInts) {
                if (Math.max(c.start, p.start) < Math.min(c.end, p.end)) {
                  const dayName = DAY_NAMES[day];
                  return res.status(409).json({
                    error: `Routine "${name}" (${formatTime12Hour(startTime)}–${formatTime12Hour(endTime)}) overlaps with "${prev.name}" (${formatTime12Hour(prev.start_time)}–${formatTime12Hour(prev.end_time)}) on ${dayName}.`
                  });
                }
              }
            }
          }
        }

        validBlocks.push(blockData);
      }
    }

    // 3. Atomically replace routine blocks via db.batch() in a single transaction
    const batchStatements = [
      {
        sql: 'DELETE FROM routines WHERE user_id = ?',
        args: [userId]
      }
    ];

    const insertedRoutines = [];
    const now = new Date().toISOString();

    for (const b of validBlocks) {
      const routineId = `r-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      batchStatements.push({
        sql: `INSERT INTO routines (id, user_id, name, start_time, end_time, days, schedule_group, type, activity_classification, availability_type, is_reviewed, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          routineId,
          userId,
          b.name,
          b.start_time,
          b.end_time,
          JSON.stringify(b.days),
          b.schedule_group,
          b.type || 'Fixed',
          b.activity_classification || '',
          b.availability_type || 'busy',
          b.is_reviewed !== undefined ? b.is_reviewed : 1,
          now,
          now
        ]
      });

      insertedRoutines.push({
        id: routineId,
        user_id: userId,
        name: b.name,
        start_time: b.start_time,
        end_time: b.end_time,
        days: b.days,
        schedule_group: b.schedule_group,
        type: b.type || 'Fixed',
        activity_classification: b.activity_classification || '',
        availability_type: b.availability_type || 'busy',
        is_reviewed: b.is_reviewed !== undefined ? b.is_reviewed : 1
      });
    }

    await db.batch(batchStatements);

    // 4. Mark setup status as completed
    await setInitialSetupStatus(db, userId, 'completed');
    const finalSettings = await getUserScheduleSettings(db, userId);

    const coverage = {
      weekdays: calculateDayGaps(insertedRoutines.filter((r) => r.schedule_group === 'weekdays')),
      weekends: calculateDayGaps(insertedRoutines.filter((r) => r.schedule_group === 'weekends'))
    };

    return res.status(200).json({
      success: true,
      settings: finalSettings,
      routines: insertedRoutines,
      coverage
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to save routine setup.' });
  }
});

// POST /api/routines
// Creates a new routine block within a schedule group with overlap and conflict validation
router.post('/', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { name, start_time, end_time, days, schedule_group, type, activity_classification, availability_type, is_reviewed } = req.body;

  const routineName = (name || req.body.title || '').trim();
  const startTime = normalizeTo24Hour((start_time || '').trim());
  const endTime = normalizeTo24Hour((end_time || '').trim());
  const routineType = type === 'Flexible' ? 'Flexible' : 'Fixed';
  const group = schedule_group === 'weekends' ? 'weekends' : 'weekdays';
  const activityClass = (activity_classification || '').trim();
  const availType = availability_type || (routineName.toLowerCase().includes('available') ? 'available' : (routineType === 'Flexible' ? 'flexible' : 'busy'));
  const isReviewed = is_reviewed !== undefined ? (is_reviewed ? 1 : 0) : 1;

  if (!routineName) {
    return res.status(400).json({ error: 'Routine Name is required.' });
  }

  if (!startTime || !endTime) {
    return res.status(400).json({ error: 'Start time and end time are required.' });
  }

  const settings = await getUserScheduleSettings(db, userId);
  let effectiveDays = days;
  if (!effectiveDays || (Array.isArray(effectiveDays) && effectiveDays.length === 0)) {
    effectiveDays = group === 'weekends' ? settings.weekends_days : settings.weekdays_days;
  }

  const normalizedDays = normalizeDays(effectiveDays);
  if (normalizedDays.length === 0) {
    return res.status(400).json({ error: 'At least one applicable day must be assigned to this schedule group.' });
  }

  // 1. Group-level non-overlap & 24-hour total duration guard
  const existingInGroup = (await db.prepare('SELECT * FROM routines WHERE user_id = ? AND schedule_group = ?').all(userId, group)) || [];
  const singleConflict = checkSingleBlockConflict(existingInGroup, {
    name: routineName,
    start_time: startTime,
    end_time: endTime
  });
  if (singleConflict.hasConflict) {
    return res.status(409).json({
      error: singleConflict.message || 'This time slot overlaps an existing routine block.',
      conflict: singleConflict
    });
  }

  // 2. Cross-day / overnight 7-day overlap detection
  const overlapCheck = await checkRoutineOverlap(db, userId, {
    name: routineName,
    start_time: startTime,
    end_time: endTime,
    schedule_group: group,
    days: normalizedDays,
    type: routineType
  });

  if (overlapCheck.hasOverlap) {
    return res.status(409).json({
      error: overlapCheck.message || 'This time slot overlaps an existing routine block.',
      conflict: overlapCheck
    });
  }

  const routineId = `r-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const daysStorage = formatDaysForStorage(normalizedDays);

  await db.prepare(`
    INSERT INTO routines (id, user_id, name, start_time, end_time, days, schedule_group, type, activity_classification, availability_type, is_reviewed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    routineId,
    userId,
    routineName,
    startTime,
    endTime,
    daysStorage,
    group,
    routineType,
    activityClass,
    availType,
    isReviewed,
    now,
    now
  );

  // Saving a routine marks initial setup as completed
  if (settings.routine_setup_status === 'pending') {
    await setInitialSetupStatus(db, userId, 'completed');
  }

  const created = await db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
  let parsedDays = [];
  try {
    parsedDays = JSON.parse(created.days);
  } catch (e) {
    parsedDays = normalizedDays;
  }

  const allUserRoutines = (await db.prepare('SELECT * FROM routines WHERE user_id = ? ORDER BY start_time ASC').all(userId)) || [];
  const weekdaysRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekdays');
  const weekendsRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekends');
  const coverage = {
    weekdays: calculateDayGaps(weekdaysRoutines),
    weekends: calculateDayGaps(weekendsRoutines)
  };

  return res.status(201).json({
    success: true,
    routine: {
      ...created,
      schedule_group: group,
      days: parsedDays,
      activity_classification: created.activity_classification || '',
      availability_type: created.availability_type || 'busy',
      is_reviewed: created.is_reviewed !== undefined ? created.is_reviewed : 1
    },
    routines: allUserRoutines,
    coverage
  });
});

// PUT /api/routines/:id
// Updates an existing routine block with strict user isolation and overlap validation
router.put('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const routineId = req.params.id;

  const existing = await db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
  if (!existing) {
    return res.status(404).json({ error: 'Routine not found.' });
  }

  if (existing.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this routine.' });
  }

  const { name, start_time, end_time, days, schedule_group, type, activity_classification, availability_type, is_reviewed } = req.body;

  const updatedName = name !== undefined ? name.trim() : existing.name;
  const updatedStart = start_time !== undefined ? normalizeTo24Hour(start_time.trim()) : existing.start_time;
  const updatedEnd = end_time !== undefined ? normalizeTo24Hour(end_time.trim()) : existing.end_time;
  const updatedType = type !== undefined ? (type === 'Flexible' ? 'Flexible' : 'Fixed') : existing.type;
  const updatedGroup = schedule_group !== undefined ? (schedule_group === 'weekends' ? 'weekends' : 'weekdays') : (existing.schedule_group || 'weekdays');
  const updatedActivityClass = activity_classification !== undefined ? activity_classification.trim() : (existing.activity_classification || '');
  const updatedAvailType = availability_type !== undefined ? availability_type : (existing.availability_type || (updatedType === 'Flexible' ? 'flexible' : 'busy'));
  const updatedIsReviewed = is_reviewed !== undefined ? (is_reviewed ? 1 : 0) : (existing.is_reviewed !== undefined ? existing.is_reviewed : 1);

  const settings = await getUserScheduleSettings(db, userId);
  let effectiveDays = days;
  if (!effectiveDays) {
    effectiveDays = updatedGroup === 'weekends' ? settings.weekends_days : settings.weekdays_days;
  }
  const normalizedDays = normalizeDays(effectiveDays);

  if (!updatedName) {
    return res.status(400).json({ error: 'Routine Name cannot be empty.' });
  }

  if (!updatedStart || !updatedEnd) {
    return res.status(400).json({ error: 'Start time and end time cannot be empty.' });
  }

  if (normalizedDays.length === 0) {
    return res.status(400).json({ error: 'At least one applicable day must be assigned to this schedule group.' });
  }

  // 1. Group-level non-overlap & 24-hour total duration guard (excluding self)
  const existingInGroup = (await db.prepare('SELECT * FROM routines WHERE user_id = ? AND schedule_group = ? AND id != ?').all(userId, updatedGroup, routineId)) || [];
  const singleConflict = checkSingleBlockConflict(existingInGroup, {
    name: updatedName,
    start_time: updatedStart,
    end_time: updatedEnd
  });
  if (singleConflict.hasConflict) {
    return res.status(409).json({
      error: singleConflict.message || 'This time slot overlaps an existing routine block.',
      conflict: singleConflict
    });
  }

  // 2. Conflict / Overlap Detection (excluding self across 7-day schedule)
  const overlapCheck = await checkRoutineOverlap(
    db,
    userId,
    {
      name: updatedName,
      start_time: updatedStart,
      end_time: updatedEnd,
      schedule_group: updatedGroup,
      days: normalizedDays,
      type: updatedType
    },
    routineId
  );

  if (overlapCheck.hasOverlap) {
    return res.status(409).json({
      error: overlapCheck.message || 'This time slot overlaps an existing routine block.',
      conflict: overlapCheck
    });
  }

  const now = new Date().toISOString();
  const daysStorage = formatDaysForStorage(normalizedDays);

  await db.prepare(`
    UPDATE routines
    SET name = ?, start_time = ?, end_time = ?, days = ?, schedule_group = ?, type = ?,
        activity_classification = ?, availability_type = ?, is_reviewed = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    updatedName,
    updatedStart,
    updatedEnd,
    daysStorage,
    updatedGroup,
    updatedType,
    updatedActivityClass,
    updatedAvailType,
    updatedIsReviewed,
    now,
    routineId,
    userId
  );

  const updated = await db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
  let parsedDays = [];
  try {
    parsedDays = JSON.parse(updated.days);
  } catch (e) {
    parsedDays = normalizedDays;
  }

  const allUserRoutines = (await db.prepare('SELECT * FROM routines WHERE user_id = ? ORDER BY start_time ASC').all(userId)) || [];
  const weekdaysRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekdays');
  const weekendsRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekends');
  const coverage = {
    weekdays: calculateDayGaps(weekdaysRoutines),
    weekends: calculateDayGaps(weekendsRoutines)
  };

  return res.status(200).json({
    success: true,
    routine: {
      ...updated,
      schedule_group: updatedGroup,
      days: parsedDays,
      activity_classification: updated.activity_classification || '',
      availability_type: updated.availability_type || 'busy',
      is_reviewed: updated.is_reviewed !== undefined ? updated.is_reviewed : 1
    },
    routines: allUserRoutines,
    coverage
  });
});

// DELETE /api/routines/:id
// Deletes a routine block with strict user isolation
router.delete('/:id', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const routineId = req.params.id;

  const existing = await db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
  if (!existing) {
    return res.status(404).json({ error: 'Routine not found.' });
  }

  if (existing.user_id !== userId) {
    return res.status(403).json({ error: 'Unauthorized: You do not own this routine.' });
  }

  await db.prepare('DELETE FROM routines WHERE id = ? AND user_id = ?').run(routineId, userId);

  const allUserRoutines = (await db.prepare('SELECT * FROM routines WHERE user_id = ? ORDER BY start_time ASC').all(userId)) || [];
  const weekdaysRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekdays');
  const weekendsRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekends');
  const coverage = {
    weekdays: calculateDayGaps(weekdaysRoutines),
    weekends: calculateDayGaps(weekendsRoutines)
  };

  return res.status(200).json({
    success: true,
    message: 'Routine deleted successfully.',
    routines: allUserRoutines,
    coverage
  });
});

// POST /api/routines/copy-group
// Copies all routine blocks from fromGroup (default 'weekdays') to toGroup (default 'weekends')
router.post('/copy-group', requireAuth, async (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const fromGroup = req.body.fromGroup === 'weekends' ? 'weekends' : 'weekdays';
  const toGroup = req.body.toGroup === 'weekdays' ? 'weekdays' : 'weekends';

  if (fromGroup === toGroup) {
    return res.status(400).json({ error: 'Source and target schedule groups must be different.' });
  }

  const settings = await getUserScheduleSettings(db, userId);
  const targetDays = toGroup === 'weekends' ? settings.weekends_days : settings.weekdays_days;

  const sourceRoutines = (await db.prepare(`
    SELECT * FROM routines
    WHERE user_id = ? AND schedule_group = ?
    ORDER BY start_time ASC
  `).all(userId, fromGroup)) || [];

  if (!sourceRoutines || sourceRoutines.length === 0) {
    return res.status(400).json({ error: `No routine blocks found in ${fromGroup} to copy.` });
  }

  // Deduplicate and validate source routine blocks
  const cleanSource = deduplicateRoutineBlocks(sourceRoutines);
  if (!cleanSource || cleanSource.length === 0) {
    return res.status(400).json({ error: `No valid routine blocks found in ${fromGroup} to copy.` });
  }

  // Atomically delete target group routines and insert copied blocks via db.batch()
  const batchStatements = [
    {
      sql: 'DELETE FROM routines WHERE user_id = ? AND schedule_group = ?',
      args: [userId, toGroup]
    }
  ];

  const copied = [];
  const daysJson = JSON.stringify(targetDays);
  const now = new Date().toISOString();

  for (const r of cleanSource) {
    const newId = `rt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    batchStatements.push({
      sql: `INSERT INTO routines (
        id, user_id, name, start_time, end_time, days, type,
        schedule_group, activity_classification, availability_type, is_reviewed,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        newId,
        userId,
        r.name,
        r.start_time,
        r.end_time,
        daysJson,
        r.type || 'Fixed',
        toGroup,
        r.activity_classification || '',
        r.availability_type || 'busy',
        r.is_reviewed !== undefined ? r.is_reviewed : 1,
        now,
        now
      ]
    });

    copied.push({
      id: newId,
      user_id: userId,
      name: r.name,
      start_time: r.start_time,
      end_time: r.end_time,
      days: targetDays,
      type: r.type || 'Fixed',
      schedule_group: toGroup,
      activity_classification: r.activity_classification || '',
      availability_type: r.availability_type || 'busy',
      is_reviewed: 1
    });
  }

  await db.batch(batchStatements);

  const allUserRoutines = (await db.prepare('SELECT * FROM routines WHERE user_id = ? ORDER BY start_time ASC').all(userId)) || [];
  const weekdaysRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekdays');
  const weekendsRoutines = allUserRoutines.filter((r) => (r.schedule_group || 'weekdays') === 'weekends');
  const coverage = {
    weekdays: calculateDayGaps(weekdaysRoutines),
    weekends: calculateDayGaps(weekendsRoutines)
  };
  const coverageStatus = await getRoutineCoverageStatus(db, userId);

  return res.status(200).json({
    success: true,
    count: copied.length,
    copied_count: copied.length,
    routines: allUserRoutines,
    coverage,
    coverage_status: coverageStatus,
    message: `Successfully copied ${copied.length} routine blocks from ${fromGroup} to ${toGroup}.`
  });
});

module.exports = router;
