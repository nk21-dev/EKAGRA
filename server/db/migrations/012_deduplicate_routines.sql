-- Migration: Deduplicate routines per (user_id, schedule_group)
DELETE FROM routines
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY user_id, schedule_group, start_time, end_time 
      ORDER BY created_at ASC, id ASC
    ) as rn
    FROM routines
  ) WHERE rn = 1
);
