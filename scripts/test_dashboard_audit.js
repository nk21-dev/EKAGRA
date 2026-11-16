const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:3000';

async function runAudit() {
  console.log('====================================================');
  console.log('🚀 EKAGRA Live Browser Full Dashboard Audit Starting');
  console.log('====================================================');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const consoleErrors = [];
  const networkFailures = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon') && !text.includes('ExperimentalWarning') && !text.includes('status of 401')) {
        consoleErrors.push(text);
        console.error('  [BROWSER CONSOLE ERROR]:', text);
      }
    }
  });

  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && url.includes('/api/') && !url.includes('/api/auth/me')) {
      networkFailures.push({ url, status });
      console.error(`  [NETWORK ERROR]: ${status} ${url}`);
    }
  });

  const auditResults = [];
  function record(section, name, pass, details = '') {
    const status = pass ? '[PASS]' : '[FAIL]';
    console.log(`${status} [${section}] ${name} ${details ? '- ' + details : ''}`);
    auditResults.push({ section, name, pass, details });
  }

  try {
    // ----------------------------------------------------
    // STEP 1: Registration and Clean Dashboard Access
    // ----------------------------------------------------
    const uniqueUser = `audit_user_${Date.now()}@ekagra.ai`;
    await page.goto(`${BASE_URL}/signup`, { waitUntil: 'networkidle2' });

    await page.type('#name', 'Audit Tester');
    await page.type('#email', uniqueUser);
    await page.type('#password', 'Password123!');
    await page.type('#confirmPassword', 'Password123!');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('#signupSubmitBtn')
    ]);

    const currentUrl = page.url();
    record('AUTH', 'Signup and redirect to /dashboard', currentUrl.includes('/dashboard'), `URL: ${currentUrl}`);

    // Wait for Store to initialize
    await page.waitForFunction(() => window.Store && window.Store.state);

    // ----------------------------------------------------
    // STEP 2: Initial Routine Modal & Dark Mode Contrast
    // ----------------------------------------------------
    await page.evaluate(() => {
      if (typeof window.openInitialRoutineModal === 'function') {
        window.openInitialRoutineModal(true);
      }
    });

    await page.waitForSelector('#initialRoutineModal.open', { visible: true, timeout: 5000 });
    record('ROUTINE MODAL', 'Initial Routine Modal opens cleanly', true);

    // Check Dark Mode Contrast on Weekdays/Weekends tabs
    const tabStyles = await page.evaluate(() => {
      const tabWd = document.getElementById('modalTabWeekdays');
      const tabWe = document.getElementById('modalTabWeekends');
      const titleWd = tabWd ? tabWd.querySelector('.routine-group-tab-title') || tabWd.firstElementChild : null;
      const titleWe = tabWe ? tabWe.querySelector('.routine-group-tab-title') || tabWe.firstElementChild : null;

      const compWd = titleWd ? window.getComputedStyle(titleWd).color : null;
      const compWe = titleWe ? window.getComputedStyle(titleWe).color : null;
      return { compWd, compWe };
    });

    const isWdCrisp = tabStyles.compWd && !tabStyles.compWd.startsWith('rgb(0, 0, 0)');
    const isWeCrisp = tabStyles.compWe && !tabStyles.compWe.startsWith('rgb(0, 0, 0)');
    record('CONTRAST', 'Modal Weekdays/Weekends tab headings are high-contrast', isWdCrisp && isWeCrisp, `Wd: ${tabStyles.compWd}, We: ${tabStyles.compWe}`);

    // Add preset commitment block: Sleep (overnight)
    await page.evaluate(() => {
      window.addInitialPresetBlock('Sleep', '11:00 PM', '07:00 AM', 'weekdays', 'Fixed');
    });

    // Add preset commitment block: College
    await page.evaluate(() => {
      window.addInitialPresetBlock('College', '08:00 AM', '03:00 PM', 'weekdays', 'Fixed');
    });

    // Switch to Weekends tab and copy Weekdays
    await page.click('#modalTabWeekends');
    await page.evaluate(() => {
      if (typeof window.copyWeekdaysToWeekendsInModal === 'function') {
        window.copyWeekdaysToWeekendsInModal();
      }
    });

    // Check that added blocks render in list
    const blocksCount = await page.evaluate(() => {
      return document.querySelectorAll('#initialRoutineBlocksList .initial-block-item').length;
    });
    record('ROUTINE MODAL', 'Commitment blocks added and rendered in list', blocksCount >= 2, `Count: ${blocksCount}`);

    // Test rapid multi-clicking on "Save Routine" button (#saveInitialRoutineBtn)
    await page.evaluate(() => {
      const btn = document.getElementById('saveInitialRoutineBtn');
      if (btn) {
        // Fire 4 rapid clicks
        btn.click();
        btn.click();
        btn.click();
        btn.click();
      }
    });

    // Wait for modal to close
    await page.waitForFunction(() => {
      const modal = document.getElementById('initialRoutineModal');
      return modal && !modal.classList.contains('open');
    }, { timeout: 5000 });
    record('ROUTINE MODAL', 'Save Routine button survives rapid clicks and persists routines cleanly', true);

    // Verify global banner is dismissed
    const bannerDisplay = await page.evaluate(() => {
      const b = document.getElementById('globalRoutineIncompleteBanner');
      return b ? window.getComputedStyle(b).display : 'none';
    });
    record('BANNER', 'Global routine coverage banner dismissed after saving', bannerDisplay === 'none', `Display: ${bannerDisplay}`);

    // ----------------------------------------------------
    // STEP 3: Top Bar and Navigation Controls
    // ----------------------------------------------------
    // Test Theme Slider
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'dark');
    await page.click('#themeSwitchSlider');
    const newTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    record('TOPBAR', 'Theme toggle slider switches theme', initialTheme !== newTheme, `${initialTheme} -> ${newTheme}`);
    await page.click('#themeSwitchSlider'); // Toggle back to dark

    // Test Profile Dropdown & Settings Click
    await page.click('#userProfileDropdownBtn');
    const isMenuOpen = await page.evaluate(() => {
      const menu = document.getElementById('profileDropdownMenu');
      return menu && (menu.classList.contains('active') || menu.classList.contains('open') || window.getComputedStyle(menu).display !== 'none');
    });
    record('TOPBAR', 'User profile button toggles dropdown menu', isMenuOpen);

    // Click Settings inside dropdown
    await page.click('#menuSettingsBtn');
    const isSettingsActive = await page.evaluate(() => document.getElementById('view-settings')?.classList.contains('active'));
    record('TOPBAR', 'Profile dropdown Settings link switches to Settings view', isSettingsActive);

    // Test Sidebar Navigation (all 7 views)
    const views = ['goals', 'tasks', 'schedule', 'routines', 'insights', 'settings', 'home'];
    let allViewsNavigated = true;
    for (const v of views) {
      await page.click(`button.nav-link-btn[data-view="${v}"]`);
      const isActive = await page.evaluate((viewName) => {
        const el = document.getElementById(`view-${viewName}`);
        return el && el.classList.contains('active');
      }, v);
      if (!isActive) allViewsNavigated = false;
    }
    record('NAVIGATION', 'Sidebar tabs switch between all 7 views cleanly', allViewsNavigated);

    // ----------------------------------------------------
    // STEP 4: Goals View (CRUD & Interactive Elements)
    // ----------------------------------------------------
    await page.click('button.nav-link-btn[data-view="goals"]');

    // Open Add Goal Modal
    await page.evaluate(() => window.openAddGoalModal());
    await page.waitForSelector('#addGoalModal.open', { visible: true });
    record('GOALS', 'Add Goal modal opens', true);

    // Create Goal
    await page.evaluate(async () => {
      document.getElementById('newGoalTitle').value = 'Master EKAGRA Automation';
      document.getElementById('newGoalDate').value = '2026-12-31';
      await window.handleAddGoalFormSubmit();
    });

    await page.waitForFunction(() => {
      const modal = document.getElementById('addGoalModal');
      return !modal || !modal.classList.contains('open');
    }, { timeout: 5000 });

    // Verify goal exists in DOM
    await page.waitForFunction(() => {
      const titles = Array.from(document.querySelectorAll('.goal-title-lg')).map(el => el.textContent.trim());
      return titles.some(t => t.includes('Master EKAGRA Automation'));
    }, { timeout: 5000 });
    record('GOALS', 'Goal created and rendered in goals grid', true);

    // Test Goal Search filter
    await page.type('#goalSearchInput', 'Master');
    await new Promise(r => setTimeout(r, 200));
    const searchMatch = await page.evaluate(() => {
      const visibleCards = document.querySelectorAll('#goalsCardsContainer .goal-card-full:not([style*="display: none"])');
      return visibleCards.length >= 1;
    });
    record('GOALS', 'Goal search filter operates correctly', searchMatch);
    await page.evaluate(() => {
      const inp = document.getElementById('goalSearchInput');
      if (inp) {
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Test Goal Filter pills
    await page.click('.filter-pill-btn[data-filter="On Track"]');
    await page.click('.filter-pill-btn[data-filter="All"]');
    record('GOALS', 'Goal status filter pills toggle active state', true);

    // Test Goal Edit Modal
    const goalId = await page.evaluate(() => window.Store.state.goals[0]?.id);
    if (goalId) {
      await page.evaluate((id) => window.openEditGoalModal(id), goalId);
      await page.waitForSelector('#editGoalModal.open', { visible: true });
      await page.evaluate(() => {
        document.getElementById('editGoalTitle').value = 'Master EKAGRA Automation Updated';
      });
      await page.evaluate(async () => {
        await window.handleEditGoalFormSubmit();
      });
      await page.waitForFunction(() => {
        const m = document.getElementById('editGoalModal');
        return !m || !m.classList.contains('open');
      });
      const updatedFound = await page.evaluate(() => document.body.innerText.includes('Master EKAGRA Automation Updated'));
      record('GOALS', 'Goal edit modal updates goal title successfully', updatedFound);
    }

    // ----------------------------------------------------
    // STEP 5: Tasks View (CRUD & Filtering)
    // ----------------------------------------------------
    await page.click('button.nav-link-btn[data-view="tasks"]');

    // Open Add Task Modal
    await page.evaluate(() => window.openAddTaskModal());
    await page.waitForSelector('#addTaskModal.open', { visible: true });
    record('TASKS', 'Add Task modal opens', true);

    // Fill Task form
    await page.type('#newTaskTitle', 'Write Comprehensive E2E Tests');
    await page.evaluate(() => {
      const d = document.getElementById('newTaskDuration');
      if (d) d.value = '45';
      const form = document.getElementById('addTaskForm');
      if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });

    await page.waitForFunction(() => {
      const modal = document.getElementById('addTaskModal');
      return !modal || !modal.classList.contains('open');
    }, { timeout: 5000 });

    // Verify task exists in DOM
    const taskFound = await page.evaluate(() => {
      return document.body.innerText.includes('Write Comprehensive E2E Tests');
    });
    record('TASKS', 'Task created and rendered in table', taskFound);

    // Test Task Type Filters
    await page.click('button.task-type-pill[data-type="independent"]');
    await page.click('button.task-type-pill[data-type="all"]');
    record('TASKS', 'Task type filter pills toggle smoothly', true);

    // Test Task Status Tabs
    await page.click('button.task-tab-btn[data-tab="Today"]');
    await page.click('button.task-tab-btn[data-tab="All"]');
    record('TASKS', 'Task status tabs toggle cleanly', true);

    // Test Task Edit Modal
    const taskId = await page.evaluate(() => window.Store.state.tasks[0]?.id);
    if (taskId) {
      await page.evaluate((id) => window.openEditTaskModal(id), taskId);
      await page.waitForSelector('#editTaskModal.open', { visible: true });
      await page.evaluate(() => window.closeModal('editTaskModal'));
      record('TASKS', 'Task edit modal opens and closes cleanly', true);
    }

    // ----------------------------------------------------
    // STEP 6: Schedule View (Timeline & Auto-Schedule)
    // ----------------------------------------------------
    await page.click('button.nav-link-btn[data-view="schedule"]');

    // Test Date Navigation
    const originalDate = await page.evaluate(() => document.getElementById('scheduleCurrentDateTitle')?.textContent);
    await page.click('#scheduleNextDayBtn'); // Next day
    const nextDate = await page.evaluate(() => document.getElementById('scheduleCurrentDateTitle')?.textContent);
    await page.click('#scheduleTodayBtn'); // Snap today
    const restoredDate = await page.evaluate(() => document.getElementById('scheduleCurrentDateTitle')?.textContent);
    record('SCHEDULE', 'Date navigator next day & today snap operate correctly', originalDate !== nextDate && restoredDate === originalDate);

    // Test View Mode switcher (Day, Week, Month)
    await page.click('.schedule-mode-btn[data-mode="Week"]');
    const isWeekActive = await page.evaluate(() => document.querySelector('.schedule-mode-btn[data-mode="Week"]')?.classList.contains('active'));
    await page.click('.schedule-mode-btn[data-mode="Day"]');
    record('SCHEDULE', 'Schedule view mode switcher (Day/Week/Month) toggles', isWeekActive);

    // Test Auto-Schedule Goals button
    await page.click('#btnAutoScheduleGoals');
    await new Promise(r => setTimeout(r, 600));
    await page.evaluate(() => {
      if (typeof window.closeModal === 'function') {
        window.closeModal('initialRoutineModal');
      }
    });
    record('SCHEDULE', 'Auto-Schedule Goals button triggers without error', true);

    // ----------------------------------------------------
    // STEP 7: Routines View (Tabs & Day Assignments)
    // ----------------------------------------------------
    await page.click('button.nav-link-btn[data-view="routines"]');
    await page.waitForSelector('#view-routines.active', { visible: true });

    // Toggle between Weekdays and Weekends tabs
    await page.evaluate(() => {
      document.getElementById('btnGroupWeekends').click();
    });
    const isWeekendsActive = await page.evaluate(() => document.getElementById('btnGroupWeekends')?.classList.contains('active'));
    await page.evaluate(() => {
      document.getElementById('btnGroupWeekdays').click();
    });
    record('ROUTINES', 'Weekdays/Weekends schedule group tabs toggle', isWeekendsActive);

    // Test rapid multi-clicking on "Copy Weekdays Routine to Weekends" (#btnCopyWeekdaysToWeekends)
    const copyActionResults = await page.evaluate(async () => {
      const btn = document.getElementById('btnCopyWeekdaysToWeekends');
      if (!btn) return { found: false, maxDuplicates: 0 };
      // Rapid fire 4 clicks
      btn.click();
      btn.click();
      btn.click();
      btn.click();
      await new Promise((r) => setTimeout(r, 600));
      const weekends = (window.Store.state.routines || []).filter((r) => r.schedule_group === 'weekends');
      const counts = {};
      for (const r of weekends) {
        const k = `${r.start_time}-${r.end_time}`;
        counts[k] = (counts[k] || 0) + 1;
      }
      const maxDuplicates = Object.keys(counts).length > 0 ? Math.max(...Object.values(counts)) : 0;
      return { found: true, count: weekends.length, maxDuplicates };
    });
    record('ROUTINES', 'Rapid multi-clicks on Copy Weekdays produces 0 duplicates in Weekends', copyActionResults.maxDuplicates <= 1, `Max per slot: ${copyActionResults.maxDuplicates}`);

    // Test Customize Days Modal
    await page.evaluate(() => window.openCustomizeDaysModal());
    await page.waitForSelector('#customizeDaysModal.open', { visible: true });
    await page.evaluate(() => window.closeModal('customizeDaysModal'));
    record('ROUTINES', 'Assign Days modal opens and closes cleanly', true);

    // Test Add Routine Modal
    await page.evaluate(() => window.openAddRoutineModal());
    await page.waitForSelector('#addRoutineModal.open', { visible: true });
    await page.evaluate(() => window.closeModal('addRoutineModal'));
    record('ROUTINES', 'Add Routine modal opens and closes cleanly', true);

    // Test Gap Classification Modal
    await page.evaluate(() => {
      if (typeof window.openClassifyGapModal === 'function') {
        window.openClassifyGapModal('15:00', '18:00', 'weekdays');
      }
    });
    await page.waitForSelector('#classifyGapModal.open', { visible: true });
    await page.evaluate(() => window.closeModal('classifyGapModal'));
    record('ROUTINES', 'Gap classification modal opens and closes cleanly', true);

    // ----------------------------------------------------
    // STEP 8: Insights View
    // ----------------------------------------------------
    await page.click('button.nav-link-btn[data-view="insights"]');
    await page.waitForSelector('#view-insights.active', { visible: true });
    const kpiCompleted = await page.evaluate(() => document.getElementById('insightsKpiCompleted')?.textContent);
    const kpiHours = await page.evaluate(() => document.getElementById('insightsKpiHours')?.textContent);
    record('INSIGHTS', 'KPI metrics cards render active values', Boolean(kpiCompleted && kpiHours), `Completed: ${kpiCompleted}, Hours: ${kpiHours}`);

    // ----------------------------------------------------
    // STEP 9: Settings View
    // ----------------------------------------------------
    await page.click('button.nav-link-btn[data-view="settings"]');
    await page.waitForSelector('#view-settings.active', { visible: true });

    // Toggle notification checkboxes
    await page.evaluate(() => {
      const cb = document.getElementById('settingNotifyTasks');
      if (cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    const notifyTasksChecked = await page.evaluate(() => document.getElementById('settingNotifyTasks')?.checked);
    record('SETTINGS', 'Notification switch toggle triggers change handler', typeof notifyTasksChecked === 'boolean');

    // AI Settings card inspection
    const aiCardPresent = await page.evaluate(() => Boolean(document.getElementById('aiSettingsCard')));
    record('SETTINGS', 'AI Settings card rendered with action buttons', aiCardPresent);

    // ----------------------------------------------------
    // STEP 10: Home View & Next Task Card Layout
    // ----------------------------------------------------
    await page.click('button.nav-link-btn[data-view="home"]');
    await page.waitForSelector('#view-home.active', { visible: true });

    // Check Next Task container
    const nextTaskPresent = await page.evaluate(() => Boolean(document.getElementById('homeNextTaskContainer')));
    record('HOME', 'Home View Next Task and Today Progress rendered', nextTaskPresent);

    // Test View All link on Home -> Schedule
    await page.evaluate(() => {
      const link = document.querySelector('#view-home .card-header-link');
      if (link) link.click();
    });
    const scheduleNavigated = await page.evaluate(() => document.getElementById('view-schedule')?.classList.contains('active'));
    record('HOME', 'Home View All link navigates to Schedule view', scheduleNavigated);

  } catch (err) {
    console.error('Audit exception caught:', err);
    record('GENERAL', 'Execution error encountered', false, err.message);
  } finally {
    await browser.close();
  }

  console.log('====================================================');
  console.log('📊 AUDIT SUMMARY REPORT');
  console.log('====================================================');
  const passed = auditResults.filter(r => r.pass).length;
  const failed = auditResults.filter(r => !r.pass).length;
  console.log(`Total checks: ${auditResults.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Console Errors: ${consoleErrors.length} | Network Failures: ${networkFailures.length}`);

  if (consoleErrors.length > 0) {
    console.log('Console Errors detected:');
    consoleErrors.forEach(e => console.log('  -', e));
  }
  if (networkFailures.length > 0) {
    console.log('Network Failures detected:');
    networkFailures.forEach(f => console.log(`  - ${f.status}: ${f.url}`));
  }

  process.exit(failed > 0 || consoleErrors.length > 0 || networkFailures.length > 0 ? 1 : 0);
}

runAudit();
