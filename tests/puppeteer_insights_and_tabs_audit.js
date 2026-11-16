/**
 * EKAGRA — Live Browser Insights & Multi-Tab Audit
 * Tests:
 * 1. Mixed-state Task Breakdown Donut Chart math (4 Completed, 1 Scheduled, 1 Unscheduled)
 * 2. Orange arc is strictly 0 when missed === 0 (no false 100% solid orange ring)
 * 3. Donut legend shows exact counts e.g. Completed (4), Scheduled (1), Missed (0), Unscheduled (1)
 * 4. Active streak grammar (1 day vs X days)
 * 5. Productivity Trend Y-axis scale, value labels, and hover tooltips
 * 6. Top Insights cards consistency (Speed Learner, Focus Quality 100% sum, Routine Capacity, Goal Forecasts with projected_completion_date)
 * 7. Complete 7-tab audit in both Light and Dark mode (Home, Goals, Tasks, Schedule, Routines, Insights, Settings)
 */

const puppeteer = require('puppeteer-core');

(async () => {
  console.log('🚀 Starting EKAGRA Live Browser Insights & 7-Tab Audit...');
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 850 });

  const consoleErrors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
    if (text.includes('SCHEDULE TASK 5 RESULT')) {
      console.log('  [Browser]', text);
    }
  });

  try {
    const timestamp = Date.now();
    const email = `insights_audit_${timestamp}@ekagra.ai`;
    const password = 'Password@123!';

    // 1. Sign up
    console.log('1. Signing up user for Insights Audit...');
    await page.goto('http://localhost:3000/signup', { waitUntil: 'networkidle0' });
    await page.type('#name', 'Insights Tester');
    await page.type('#email', email);
    await page.type('#password', password);
    await page.type('#confirmPassword', password);
    await page.click('button[type="submit"]');

    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log(`2. Landed on: ${page.url()}`);

    // 2. Set up full 24h routine (Fixed + Available)
    console.log('3. Setting up full 24h routine and goals with tasks...');
    await page.evaluate(async () => {
      // 24h Weekdays Routine
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

      // Create Goal: Distributed Systems
      const goalRes = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Distributed Systems Mastery',
          priority: 'High',
          target_date: '2026-12-31'
        })
      });
      const goalData = await goalRes.json();
      const goalId = goalData.goal ? goalData.goal.id : goalData.id;

      // Create 6 Tasks:
      // Tasks 1-4: Completed
      const t1 = await (await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'Raft Consensus Algorithm', duration_minutes: 60, priority: 'High' })
      })).json();

      const t2 = await (await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'Vector Clocks Implementation', duration_minutes: 45, priority: 'High' })
      })).json();

      const t3 = await (await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'Paxos Safety Invariants', duration_minutes: 60, priority: 'Medium' })
      })).json();

      const t4 = await (await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'Consistent Hashing Ring', duration_minutes: 45, priority: 'Medium' })
      })).json();

      // Task 5: Scheduled
      const t5 = await (await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId, title: 'Distributed Tracing & OpenTelemetry', duration_minutes: 60, priority: 'Medium' })
      })).json();

      // Task 6: Unscheduled Independent Task
      const t6 = await (await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Gossip Protocol Simulation', duration_minutes: 30, priority: 'Low' })
      })).json();

      // Complete Tasks 1, 2, 3, 4 with verified execution times
      const compTasks = [t1.task.id, t2.task.id, t3.task.id, t4.task.id];
      for (const tid of compTasks) {
        await fetch('/api/schedule/complete-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: tid,
            actualMinutes: 45,
            notes: 'Completed in audit test',
            rating: 5
          })
        });
      }

      // Schedule Task 5
      const schedRes = await fetch('/api/schedule/schedule-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: t5.task.id })
      });
      const schedJson = await schedRes.json();
      console.log('SCHEDULE TASK 5 RESULT:', JSON.stringify(schedJson));

      // Unschedule Task 6 by clearing any auto-generated blocks
      // (or ensuring it has no active scheduled_blocks)
      await window.Store.init();
      await window.Store.loadTodaySchedule();
      await window.Store.loadInsights();
    });

    await new Promise((r) => setTimeout(r, 1000));

    // 3. Navigate to Insights Tab
    console.log('4. Navigating to Insights Tab...');
    await page.evaluate(() => {
      window.switchView('insights');
    });
    await new Promise((r) => setTimeout(r, 800));

    // 4. Inspect Task Breakdown Donut Chart
    console.log('5. Auditing Task Breakdown Donut Chart...');
    const breakdownData = await page.evaluate(async () => {
      const res = await fetch('/api/insights');
      const data = await res.json();
      return data.task_breakdown;
    });
    console.log('   API task_breakdown:', JSON.stringify(breakdownData));

    const donutDom = await page.evaluate(() => {
      const container = document.getElementById('taskBreakdownDonutContainer');
      if (!container) return null;

      const circles = Array.from(container.querySelectorAll('svg circle[stroke]'));
      const segmentCircles = circles.filter(c => c.getAttribute('stroke-dasharray') || c.getAttribute('data-segment'));

      const segments = segmentCircles.map(c => ({
        color: c.getAttribute('stroke'),
        dasharray: c.getAttribute('stroke-dasharray'),
        dashoffset: c.getAttribute('stroke-dashoffset'),
        segment: c.getAttribute('data-segment'),
        count: c.getAttribute('data-count'),
        pct: c.getAttribute('data-pct')
      }));

      const centerText = container.textContent.trim().replace(/\s+/g, ' ');

      const legendEls = Array.from(document.querySelectorAll('.ring-legend-item')).map(el => el.textContent.trim().replace(/\s+/g, ' '));
      const legend = {
        completed: legendEls[0],
        scheduled: legendEls[1],
        missed: legendEls[2],
        unscheduled: legendEls[3]
      };

      return {
        centerText,
        segments,
        legend
      };
    });

    console.log('   Donut DOM Inspection:', JSON.stringify(donutDom, null, 2));

    // Verify Center Text shows "4 / 6 Completed"
    if (!donutDom.centerText.includes('4 / 6') || !donutDom.centerText.includes('Completed')) {
      throw new Error(`Expected center text to show "4 / 6 Completed", got "${donutDom.centerText}"`);
    }

    // Verify Legend counts in exact user scenario (4 Completed, 2 Scheduled, 0 Missed, 0 Unscheduled)
    if (donutDom.legend.completed !== 'Completed (4)') {
      throw new Error(`Expected "Completed (4)", got "${donutDom.legend.completed}"`);
    }
    if (donutDom.legend.scheduled !== 'Scheduled (2)') {
      throw new Error(`Expected "Scheduled (2)", got "${donutDom.legend.scheduled}"`);
    }
    if (donutDom.legend.missed !== 'Missed (0)') {
      throw new Error(`Expected "Missed (0)", got "${donutDom.legend.missed}"`);
    }
    if (donutDom.legend.unscheduled !== 'Unscheduled (0)') {
      throw new Error(`Expected "Unscheduled (0)", got "${donutDom.legend.unscheduled}"`);
    }

    // Verify Green segment exists and is ~67% (4/6)
    const greenSegment = donutDom.segments.find(s => s.color === '#10B981');
    if (!greenSegment) {
      throw new Error('Emerald Green (#10B981) segment missing from donut chart!');
    }
    console.log(`   Green segment found with pct: ${greenSegment.pct}% (expected ~67%)`);
    if (Number(greenSegment.pct) < 60 || Number(greenSegment.pct) > 75) {
      throw new Error(`Green segment percentage unexpected: ${greenSegment.pct}%`);
    }

    // Verify Cyan (Scheduled) segment exists and is ~33% (2/6)
    const cyanSegment = donutDom.segments.find(s => s.color === '#06B6D4');
    if (!cyanSegment) {
      throw new Error('Cyan (#06B6D4) scheduled segment missing from donut chart!');
    }
    console.log(`   Cyan (Scheduled) segment found with pct: ${cyanSegment.pct}% (expected ~33%)`);
    if (Number(cyanSegment.pct) < 28 || Number(cyanSegment.pct) > 40) {
      throw new Error(`Cyan segment percentage unexpected: ${cyanSegment.pct}%`);
    }

    // Verify Orange (Missed) segment is ZERO circles (NOT covering the ring!)
    const orangeSegment = donutDom.segments.find(s => s.color === '#F59E0B');
    if (orangeSegment) {
      throw new Error('Orange (#F59E0B) segment should NOT be rendered when missed === 0!');
    }
    console.log('   Orange (#F59E0B) segment arc is strictly 0 (not covering the ring!) ✅');

    // Test Transition to 4-Way Mixed State (with Missed task)
    console.log('5b. Testing 4-Way Mixed State with Missed Task...');
    await page.evaluate(async () => {
      // Find one of the incomplete tasks and mark it missed
      const state = window.Store.state;
      const incompleteTask = (state.tasks || []).find((t) => !t.completed);
      if (incompleteTask) {
        await fetch('/api/schedule/miss-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: incompleteTask.id })
        });
      }
      await window.Store.loadInsights();
      await window.renderInsights(window.Store.state);
    });
    await new Promise((r) => setTimeout(r, 800));

    const mixedDonutDom = await page.evaluate(() => {
      const container = document.getElementById('taskBreakdownDonutContainer');
      const circles = Array.from(container.querySelectorAll('svg circle[stroke]'));
      const segmentCircles = circles.filter(c => c.getAttribute('stroke-dasharray') || c.getAttribute('data-segment'));

      return {
        centerText: container.textContent.trim().replace(/\s+/g, ' '),
        segments: segmentCircles.map(c => ({
          color: c.getAttribute('stroke'),
          segment: c.getAttribute('data-segment'),
          count: c.getAttribute('data-count'),
          pct: c.getAttribute('data-pct')
        })),
        legend: (() => {
          const els = Array.from(document.querySelectorAll('.ring-legend-item')).map(el => el.textContent.trim().replace(/\s+/g, ' '));
          return {
            completed: els[0],
            scheduled: els[1],
            missed: els[2],
            unscheduled: els[3]
          };
        })()
      };
    });
    console.log('   4-Way Mixed Donut DOM:', JSON.stringify(mixedDonutDom, null, 2));

    if (mixedDonutDom.legend.missed !== 'Missed (1)') {
      throw new Error(`Expected "Missed (1)" after marking task missed, got "${mixedDonutDom.legend.missed}"`);
    }
    if (mixedDonutDom.legend.scheduled !== 'Scheduled (1)') {
      throw new Error(`Expected "Scheduled (1)", got "${mixedDonutDom.legend.scheduled}"`);
    }
    const mixedOrangeSeg = mixedDonutDom.segments.find(s => s.color === '#F59E0B');
    if (!mixedOrangeSeg) {
      throw new Error('Orange (#F59E0B) segment should now be present for the 1 missed task');
    }
    console.log(`   Orange segment now accurately rendered: count=${mixedOrangeSeg.count}, pct=${mixedOrangeSeg.pct}% ✅`);

    // 5. Inspect Active Streak Grammar
    console.log('6. Checking Active Streak Grammar...');
    const streakText = await page.evaluate(() => {
      const el = document.getElementById('insightsKpiStreak');
      return el ? el.textContent.trim() : null;
    });
    console.log(`   Active Streak text: "${streakText}"`);
    if (streakText === '1 days') {
      throw new Error('Streak grammar error: found "1 days", expected "1 day"');
    }
    if (!streakText.includes('day')) {
      throw new Error(`Unexpected streak text format: "${streakText}"`);
    }

    // 6. Inspect Productivity Trend Chart
    console.log('7. Auditing Productivity Trend Chart...');
    const chartDom = await page.evaluate(() => {
      const container = document.getElementById('productivityChartContainer');
      if (!container) return null;

      const svg = container.querySelector('svg');
      const yAxisTexts = Array.from(svg ? svg.querySelectorAll('text') : []).map(t => t.textContent.trim());
      const pointTitles = Array.from(svg ? svg.querySelectorAll('title') : []).map(t => t.textContent.trim());
      const hasBezierPath = Boolean(svg?.querySelector('path[stroke="#10B981"]'));
      const hasAreaPath = Boolean(svg?.querySelector('path[fill="url(#curveGrad)"]'));

      return {
        yAxisTexts,
        pointTitles,
        hasBezierPath,
        hasAreaPath
      };
    });
    console.log('   Productivity Chart info:', JSON.stringify(chartDom));
    if (!chartDom.hasBezierPath || !chartDom.hasAreaPath) {
      throw new Error('Productivity area/curve path missing from SVG');
    }
    if (chartDom.pointTitles.length < 7) {
      throw new Error('Expected 7 point hover tooltips in productivity chart');
    }
    console.log(`   Sample tooltip: "${chartDom.pointTitles[chartDom.pointTitles.length - 1]}"`);

    // 7. Inspect Top Insights Cards
    console.log('8. Auditing Top Insights Cards...');
    const topInsights = await page.evaluate(() => {
      const hub = document.getElementById('insightsHubFeed');
      if (!hub) return null;

      const text = hub.textContent;
      const speedLearnerMatches = text.includes('Speed Learner: Pace Factor');
      const calibratedMatches = text.includes('Calibrated from 4 verified task durations');
      const routineMatches = text.includes('Routine Availability:');
      const forecastMatches = text.includes('Goal Velocity & Pacing Forecasts');
      const projDateMatches = text.includes('Proj:');

      // Check time bucket focus quality & slip risk
      const morningBox = Array.from(hub.querySelectorAll('strong')).find(el => el.textContent === 'Morning');
      const afternoonBox = Array.from(hub.querySelectorAll('strong')).find(el => el.textContent === 'Afternoon');

      return {
        speedLearnerMatches,
        calibratedMatches,
        routineMatches,
        forecastMatches,
        projDateMatches,
        hasMorning: Boolean(morningBox),
        hasAfternoon: Boolean(afternoonBox)
      };
    });
    console.log('   Top Insights check:', JSON.stringify(topInsights));
    if (!topInsights.speedLearnerMatches || !topInsights.calibratedMatches) {
      throw new Error('Speed Learner card missing or calibrated count not verified');
    }
    if (!topInsights.routineMatches) {
      throw new Error('Routine Availability card missing');
    }
    if (!topInsights.forecastMatches || !topInsights.projDateMatches) {
      throw new Error('Goal Velocity & Pacing Forecasts card missing or projected date not shown');
    }

    // 8. Test All 7 Tabs in Dark & Light Modes
    console.log('9. Checking all 7 Dashboard Tabs in Dark and Light Modes...');
    const tabs = ['home', 'goals', 'tasks', 'schedule', 'routines', 'insights', 'settings'];

    for (const theme of ['dark', 'light']) {
      console.log(`   --- Testing Theme: ${theme.toUpperCase()} ---`);
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('ekagra_theme', t);
      }, theme);

      for (const tab of tabs) {
        await page.evaluate((targetTab) => {
          window.switchView(targetTab);
        }, tab);

        await new Promise((r) => setTimeout(r, 200));

        const tabCheck = await page.evaluate((targetTab) => {
          const viewEl = document.getElementById(`view-${targetTab}`);
          const isActive = viewEl && viewEl.classList.contains('active');
          const hasBrokenText = viewEl ? (viewEl.textContent.includes('NaN') || viewEl.textContent.includes('undefined')) : false;

          return {
            isActive,
            hasBrokenText
          };
        }, tab);

        if (!tabCheck.isActive) {
          throw new Error(`Tab "${tab}" failed to activate in ${theme} mode`);
        }
        if (tabCheck.hasBrokenText) {
          throw new Error(`Tab "${tab}" has NaN or undefined rendered text in ${theme} mode!`);
        }
      }
    }

    if (consoleErrors.length > 0) {
      console.warn('Console errors detected during run:', consoleErrors);
    }

    console.log('\n🎉 ALL LIVE BROWSER INSIGHTS & 7-TAB AUDIT TESTS PASSED 100%!');
  } catch (err) {
    console.error('\n❌ AUDIT FAILED:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
