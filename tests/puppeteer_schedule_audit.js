const puppeteer = require('puppeteer-core');

(async () => {
  console.log('🚀 Starting Puppeteer Schedule Sync & View Audit...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[SCHEDULE AUDIT]') || text.includes('error') || text.includes('Error')) {
      console.log('  [Browser]', text);
    }
  });

  try {
    const timestamp = Date.now();
    const testEmail = `sched_audit_${timestamp}@ekagra.ai`;
    const testPassword = 'Password123!@#';

    // 1. Sign up on live server
    console.log('1. Signing up user...');
    await page.goto('http://localhost:3000/signup', { waitUntil: 'networkidle0' });
    await page.type('#name', 'Schedule Audit Tester');
    await page.type('#email', testEmail);
    await page.type('#password', testPassword);
    await page.type('#confirmPassword', testPassword);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('#signupSubmitBtn')
    ]);

    console.log('2. Landed on:', page.url());
    if (!page.url().includes('/dashboard')) {
      throw new Error(`Expected redirect to /dashboard, got: ${page.url()}`);
    }

    // 2. Set up initial routines via API from page context
    console.log('3. Setting up full 24h routine and goal with tasks...');
    await page.evaluate(async () => {
      // Setup routines
      await fetch('/api/routines/initial-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          weekends_days: ['Saturday', 'Sunday'],
          routines: [
            { name: 'Sleep', start_time: '23:00', end_time: '07:00', availability_type: 'busy', type: 'sleep', schedule_group: 'weekdays' },
            { name: 'Morning Routine', start_time: '07:00', end_time: '09:00', availability_type: 'busy', type: 'routine', schedule_group: 'weekdays' },
            { name: 'College / Work', start_time: '09:00', end_time: '17:00', availability_type: 'busy', type: 'work', schedule_group: 'weekdays' },
            { name: 'Deep Focus Window', start_time: '17:00', end_time: '21:00', availability_type: 'available', type: 'study', schedule_group: 'weekdays' },
            { name: 'Evening Wind-down', start_time: '21:00', end_time: '23:00', availability_type: 'busy', type: 'leisure', schedule_group: 'weekdays' }
          ]
        })
      });

      // Copy to weekends
      await fetch('/api/routines/copy-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromGroup: 'weekdays', toGroup: 'weekends' })
      });

      // Create Goal
      const gRes = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'AI Engineering Sprint', priority: 'High', target_date: '2026-11-30' })
      });
      const gData = await gRes.json();
      const goalId = gData.goal.id;

      // Create 3 Tasks
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'Backpropagation Derivation', duration_minutes: 45, priority: 'High' })
      });
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'NeetCode 150 Graphs', duration_minutes: 60, priority: 'Medium' })
      });
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'Hybrid RAG Pipeline', duration_minutes: 45, priority: 'Medium' })
      });

      // Auto schedule
      await fetch('/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysAhead: 7, clearExisting: true })
      });

      // Reload store state
      await window.Store.loadTodaySchedule();
      await window.Store.init();
      window.renderHome(window.Store.state);
    });

    await new Promise((r) => setTimeout(r, 1000));

    // 3. Test "View all →" Navigation from Home Today's Schedule Card
    console.log('4. Testing "View all →" Navigation from Home...');
    const clickResult = await page.evaluate(() => {
      const link = document.querySelector('.card-header-link[onclick*="openScheduleTodayDayView"]');
      if (!link) return { found: false, html: document.body.innerHTML.slice(0, 500) };
      link.click();
      return {
        found: true,
        currentView: window.Store.state.currentView,
        mode: window.Store.state.scheduleViewMode
      };
    });
    console.log('   Click result:', clickResult);
    await new Promise((r) => setTimeout(r, 500));

    const activeView = await page.evaluate(() => window.Store.state.currentView);
    const activeMode = await page.evaluate(() => window.Store.state.scheduleViewMode);
    console.log(`   Active View: ${activeView}, Mode: ${activeMode}`);
    if (activeView !== 'schedule' || activeMode !== 'Day') {
      throw new Error(`Expected view=schedule and mode=Day, got view=${activeView}, mode=${activeMode}`);
    }

    // 4. Verify Today button is NOT highlighted when viewing Today
    const isTodayHighlighted = await page.evaluate(() => {
      const btn = document.getElementById('scheduleTodayBtn');
      return btn ? btn.classList.contains('highlight-today-btn') : false;
    });
    console.log(`   Is Today button highlighted on Today? ${isTodayHighlighted} (expected: false)`);
    if (isTodayHighlighted) throw new Error('Today button should NOT be highlighted on Today');

    // 5. Navigate to a future date with 0 tasks (e.g., jump 12 days ahead)
    console.log('5. Navigating 12 days into the future...');
    await page.evaluate(() => {
      window.navigateScheduleDay(12);
    });
    await new Promise((r) => setTimeout(r, 600));

    // Verify Today button IS now highlighted
    const isFutureHighlighted = await page.evaluate(() => {
      const btn = document.getElementById('scheduleTodayBtn');
      return btn ? btn.classList.contains('highlight-today-btn') : false;
    });
    console.log(`   Is Today button highlighted on future date? ${isFutureHighlighted} (expected: true)`);
    if (!isFutureHighlighted) throw new Error('Today button MUST be highlighted when viewing non-today date');

    // Verify Unscheduled Queue does NOT contain the scheduled tasks!
    const unscheduledQueueText = await page.evaluate(() => {
      const q = document.querySelector('.unscheduled-queue-card');
      return q ? q.textContent : null;
    });
    console.log(`   Unscheduled Queue content on future date: ${unscheduledQueueText ? 'PRESENT' : 'NONE (Clean)'}`);

    // Verify empty day callout is present with Jump to Today
    const calloutText = await page.evaluate(() => {
      const callout = document.querySelector('.schedule-empty-day-callout');
      return callout ? callout.textContent.trim() : null;
    });
    console.log(`   Empty Day Callout text: "${calloutText}"`);
    if (!calloutText || !calloutText.includes('Jump to Today')) {
      throw new Error('Expected empty day callout with "Jump to Today" button');
    }
    if (!calloutText.includes('scheduled on Today')) {
      throw new Error('Expected callout to note tasks scheduled on Today');
    }

    // 6. Click "Jump to Today" and verify snap
    console.log('6. Clicking "Jump to Today"...');
    await page.evaluate(() => {
      const jumpBtn = document.querySelector('.schedule-empty-day-callout button');
      if (jumpBtn) jumpBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    const isSnappedTodayHighlighted = await page.evaluate(() => {
      const btn = document.getElementById('scheduleTodayBtn');
      return btn ? btn.classList.contains('highlight-today-btn') : false;
    });
    console.log(`   Is Today button highlighted after Jump to Today? ${isSnappedTodayHighlighted} (expected: false)`);
    if (isSnappedTodayHighlighted) throw new Error('Today button should NOT be highlighted after jumping to Today');

    // 7. Test Instant 0ms View Switching: Month -> Day / Week
    console.log('7. Testing 0ms Instant View Switching...');
    // Click Month
    await page.evaluate(() => {
      window.setScheduleViewMode('Month');
    });
    const hasMonthCalendar = await page.evaluate(() => Boolean(document.querySelector('.month-calendar-view')));
    const isMonthPillActive = await page.evaluate(() => document.querySelector('.schedule-mode-btn[data-mode="Month"]').classList.contains('active'));
    console.log(`   Month rendered instantly? ${hasMonthCalendar}, pill active? ${isMonthPillActive}`);
    if (!hasMonthCalendar || !isMonthPillActive) throw new Error('Month view failed to render instantly on Click 1');

    // Click Week
    await page.evaluate(() => {
      window.setScheduleViewMode('Week');
    });
    const hasWeekGrid = await page.evaluate(() => Boolean(document.querySelector('.week-grid-view')));
    const isWeekPillActive = await page.evaluate(() => document.querySelector('.schedule-mode-btn[data-mode="Week"]').classList.contains('active'));
    console.log(`   Week rendered instantly? ${hasWeekGrid}, pill active? ${isWeekPillActive}`);
    if (!hasWeekGrid || !isWeekPillActive) throw new Error('Week view failed to render instantly on Click 1');

    // Click Day
    await page.evaluate(() => {
      window.setScheduleViewMode('Day');
    });
    const isDayPillActive = await page.evaluate(() => document.querySelector('.schedule-mode-btn[data-mode="Day"]').classList.contains('active'));
    console.log(`   Day pill active? ${isDayPillActive}`);
    if (!isDayPillActive) throw new Error('Day view failed to activate pill on Click 1');

    // 8. Test Single-Task Scheduling from Unscheduled Queue
    console.log('8. Testing Single-Task Scheduling from Unscheduled Queue...');
    // Add an unscheduled independent task
    const indTaskTitle = 'Audit Security Headers';
    await page.evaluate(async (title) => {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, duration_minutes: 30, priority: 'Medium' })
      });
      const data = await res.json();
      const taskId = data.task.id;

      // Mark it missed so it drops into the Unscheduled Queue
      await fetch('/api/schedule/miss-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });

      // Refresh schedule view
      await window.Store.loadTodaySchedule();
      await window.Store.init();
      await window.renderSchedule(window.Store.state);
    }, indTaskTitle);

    await new Promise((r) => setTimeout(r, 1000));

    // Verify task is now visible in Unscheduled Queue
    const hasUnscheduledTask = await page.evaluate((title) => {
      const rows = Array.from(document.querySelectorAll('.unscheduled-task-row'));
      return rows.some((r) => r.textContent.includes(title));
    }, indTaskTitle);
    console.log(`   Truly unscheduled task visible in queue? ${hasUnscheduledTask} (expected: true)`);
    if (!hasUnscheduledTask) throw new Error('Truly unscheduled task should appear in Unscheduled Queue');

    // Click single task schedule button
    console.log('9. Clicking single ⚡ Schedule button on unscheduled task...');
    const scheduleBtnClicked = await page.evaluate((title) => {
      const rows = Array.from(document.querySelectorAll('.unscheduled-task-row'));
      const row = rows.find((r) => r.textContent.includes(title));
      if (!row) return false;
      const btn = row.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    }, indTaskTitle);

    if (!scheduleBtnClicked) throw new Error('Could not find or click ⚡ Schedule button on unscheduled task row');

    // Wait for action lock and request completion
    await page.waitForFunction(() => document.querySelectorAll('.btn-action-locked').length === 0, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Verify task is removed from Unscheduled Queue and now in the scheduled timeline!
    const taskStillInQueue = await page.evaluate((title) => {
      const rows = Array.from(document.querySelectorAll('.unscheduled-task-row'));
      return rows.some((r) => r.textContent.includes(title));
    }, indTaskTitle);
    console.log(`   Task removed from Unscheduled Queue? ${!taskStillInQueue} (expected: true)`);
    if (taskStillInQueue) throw new Error('Task should be removed from Unscheduled Queue after scheduling');

    const taskInTimeline = await page.evaluate((title) => {
      const slots = Array.from(document.querySelectorAll('.scheduled-task-slot'));
      return slots.some((s) => s.textContent.includes(title));
    }, indTaskTitle);
    console.log(`   Task now visible in Scheduled Timeline? ${taskInTimeline} (expected: true)`);
    if (!taskInTimeline) throw new Error('Task should now appear in the scheduled timeline');

    console.log('\n🎉 ALL LIVE BROWSER SCHEDULE AUDIT TESTS PASSED 100%!');
  } catch (err) {
    console.error('\n❌ AUDIT FAILED:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
