/**
 * EKAGRA — 24-Hour Routine Service
 * 
 * Handles routine validation, schedule group settings (Weekdays/Weekends),
 * normalization, and robust 7-day + overnight overlap detection.
 */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_INDEX = {
  monday: 0, mon: 0, '0': 0,
  tuesday: 1, tue: 1, '1': 1,
  wednesday: 2, wed: 2, '2': 2,
  thursday: 3, thu: 3, '3': 3,
  friday: 4, fri: 4, '4': 4,
  saturday: 5, sat: 5, '5': 5,
  sunday: 6, sun: 6, '6': 6
};

const DEFAULT_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DEFAULT_WEEKENDS = ['Saturday', 'Sunday'];

function parseTimeToMinutes(timeStr) {
  if (typeof timeStr !== 'string') return null;
  const trimmed = timeStr.trim();
  if (trimmed === '24:00') return 1440;
  // 1. Check for 12-hour format: hh:mm AM/PM
  const match12 = trimmed.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/i);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const ampm = match12[3].toUpperCase();
    if (hours < 1 || hours > 12) return null;
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }
  // 2. Check for 24-hour format: HH:mm
  const match24 = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return hours * 60 + minutes;
  }
  return null;
}

function formatTime12Hour(timeStr) {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return timeStr || '';
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function normalizeTo24Hour(timeStr) {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return timeStr || '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function hasValidRoutineSetupSync(db, userId) {
  if (!userId) return false;

  const countRow = db.prepare('SELECT COUNT(*) as count FROM routines WHERE user_id = ?').get(userId);
  const routineCount = countRow ? countRow.count : 0;

  const settingsRow = db.prepare('SELECT routine_setup_status FROM user_schedule_settings WHERE user_id = ?').get(userId);

  // If user has saved routine blocks, their routine setup is valid and complete
  if (routineCount > 0) {
    if (!settingsRow || settingsRow.routine_setup_status !== 'completed') {
      try {
        db.prepare(`
          INSERT INTO user_schedule_settings (user_id, routine_setup_status, updated_at)
          VALUES (?, 'completed', CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET routine_setup_status = 'completed', updated_at = CURRENT_TIMESTAMP
        `).run(userId);
      } catch (e) {}
    }
    return true;
  }

  return false;
}

async function hasValidRoutineSetupAsync(db, userId) {
  if (!userId) return false;

  const countRow = await db.prepare('SELECT COUNT(*) as count FROM routines WHERE user_id = ?').get(userId);
  const routineCount = countRow ? countRow.count : 0;

  const settingsRow = await db.prepare('SELECT routine_setup_status FROM user_schedule_settings WHERE user_id = ?').get(userId);

  if (routineCount > 0) {
    if (!settingsRow || settingsRow.routine_setup_status !== 'completed') {
      try {
        await db.prepare(`
          INSERT INTO user_schedule_settings (user_id, routine_setup_status, updated_at)
          VALUES (?, 'completed', CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET routine_setup_status = 'completed', updated_at = CURRENT_TIMESTAMP
        `).run(userId);
      } catch (e) {}
    }
    return true;
  }

  return false;
}

function hasValidRoutineSetup(db, userId) {
  if (db && db.isTurso) {
    return hasValidRoutineSetupAsync(db, userId);
  }
  return hasValidRoutineSetupSync(db, userId);
}

function normalizeDays(daysInput) {
  if (!daysInput) return [];
  let daysArray = [];

  if (Array.isArray(daysInput)) {
    daysArray = daysInput;
  } else if (typeof daysInput === 'string') {
    const trimmed = daysInput.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        daysArray = JSON.parse(trimmed);
      } catch (e) {
        daysArray = trimmed.split(',').map((s) => s.trim());
      }
    } else if (trimmed.toLowerCase() === 'daily' || trimmed.toLowerCase() === 'everyday' || trimmed.toLowerCase() === 'all') {
      return [0, 1, 2, 3, 4, 5, 6];
    } else if (trimmed.toLowerCase() === 'weekdays') {
      return [0, 1, 2, 3, 4];
    } else if (trimmed.toLowerCase() === 'weekends') {
      return [5, 6];
    } else {
      daysArray = trimmed.split(',').map((s) => s.trim());
    }
  }

  const indices = new Set();
  for (const item of daysArray) {
    if (item === null || item === undefined) continue;
    const str = String(item).trim().toLowerCase();
    if (str === 'daily' || str === 'everyday' || str === 'all') {
      return [0, 1, 2, 3, 4, 5, 6];
    }
    if (str === 'weekdays') {
      [0, 1, 2, 3, 4].forEach((d) => indices.add(d));
      continue;
    }
    if (str === 'weekends') {
      [5, 6].forEach((d) => indices.add(d));
      continue;
    }
    if (DAY_INDEX[str] !== undefined) {
      indices.add(DAY_INDEX[str]);
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

function formatDaysForStorage(dayIndices) {
  return JSON.stringify(dayIndices.map((i) => DAY_NAMES[i]));
}

function getUserScheduleSettingsSync(db, userId) {
  const isValid = hasValidRoutineSetupSync(db, userId);
  let row = db.prepare(`
    SELECT user_id, weekdays_days, weekends_days, routine_setup_status
    FROM user_schedule_settings
    WHERE user_id = ?
  `).get(userId);

  if (!row) {
    const defaultStatus = isValid ? 'completed' : 'pending';

    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO user_schedule_settings (user_id, weekdays_days, weekends_days, routine_setup_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        JSON.stringify(DEFAULT_WEEKDAYS),
        JSON.stringify(DEFAULT_WEEKENDS),
        defaultStatus,
        now,
        now
      );
    } catch (e) {}

    row = {
      user_id: userId,
      weekdays_days: JSON.stringify(DEFAULT_WEEKDAYS),
      weekends_days: JSON.stringify(DEFAULT_WEEKENDS),
      routine_setup_status: defaultStatus
    };
  }

  let weekdays_days = DEFAULT_WEEKDAYS;
  let weekends_days = DEFAULT_WEEKENDS;

  try {
    weekdays_days = JSON.parse(row.weekdays_days);
  } catch (e) {
    weekdays_days = DEFAULT_WEEKDAYS;
  }

  try {
    weekends_days = JSON.parse(row.weekends_days);
  } catch (e) {
    weekends_days = DEFAULT_WEEKENDS;
  }

  const effectiveStatus = isValid ? 'completed' : (row.routine_setup_status || 'pending');

  return {
    weekdays_days,
    weekends_days,
    routine_setup_status: effectiveStatus,
    has_valid_routine_setup: isValid,
    needs_routine_setup: !isValid
  };
}

async function getUserScheduleSettingsAsync(db, userId) {
  const isValid = await hasValidRoutineSetupAsync(db, userId);
  let row = await db.prepare(`
    SELECT user_id, weekdays_days, weekends_days, routine_setup_status
    FROM user_schedule_settings
    WHERE user_id = ?
  `).get(userId);

  if (!row) {
    const defaultStatus = isValid ? 'completed' : 'pending';

    const now = new Date().toISOString();
    try {
      await db.prepare(`
        INSERT INTO user_schedule_settings (user_id, weekdays_days, weekends_days, routine_setup_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        JSON.stringify(DEFAULT_WEEKDAYS),
        JSON.stringify(DEFAULT_WEEKENDS),
        defaultStatus,
        now,
        now
      );
    } catch (e) {}

    row = {
      user_id: userId,
      weekdays_days: JSON.stringify(DEFAULT_WEEKDAYS),
      weekends_days: JSON.stringify(DEFAULT_WEEKENDS),
      routine_setup_status: defaultStatus
    };
  }

  let weekdays_days = DEFAULT_WEEKDAYS;
  let weekends_days = DEFAULT_WEEKENDS;

  try {
    weekdays_days = JSON.parse(row.weekdays_days);
  } catch (e) {
    weekdays_days = DEFAULT_WEEKDAYS;
  }

  try {
    weekends_days = JSON.parse(row.weekends_days);
  } catch (e) {
    weekends_days = DEFAULT_WEEKENDS;
  }

  const effectiveStatus = isValid ? 'completed' : (row.routine_setup_status || 'pending');

  return {
    weekdays_days,
    weekends_days,
    routine_setup_status: effectiveStatus,
    has_valid_routine_setup: isValid,
    needs_routine_setup: !isValid
  };
}

function getUserScheduleSettings(db, userId) {
  if (db && db.isTurso) {
    return getUserScheduleSettingsAsync(db, userId);
  }
  return getUserScheduleSettingsSync(db, userId);
}

function updateUserScheduleSettingsSync(db, userId, { weekdays_days, weekends_days }) {
  if (!Array.isArray(weekdays_days) || !Array.isArray(weekends_days)) {
    throw new Error('weekdays_days and weekends_days must be arrays of day names.');
  }

  // Normalize day names to TitleCase
  const cleanWeekdays = weekdays_days.map((d) => {
    const idx = DAY_INDEX[String(d).toLowerCase().trim()];
    if (idx === undefined) throw new Error(`Invalid day name: ${d}`);
    return DAY_NAMES[idx];
  });

  const cleanWeekends = weekends_days.map((d) => {
    const idx = DAY_INDEX[String(d).toLowerCase().trim()];
    if (idx === undefined) throw new Error(`Invalid day name: ${d}`);
    return DAY_NAMES[idx];
  });

  // Ensure no duplicate days within each group
  const weekdaysSet = new Set(cleanWeekdays);
  const weekendsSet = new Set(cleanWeekends);

  if (weekdaysSet.size === 0 || weekendsSet.size === 0) {
    throw new Error('Both Weekdays and Weekends must have at least one day assigned.');
  }

  // Prevent any day from belonging to both groups simultaneously
  for (const d of weekdaysSet) {
    if (weekendsSet.has(d)) {
      throw new Error(`Conflict: Day "${d}" cannot be assigned to both Weekdays and Weekends (schedule groups cannot overlap).`);
    }
  }

  // Ensure all 7 days belong to exactly one group
  const totalAssigned = new Set([...weekdaysSet, ...weekendsSet]);
  for (const d of DAY_NAMES) {
    if (!totalAssigned.has(d)) {
      throw new Error(`Every day of the week must belong to a group. Missing day: ${d}`);
    }
  }

  const sortedWeekdays = DAY_NAMES.filter((d) => weekdaysSet.has(d));
  const sortedWeekends = DAY_NAMES.filter((d) => weekendsSet.has(d));
  const now = new Date().toISOString();

  // Upsert settings
  const existing = db.prepare('SELECT user_id FROM user_schedule_settings WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(`
      UPDATE user_schedule_settings
      SET weekdays_days = ?, weekends_days = ?, updated_at = ?
      WHERE user_id = ?
    `).run(JSON.stringify(sortedWeekdays), JSON.stringify(sortedWeekends), now, userId);
  } else {
    db.prepare(`
      INSERT INTO user_schedule_settings (user_id, weekdays_days, weekends_days, routine_setup_status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(userId, JSON.stringify(sortedWeekdays), JSON.stringify(sortedWeekends), now, now);
  }

  // Synchronize existing routine records for this user
  db.prepare(`
    UPDATE routines
    SET days = ?, updated_at = ?
    WHERE user_id = ? AND schedule_group = 'weekdays'
  `).run(JSON.stringify(sortedWeekdays), now, userId);

  db.prepare(`
    UPDATE routines
    SET days = ?, updated_at = ?
    WHERE user_id = ? AND schedule_group = 'weekends'
  `).run(JSON.stringify(sortedWeekends), now, userId);

  return getUserScheduleSettingsSync(db, userId);
}

async function updateUserScheduleSettingsAsync(db, userId, { weekdays_days, weekends_days }) {
  if (!Array.isArray(weekdays_days) || !Array.isArray(weekends_days)) {
    throw new Error('weekdays_days and weekends_days must be arrays of day names.');
  }

  const cleanWeekdays = weekdays_days.map((d) => {
    const idx = DAY_INDEX[String(d).toLowerCase().trim()];
    if (idx === undefined) throw new Error(`Invalid day name: ${d}`);
    return DAY_NAMES[idx];
  });

  const cleanWeekends = weekends_days.map((d) => {
    const idx = DAY_INDEX[String(d).toLowerCase().trim()];
    if (idx === undefined) throw new Error(`Invalid day name: ${d}`);
    return DAY_NAMES[idx];
  });

  const weekdaysSet = new Set(cleanWeekdays);
  const weekendsSet = new Set(cleanWeekends);

  if (weekdaysSet.size === 0 || weekendsSet.size === 0) {
    throw new Error('Both Weekdays and Weekends must have at least one day assigned.');
  }

  for (const d of weekdaysSet) {
    if (weekendsSet.has(d)) {
      throw new Error(`Conflict: Day "${d}" cannot be assigned to both Weekdays and Weekends (schedule groups cannot overlap).`);
    }
  }

  const totalAssigned = new Set([...weekdaysSet, ...weekendsSet]);
  for (const d of DAY_NAMES) {
    if (!totalAssigned.has(d)) {
      throw new Error(`Every day of the week must belong to a group. Missing day: ${d}`);
    }
  }

  const sortedWeekdays = DAY_NAMES.filter((d) => weekdaysSet.has(d));
  const sortedWeekends = DAY_NAMES.filter((d) => weekendsSet.has(d));
  const now = new Date().toISOString();

  const existing = await db.prepare('SELECT user_id FROM user_schedule_settings WHERE user_id = ?').get(userId);
  if (existing) {
    await db.prepare(`
      UPDATE user_schedule_settings
      SET weekdays_days = ?, weekends_days = ?, updated_at = ?
      WHERE user_id = ?
    `).run(JSON.stringify(sortedWeekdays), JSON.stringify(sortedWeekends), now, userId);
  } else {
    await db.prepare(`
      INSERT INTO user_schedule_settings (user_id, weekdays_days, weekends_days, routine_setup_status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(userId, JSON.stringify(sortedWeekdays), JSON.stringify(sortedWeekends), now, now);
  }

  await db.prepare(`
    UPDATE routines
    SET days = ?, updated_at = ?
    WHERE user_id = ? AND schedule_group = 'weekdays'
  `).run(JSON.stringify(sortedWeekdays), now, userId);

  await db.prepare(`
    UPDATE routines
    SET days = ?, updated_at = ?
    WHERE user_id = ? AND schedule_group = 'weekends'
  `).run(JSON.stringify(sortedWeekends), now, userId);

  return await getUserScheduleSettingsAsync(db, userId);
}

function updateUserScheduleSettings(db, userId, settings) {
  if (db && db.isTurso) {
    return updateUserScheduleSettingsAsync(db, userId, settings);
  }
  return updateUserScheduleSettingsSync(db, userId, settings);
}

function setInitialSetupStatusSync(db, userId, status) {
  if (!['completed', 'skipped', 'pending'].includes(status)) {
    throw new Error("Invalid status. Must be 'completed', 'skipped', or 'pending'.");
  }

  getUserScheduleSettingsSync(db, userId); // Ensure row exists
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE user_schedule_settings
    SET routine_setup_status = ?, updated_at = ?
    WHERE user_id = ?
  `).run(status, now, userId);

  return { success: true, status };
}

async function setInitialSetupStatusAsync(db, userId, status) {
  if (!['completed', 'skipped', 'pending'].includes(status)) {
    throw new Error("Invalid status. Must be 'completed', 'skipped', or 'pending'.");
  }

  await getUserScheduleSettingsAsync(db, userId);
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE user_schedule_settings
    SET routine_setup_status = ?, updated_at = ?
    WHERE user_id = ?
  `).run(status, now, userId);

  return { success: true, status };
}

function setInitialSetupStatus(db, userId, status) {
  if (db && db.isTurso) {
    return setInitialSetupStatusAsync(db, userId, status);
  }
  return setInitialSetupStatusSync(db, userId, status);
}

function getBlockIntervals(block, effectiveDays = null) {
  const startMin = parseTimeToMinutes(block.start_time);
  const endMin = parseTimeToMinutes(block.end_time);
  if (startMin === null || endMin === null) return [];

  const dayIndices = normalizeDays(effectiveDays || block.days);
  const intervalsByDay = Array.from({ length: 7 }, () => []);

  for (const day of dayIndices) {
    if (startMin < endMin) {
      // Normal within-day interval: [startMin, endMin) on `day`
      intervalsByDay[day].push({
        start: startMin,
        end: endMin,
        routine: block
      });
    } else if (startMin > endMin) {
      // Overnight interval crossing midnight:
      // Evening on `day`: [startMin, 1440)
      intervalsByDay[day].push({
        start: startMin,
        end: 1440,
        routine: block
      });
      // Morning on `(day + 1) % 7`: [0, endMin)
      const nextDay = (day + 1) % 7;
      intervalsByDay[nextDay].push({
        start: 0,
        end: endMin,
        routine: block
      });
    }
  }

  return intervalsByDay;
}

function checkRoutineOverlapSync(db, userId, newBlock, excludeId = null) {
  const newStart = parseTimeToMinutes(newBlock.start_time);
  const newEnd = parseTimeToMinutes(newBlock.end_time);

  if (newStart === null || newEnd === null) {
    return { hasOverlap: false, error: 'Invalid start or end time format (expected 24h HH:MM).' };
  }

  if (newStart === newEnd) {
    return { hasOverlap: true, message: 'Start time and end time cannot be identical.' };
  }

  const settings = getUserScheduleSettingsSync(db, userId);
  let newEffectiveDays = newBlock.days;

  if (newBlock.schedule_group === 'weekdays') {
    newEffectiveDays = settings.weekdays_days;
  } else if (newBlock.schedule_group === 'weekends') {
    newEffectiveDays = settings.weekends_days;
  }

  const newDayIndices = normalizeDays(newEffectiveDays);
  if (newDayIndices.length === 0) {
    return { hasOverlap: false, error: 'At least one valid day must be selected or assigned to this group.' };
  }

  // Fetch all existing routines for the user
  const existingRows = db.prepare(`
    SELECT id, user_id, name, start_time, end_time, days, schedule_group, type
    FROM routines
    WHERE user_id = ?
  `).all(userId);

  const existingRoutines = existingRows.filter((r) => r.id !== excludeId);
  const newIntervalsByDay = getBlockIntervals(newBlock, newEffectiveDays);

  for (const existing of existingRoutines) {
    let existingEffectiveDays = existing.days;
    if (existing.schedule_group === 'weekdays') {
      existingEffectiveDays = settings.weekdays_days;
    } else if (existing.schedule_group === 'weekends') {
      existingEffectiveDays = settings.weekends_days;
    }

    const existingIntervalsByDay = getBlockIntervals(existing, existingEffectiveDays);

    for (let day = 0; day < 7; day++) {
      const newIntervals = newIntervalsByDay[day] || [];
      const existingIntervals = existingIntervalsByDay[day] || [];

      for (const nInt of newIntervals) {
        for (const eInt of existingIntervals) {
          // Overlap condition: max(start1, start2) < min(end1, end2)
          const overlapStart = Math.max(nInt.start, eInt.start);
          const overlapEnd = Math.min(nInt.end, eInt.end);

          if (overlapStart < overlapEnd) {
            const dayName = DAY_NAMES[day];
            return {
              hasOverlap: true,
              day: dayName,
              conflictingRoutine: existing,
              message: `Overlap detected on ${dayName}: "${existing.name}" (${formatTime12Hour(existing.start_time)}–${formatTime12Hour(existing.end_time)}) conflicts with "${newBlock.name}" (${formatTime12Hour(newBlock.start_time)}–${formatTime12Hour(newBlock.end_time)}). Please resolve the conflict or adjust the times.`
            };
          }
        }
      }
    }
  }

  return { hasOverlap: false };
}

async function checkRoutineOverlapAsync(db, userId, newBlock, excludeId = null) {
  const newStart = parseTimeToMinutes(newBlock.start_time);
  const newEnd = parseTimeToMinutes(newBlock.end_time);

  if (newStart === null || newEnd === null) {
    return { hasOverlap: false, error: 'Invalid start or end time format (expected 24h HH:MM).' };
  }

  if (newStart === newEnd) {
    return { hasOverlap: true, message: 'Start time and end time cannot be identical.' };
  }

  const settings = await getUserScheduleSettingsAsync(db, userId);
  let newEffectiveDays = newBlock.days;

  if (newBlock.schedule_group === 'weekdays') {
    newEffectiveDays = settings.weekdays_days;
  } else if (newBlock.schedule_group === 'weekends') {
    newEffectiveDays = settings.weekends_days;
  }

  const newDayIndices = normalizeDays(newEffectiveDays);
  if (newDayIndices.length === 0) {
    return { hasOverlap: false, error: 'At least one valid day must be selected or assigned to this group.' };
  }

  const existingRows = await db.prepare(`
    SELECT id, user_id, name, start_time, end_time, days, schedule_group, type
    FROM routines
    WHERE user_id = ?
  `).all(userId);

  const existingRoutines = existingRows.filter((r) => r.id !== excludeId);
  const newIntervalsByDay = getBlockIntervals(newBlock, newEffectiveDays);

  for (const existing of existingRoutines) {
    let existingEffectiveDays = existing.days;
    if (existing.schedule_group === 'weekdays') {
      existingEffectiveDays = settings.weekdays_days;
    } else if (existing.schedule_group === 'weekends') {
      existingEffectiveDays = settings.weekends_days;
    }

    const existingIntervalsByDay = getBlockIntervals(existing, existingEffectiveDays);

    for (let day = 0; day < 7; day++) {
      const newIntervals = newIntervalsByDay[day] || [];
      const existingIntervals = existingIntervalsByDay[day] || [];

      for (const nInt of newIntervals) {
        for (const eInt of existingIntervals) {
          const overlapStart = Math.max(nInt.start, eInt.start);
          const overlapEnd = Math.min(nInt.end, eInt.end);

          if (overlapStart < overlapEnd) {
            const dayName = DAY_NAMES[day];
            return {
              hasOverlap: true,
              day: dayName,
              conflictingRoutine: existing,
              message: `Overlap detected on ${dayName}: "${existing.name}" (${formatTime12Hour(existing.start_time)}–${formatTime12Hour(existing.end_time)}) conflicts with "${newBlock.name}" (${formatTime12Hour(newBlock.start_time)}–${formatTime12Hour(newBlock.end_time)}). Please resolve the conflict or adjust the times.`
            };
          }
        }
      }
    }
  }

  return { hasOverlap: false };
}

function checkRoutineOverlap(db, userId, newBlock, excludeId = null) {
  if (db && db.isTurso) {
    return checkRoutineOverlapAsync(db, userId, newBlock, excludeId);
  }
  return checkRoutineOverlapSync(db, userId, newBlock, excludeId);
}

function minutesToTime24(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

function calculateIntervalDuration(startTime, endTime) {
  const s = parseTimeToMinutes(startTime);
  const e = parseTimeToMinutes(endTime);
  if (s === null || e === null || s === e) return 0;
  if (s < e) return e - s;
  return (1440 - s) + e;
}

/**
 * Break a routine block down into 1 or 2 occupied intervals in [0, 1440) minutes.
 * Handles overnight blocks (e.g. 23:00 to 07:00 -> [1380, 1440) and [0, 420)).
 */
function getIntervalsForBlock(startTime, endTime) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null || start === end) return [];
  if (start < end) {
    return [{ start, end }];
  } else {
    return [
      { start, end: 1440 },
      { start: 0, end }
    ];
  }
}

/**
 * Returns true if two routine blocks overlap in time within the same schedule group.
 * Overlap exists if max(start1, start2) < min(end1, end2) for any pair of intervals.
 * Adjacent blocks touching at exact boundary (e.g. 08:00 and 08:00) do NOT overlap.
 */
function doBlocksOverlap(b1, b2) {
  const ints1 = getIntervalsForBlock(b1.start_time, b1.end_time);
  const ints2 = getIntervalsForBlock(b2.start_time, b2.end_time);
  for (const i1 of ints1) {
    for (const i2 of ints2) {
      if (Math.max(i1.start, i2.start) < Math.min(i1.end, i2.end)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validates whether a candidate block conflicts with existing blocks in a schedule group:
 * - Checks for identical or overlapping time intervals.
 * - Ensures total group duration does not exceed 24 hours (1440 minutes).
 */
function checkSingleBlockConflict(existingBlocks, candidateBlock, excludeId = null) {
  const cStart = normalizeTo24Hour(candidateBlock.start_time || '');
  const cEnd = normalizeTo24Hour(candidateBlock.end_time || '');
  if (!cStart || !cEnd || cStart === cEnd) {
    return { hasConflict: true, message: 'Invalid start or end time.' };
  }

  const candidate = { ...candidateBlock, start_time: cStart, end_time: cEnd };
  let currentGroupMinutes = 0;

  for (const ex of existingBlocks) {
    if (excludeId && ex.id === excludeId) continue;
    const exStart = normalizeTo24Hour(ex.start_time);
    const exEnd = normalizeTo24Hour(ex.end_time);
    currentGroupMinutes += calculateIntervalDuration(exStart, exEnd);

    if (doBlocksOverlap(candidate, { start_time: exStart, end_time: exEnd })) {
      const exName = ex.name ? `"${ex.name}"` : 'an existing routine';
      const cName = candidate.name ? `"${candidate.name}"` : 'Routine';
      return {
        hasConflict: true,
        conflictingRoutine: ex,
        message: `Overlap detected: ${cName} (${formatTime12Hour(cStart)}–${formatTime12Hour(cEnd)}) conflicts with ${exName} (${formatTime12Hour(exStart)}–${formatTime12Hour(exEnd)}). Please adjust the times.`
      };
    }
  }

  const candDuration = calculateIntervalDuration(cStart, cEnd);
  if (currentGroupMinutes + candDuration > 1440) {
    return {
      hasConflict: true,
      message: `Total routine duration cannot exceed 24 hours (1440 minutes). Current: ${currentGroupMinutes}m, Adding: ${candDuration}m.`
    };
  }

  return { hasConflict: false };
}

/**
 * Deduplicates and validates routine blocks for a single schedule group:
 * 1. Discards empty/invalid items.
 * 2. Normalizes 24-hour time strings.
 * 3. Removes exact duplicate time slots, keeping the first occurrence.
 * 4. Filters out overlapping blocks, preserving earlier non-conflicting ones.
 * 5. Guarantees total duration <= 1440 minutes (24 hours).
 */
function deduplicateRoutineBlocks(blocksList) {
  if (!Array.isArray(blocksList) || blocksList.length === 0) return [];
  const result = [];
  const seenExact = new Set();

  for (const block of blocksList) {
    if (!block || !block.name) continue;
    const startTime = normalizeTo24Hour(block.start_time || '');
    const endTime = normalizeTo24Hour(block.end_time || '');
    if (!startTime || !endTime || startTime === endTime) continue;

    const key = `${startTime}-${endTime}`;
    if (seenExact.has(key)) continue;

    const candidate = { ...block, start_time: startTime, end_time: endTime };
    const overlaps = result.some((accepted) => doBlocksOverlap(candidate, accepted));
    if (overlaps) {
      continue;
    }

    seenExact.add(key);
    result.push(candidate);
  }

  let totalMins = 0;
  const finalBlocks = [];
  for (const b of result) {
    const dur = calculateIntervalDuration(b.start_time, b.end_time);
    if (totalMins + dur <= 1440) {
      totalMins += dur;
      finalBlocks.push(b);
    }
  }

  return finalBlocks;
}

function calculateDayGaps(routinesList) {
  if (!Array.isArray(routinesList) || routinesList.length === 0) {
    return {
      gaps: [
        {
          start_time: '00:00',
          end_time: '00:00',
          start_12h: '12:00 AM',
          end_12h: '12:00 AM',
          start_minutes: 0,
          end_minutes: 1440,
          duration_minutes: 1440,
          is_overnight: false,
          is_unclassified: true
        }
      ],
      combined_overnight_gap: null,
      covered_minutes: 0,
      uncovered_minutes: 1440,
      is_full_day_covered: false
    };
  }

  // Break all routines down into occupied slices in [0, 1440)
  const coveredIntervals = [];

  for (const r of routinesList) {
    const start = parseTimeToMinutes(r.start_time);
    const end = parseTimeToMinutes(r.end_time);
    if (start === null || end === null || start === end) continue;

    if (start < end) {
      coveredIntervals.push({ start, end, routine: r });
    } else {
      // Overnight routine crossing midnight
      coveredIntervals.push({ start, end: 1440, routine: r });
      coveredIntervals.push({ start: 0, end, routine: r });
    }
  }

  if (coveredIntervals.length === 0) {
    return {
      gaps: [
        {
          start_time: '00:00',
          end_time: '00:00',
          start_12h: '12:00 AM',
          end_12h: '12:00 AM',
          start_minutes: 0,
          end_minutes: 1440,
          duration_minutes: 1440,
          is_overnight: false,
          is_unclassified: true
        }
      ],
      combined_overnight_gap: null,
      covered_minutes: 0,
      uncovered_minutes: 1440,
      is_full_day_covered: false
    };
  }

  // Sort by start ascending
  coveredIntervals.sort((a, b) => a.start - b.start || a.end - b.end);

  // Merge overlapping or adjacent intervals
  const merged = [];
  let cur = { start: coveredIntervals[0].start, end: coveredIntervals[0].end };

  for (let i = 1; i < coveredIntervals.length; i++) {
    const item = coveredIntervals[i];
    if (item.start <= cur.end) {
      cur.end = Math.max(cur.end, item.end);
    } else {
      merged.push(cur);
      cur = { start: item.start, end: item.end };
    }
  }
  merged.push(cur);

  let coveredMinutes = 0;
  for (const m of merged) {
    coveredMinutes += (m.end - m.start);
  }
  coveredMinutes = Math.min(1440, coveredMinutes);
  const uncoveredMinutes = Math.max(0, 1440 - coveredMinutes);

  // If completely covered
  if (uncoveredMinutes === 0) {
    return {
      gaps: [],
      combined_overnight_gap: null,
      covered_minutes: 1440,
      uncovered_minutes: 0,
      is_full_day_covered: true
    };
  }

  const gaps = [];

  // Check if first merged slice starts after 00:00
  if (merged[0].start > 0) {
    gaps.push({
      start_minutes: 0,
      end_minutes: merged[0].start,
      start_time: '00:00',
      end_time: minutesToTime24(merged[0].start),
      start_12h: '12:00 AM',
      end_12h: formatTime12Hour(minutesToTime24(merged[0].start)),
      duration_minutes: merged[0].start,
      is_overnight: false,
      is_unclassified: true
    });
  }

  // Intermediate gaps
  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i].end < merged[i + 1].start) {
      const dur = merged[i + 1].start - merged[i].end;
      const s24 = minutesToTime24(merged[i].end);
      const e24 = minutesToTime24(merged[i + 1].start);
      gaps.push({
        start_minutes: merged[i].end,
        end_minutes: merged[i + 1].start,
        start_time: s24,
        end_time: e24,
        start_12h: formatTime12Hour(s24),
        end_12h: formatTime12Hour(e24),
        duration_minutes: dur,
        is_overnight: false,
        is_unclassified: true
      });
    }
  }

  // Trailing gap after last merged slice before 24:00 (1440)
  const last = merged[merged.length - 1];
  if (last.end < 1440) {
    const dur = 1440 - last.end;
    const s24 = minutesToTime24(last.end);
    gaps.push({
      start_minutes: last.end,
      end_minutes: 1440,
      start_time: s24,
      end_time: '00:00',
      start_12h: formatTime12Hour(s24),
      end_12h: '12:00 AM',
      duration_minutes: dur,
      is_overnight: false,
      is_unclassified: true
    });
  }

  let combinedOvernightGap = null;
  if (merged[0].start > 0 && last.end < 1440 && gaps.length >= 2) {
    const nightStart = minutesToTime24(last.end);
    const morningEnd = minutesToTime24(merged[0].start);
    combinedOvernightGap = {
      start_time: nightStart,
      end_time: morningEnd,
      start_12h: formatTime12Hour(nightStart),
      end_12h: formatTime12Hour(morningEnd),
      duration_minutes: (1440 - last.end) + merged[0].start,
      is_overnight: true,
      is_unclassified: true
    };
  }

  return {
    gaps,
    combined_overnight_gap: combinedOvernightGap,
    covered_minutes: coveredMinutes,
    uncovered_minutes: uncoveredMinutes,
    is_full_day_covered: uncoveredMinutes === 0
  };
}

function getRoutineCoverageStatusSync(db, userId) {
  if (!userId) {
    return {
      is_routine_complete: false,
      routine_coverage_incomplete: true,
      incomplete_group: 'both',
      weekday_coverage: 0,
      weekend_coverage: 0,
      weekday_complete: false,
      weekend_complete: false,
      message: 'Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.'
    };
  }

  try {
    const weekdayBlocks = db.prepare(`
      SELECT * FROM routines
      WHERE user_id = ? AND schedule_group = 'weekdays'
    `).all(userId);

    const weekendBlocks = db.prepare(`
      SELECT * FROM routines
      WHERE user_id = ? AND schedule_group = 'weekends'
    `).all(userId);

    const weekdayGaps = weekdayBlocks.length > 0
      ? calculateDayGaps(weekdayBlocks)
      : { is_full_day_covered: false, covered_minutes: 0, uncovered_minutes: 1440, gaps: [{ duration_minutes: 1440 }] };

    const weekendGaps = weekendBlocks.length > 0
      ? calculateDayGaps(weekendBlocks)
      : { is_full_day_covered: false, covered_minutes: 0, uncovered_minutes: 1440, gaps: [{ duration_minutes: 1440 }] };

    const weekdayComplete = Boolean(weekdayGaps.is_full_day_covered && weekdayGaps.uncovered_minutes === 0 && (!weekdayGaps.gaps || weekdayGaps.gaps.length === 0));
    const weekendComplete = Boolean(weekendGaps.is_full_day_covered && weekendGaps.uncovered_minutes === 0 && (!weekendGaps.gaps || weekendGaps.gaps.length === 0));

    const isComplete = weekdayComplete && weekendComplete;

    let incompleteGroup = null;
    let message = '';
    if (!weekdayComplete && !weekendComplete) {
      incompleteGroup = 'both';
      message = 'Your 24-hour daily routine is incomplete for Weekdays and Weekends — EKAGRA cannot schedule your goals accurately without your full 24-hour schedule.';
    } else if (!weekdayComplete) {
      incompleteGroup = 'weekdays';
      message = 'Your Weekdays (Mon–Fri) 24-hour routine is incomplete — EKAGRA needs your full 24-hour schedule to know when you are free vs. busy.';
    } else if (!weekendComplete) {
      incompleteGroup = 'weekends';
      message = 'Your Weekends (Sat–Sun) 24-hour routine is not set up yet — EKAGRA cannot schedule today until you set it up.';
    }

    return {
      is_routine_complete: isComplete,
      routine_coverage_incomplete: !isComplete,
      incomplete_group: incompleteGroup,
      weekday_coverage: weekdayGaps.covered_minutes || 0,
      weekend_coverage: weekendGaps.covered_minutes || 0,
      weekday_complete: weekdayComplete,
      weekend_complete: weekendComplete,
      message
    };
  } catch (err) {
    console.error('[getRoutineCoverageStatus error]', err);
    return {
      is_routine_complete: false,
      routine_coverage_incomplete: true,
      incomplete_group: 'both',
      weekday_coverage: 0,
      weekend_coverage: 0,
      weekday_complete: false,
      weekend_complete: false,
      message: 'Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.'
    };
  }
}

async function getRoutineCoverageStatusAsync(db, userId) {
  if (!userId) {
    return {
      is_routine_complete: false,
      routine_coverage_incomplete: true,
      incomplete_group: 'both',
      weekday_coverage: 0,
      weekend_coverage: 0,
      weekday_complete: false,
      weekend_complete: false,
      message: 'Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.'
    };
  }

  try {
    const weekdayBlocks = await db.prepare(`
      SELECT * FROM routines
      WHERE user_id = ? AND schedule_group = 'weekdays'
    `).all(userId);

    const weekendBlocks = await db.prepare(`
      SELECT * FROM routines
      WHERE user_id = ? AND schedule_group = 'weekends'
    `).all(userId);

    const weekdayGaps = weekdayBlocks.length > 0
      ? calculateDayGaps(weekdayBlocks)
      : { is_full_day_covered: false, covered_minutes: 0, uncovered_minutes: 1440, gaps: [{ duration_minutes: 1440 }] };

    const weekendGaps = weekendBlocks.length > 0
      ? calculateDayGaps(weekendBlocks)
      : { is_full_day_covered: false, covered_minutes: 0, uncovered_minutes: 1440, gaps: [{ duration_minutes: 1440 }] };

    const weekdayComplete = Boolean(weekdayGaps.is_full_day_covered && weekdayGaps.uncovered_minutes === 0 && (!weekdayGaps.gaps || weekdayGaps.gaps.length === 0));
    const weekendComplete = Boolean(weekendGaps.is_full_day_covered && weekendGaps.uncovered_minutes === 0 && (!weekendGaps.gaps || weekendGaps.gaps.length === 0));

    const isComplete = weekdayComplete && weekendComplete;

    let incompleteGroup = null;
    let message = '';
    if (!weekdayComplete && !weekendComplete) {
      incompleteGroup = 'both';
      message = 'Your 24-hour daily routine is incomplete for Weekdays and Weekends — EKAGRA cannot schedule your goals accurately without your full 24-hour schedule.';
    } else if (!weekdayComplete) {
      incompleteGroup = 'weekdays';
      message = 'Your Weekdays (Mon–Fri) 24-hour routine is incomplete — EKAGRA needs your full 24-hour schedule to know when you are free vs. busy.';
    } else if (!weekendComplete) {
      incompleteGroup = 'weekends';
      message = 'Your Weekends (Sat–Sun) 24-hour routine is not set up yet — EKAGRA cannot schedule today until you set it up.';
    }

    return {
      is_routine_complete: isComplete,
      routine_coverage_incomplete: !isComplete,
      incomplete_group: incompleteGroup,
      weekday_coverage: weekdayGaps.covered_minutes || 0,
      weekend_coverage: weekendGaps.covered_minutes || 0,
      weekday_complete: weekdayComplete,
      weekend_complete: weekendComplete,
      message
    };
  } catch (err) {
    console.error('[getRoutineCoverageStatus error]', err);
    return {
      is_routine_complete: false,
      routine_coverage_incomplete: true,
      incomplete_group: 'both',
      weekday_coverage: 0,
      weekend_coverage: 0,
      weekday_complete: false,
      weekend_complete: false,
      message: 'Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.'
    };
  }
}

function getRoutineCoverageStatus(db, userId) {
  if (db && db.isTurso) {
    return getRoutineCoverageStatusAsync(db, userId);
  }
  return getRoutineCoverageStatusSync(db, userId);
}

function isRoutineCoverageComplete(db, userId) {
  if (db && db.isTurso) {
    return (async () => {
      const status = await getRoutineCoverageStatusAsync(db, userId);
      return status.is_routine_complete;
    })();
  }
  return getRoutineCoverageStatusSync(db, userId).is_routine_complete;
}

module.exports = {
  DAY_NAMES,
  DEFAULT_WEEKDAYS,
  DEFAULT_WEEKENDS,
  parseTimeToMinutes,
  formatTime12Hour,
  normalizeTo24Hour,
  normalizeDays,
  formatDaysForStorage,
  hasValidRoutineSetup,
  hasValidRoutineSetupSync,
  hasValidRoutineSetupAsync,
  getUserScheduleSettings,
  getUserScheduleSettingsSync,
  getUserScheduleSettingsAsync,
  updateUserScheduleSettings,
  updateUserScheduleSettingsSync,
  updateUserScheduleSettingsAsync,
  setInitialSetupStatus,
  setInitialSetupStatusSync,
  setInitialSetupStatusAsync,
  getBlockIntervals,
  checkRoutineOverlap,
  checkRoutineOverlapSync,
  checkRoutineOverlapAsync,
  minutesToTime24,
  calculateIntervalDuration,
  getIntervalsForBlock,
  doBlocksOverlap,
  checkSingleBlockConflict,
  deduplicateRoutineBlocks,
  calculateDayGaps,
  isRoutineCoverageComplete,
  getRoutineCoverageStatus,
  getRoutineCoverageStatusSync,
  getRoutineCoverageStatusAsync
};
