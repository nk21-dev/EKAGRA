/**
 * EKAGRA — Complete Multi-View Personal Execution Dashboard Engine
 * 
 * Features:
 * 1. Purposeful, High-Affordance Empty States (Day-0 Cold Start)
 * 2. Strict Authentication-Driven User Profile & Session Binding
 * 3. User-Scoped Data Isolation
 * 4. Production-Clean UI (No artificial demo seeding controls)
 * 5. Interactive Views: Home, Goals, Tasks, Schedule, Routines, Insights, Settings, Profile
 */

function formatLocalDateKey(input) {
  if (!input) return '';
  if (typeof input === 'string') {
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const d = (input instanceof Date) ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(input) {
  if (!input) return new Date();
  if (input instanceof Date) return input;
  if (typeof input === 'string') {
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), 12, 0, 0);
    }
  }
  const d = new Date(input);
  return isNaN(d.getTime()) ? new Date() : d;
}

function getLocalDateString(d = new Date()) {
  return formatLocalDateKey(d);
}

let scheduleFetchId = 0;

const activeActionLocks = new Set();

/**
 * Universal Action Lock for Mutation Buttons
 * - Prevents multiple clicks / race conditions across all views & modals
 * - Displays toast "Please wait — processing your previous request..." on duplicate click
 * - Disables the button, sets aria-busy="true", preserves original text/HTML, and sets loading label
 * - Restores button state on complete or error
 */
async function withActionLock(lockKey, buttonOrSelector, loadingLabel, asyncTask, customBusyMessage, options = {}) {
  if (activeActionLocks.has(lockKey)) {
    if (typeof showToast === 'function') {
      showToast(customBusyMessage || 'Please wait — processing your previous request...', 'info');
    }
    return;
  }

  activeActionLocks.add(lockKey);

  let btn = null;
  if (typeof buttonOrSelector === 'string') {
    btn = document.querySelector(buttonOrSelector);
  } else if (buttonOrSelector && buttonOrSelector.nodeType === 1) {
    btn = buttonOrSelector;
  }

  let originalHtml = null;
  let originalDisabled = false;
  const siblingBtns = [];
  const opts = (typeof options === 'object' && options !== null) ? options : {};

  if (btn) {
    originalHtml = btn.innerHTML;
    originalDisabled = btn.disabled;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('btn-action-locked');
    if (loadingLabel) {
      btn.innerHTML = `<span class="btn-spinner"></span> ${loadingLabel}`;
    }

    if (opts.disableSiblings && btn.parentElement) {
      const siblings = Array.from(btn.parentElement.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter((b) => b !== btn);
      siblings.forEach((s) => {
        siblingBtns.push({ el: s, origDisabled: s.disabled });
        s.disabled = true;
        s.setAttribute('aria-busy', 'true');
        s.classList.add('btn-action-locked');
      });
    }
  }

  try {
    return await asyncTask();
  } finally {
    activeActionLocks.delete(lockKey);
    if (btn) {
      btn.disabled = originalDisabled;
      btn.removeAttribute('aria-busy');
      btn.classList.remove('btn-action-locked');
      if (originalHtml !== null) {
        btn.innerHTML = originalHtml;
      }
    }
    siblingBtns.forEach(({ el, origDisabled }) => {
      el.disabled = origDisabled;
      el.removeAttribute('aria-busy');
      el.classList.remove('btn-action-locked');
    });
  }
}

window.withActionLock = withActionLock;

window.updateGlobalRoutineBanner = function (state) {
  const banner = document.getElementById('globalRoutineIncompleteBanner');
  if (!banner) return;

  // Automatically HIDE banner when user is on routines view OR when any modal is currently open
  const isRoutinesView = Boolean(state && state.currentView === 'routines');
  const isAnyModalOpen = Boolean(document.querySelector('.modal-backdrop-overlay.open'));
  if (isRoutinesView || isAnyModalOpen) {
    banner.style.display = 'none';
    return;
  }

  const isCovered = Boolean(state && state.is_routine_complete && !state.routine_coverage_incomplete);
  if (!isCovered) {
    banner.style.display = 'flex';
    const textEl = document.getElementById('globalRoutineBannerText');
    const btnEl = document.getElementById('globalRoutineBannerBtn');

    let msg = state ? state.routine_warning_message : null;
    let btnLabel = 'Complete Routine';
    const incompleteGroup = state?.incomplete_group || (state?.routine_coverage_status?.incomplete_group);

    if (incompleteGroup === 'weekends') {
      msg = "Weekends (Sat–Sun) routine incomplete — set up your 24h availability to enable auto-scheduling.";
      btnLabel = 'Setup Weekends';
    } else if (incompleteGroup === 'weekdays') {
      msg = "Weekdays (Mon–Fri) routine incomplete — set up your 24h availability to enable auto-scheduling.";
      btnLabel = 'Setup Weekdays';
    } else if (!msg) {
      msg = "24-Hour Routine Incomplete — Set up your 24-hour availability so EKAGRA can schedule your goals.";
      btnLabel = 'Complete Routine';
    }

    if (textEl) textEl.textContent = msg;
    if (btnEl) btnEl.textContent = btnLabel;
  } else {
    banner.style.display = 'none';
  }
};

window.copyWeekdaysToWeekends = async function () {
  const btn = document.getElementById('btnCopyWeekdaysToWeekends') || document.querySelector('[onclick="copyWeekdaysToWeekends()"]');
  return withActionLock('copyWeekdaysToWeekends', btn, 'Copying...', async () => {
    try {
      const res = await fetch('/api/routines/copy-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromGroup: 'weekdays', toGroup: 'weekends' })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to copy routine', 'error');
        return;
      }
      showToast(data.message || 'Copied weekdays routine to weekends!', 'success');
      if (data.routines) {
        Store.setState({
          routines: data.routines,
          routine_coverage_incomplete: data.coverage_status ? !data.coverage_status.is_routine_complete : false
        });
      } else {
        await Store.init();
      }
      if (Store.state.currentView === 'routines') {
        renderRoutines(Store.state);
      }
      window.updateGlobalRoutineBanner(Store.state);
    } catch (err) {
      console.error('Copy weekdays error:', err);
      showToast('Failed to copy weekdays routine.', 'error');
    }
  });
};

window.copyWeekdaysToWeekendsInModal = async function () {
  const weekdayBlocks = (typeof initialSetupBlocks !== 'undefined') ? initialSetupBlocks.filter((b) => b.schedule_group === 'weekdays') : [];
  if (weekdayBlocks.length > 0) {
    const nonWeekendBlocks = initialSetupBlocks.filter((b) => b.schedule_group !== 'weekends');
    const copiedWeekendBlocks = weekdayBlocks.map((b) => ({
      ...b,
      id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      schedule_group: 'weekends'
    }));
    initialSetupBlocks = [...nonWeekendBlocks, ...copiedWeekendBlocks];
    if (typeof window.switchModalRoutineGroup === 'function') {
      window.switchModalRoutineGroup('weekends');
    }
    showToast('Copied weekday routine to weekends in setup!', 'success');
  } else {
    await window.copyWeekdaysToWeekends();
    if (typeof window.openInitialRoutineModal === 'function') {
      window.openInitialRoutineModal(true);
    }
  }
};

function getInitialView() {
  const validViews = ['home', 'goals', 'tasks', 'schedule', 'routines', 'insights', 'settings', 'profile'];
  const rawHash = (window.location.hash || '').replace('#', '').toLowerCase().trim();
  if (rawHash && validViews.includes(rawHash)) {
    return rawHash;
  }
  return 'home';
}
window.getInitialView = getInitialView;

window.addEventListener('hashchange', () => {
  const targetView = getInitialView();
  if (Store.state && Store.state.currentView !== targetView && typeof switchView === 'function') {
    switchView(targetView);
  }
});

// Centralized Reactive State Store
const Store = {
  state: {
    user: { name: '', email: '' },
    isColdStart: true,
    currentView: 'home',
    goals: [],
    tasks: [],
    routines: [],
    metrics: {
      completedToday: 0,
      missedToday: 0,
      rescheduledToday: 0,
      streak: 0,
      focusHours: 0,
      totalCompletedTasks: 0
    },
    insights: [],
    insightsData: null,
    activities: [],
    // UI Filters
    goalFilter: 'All',
    goalSearch: '',
    taskTab: 'All',
    taskTypeFilter: 'all',
    taskSearch: '',
    scheduleDate: new Date(),
    scheduleViewMode: 'Day',
    routineFilter: 'Today',
    // Goals & Routine Schedule Group state
    expandedGoals: new Set(),
    activeRoutineGroup: 'weekdays',
    scheduleSettings: {
      weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      weekends_days: ['Saturday', 'Sunday'],
      routine_setup_status: 'pending'
    },
    editingDayAssignments: null,
    lastCreatedGoalId: null
  },

  isLoaded: false,
  listeners: [],

  subscribe(listener) {
    this.listeners.push(listener);
  },

  notify() {
    this.listeners.forEach((fn) => fn(this.state));
  },

  setState(partial) {
    this.state = { ...this.state, ...partial };
    this.notify();
    this.saveDebounced();
  },

  // Save state to backend database (bound strictly to authenticated session)
  saveTimer: null,
  saveDebounced() {
    if (!this.isLoaded) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await fetch('/api/dashboard/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goals: this.state.goals,
            tasks: this.state.tasks,
            routines: this.state.routines,
            metrics: this.state.metrics,
            insights: this.state.insights,
            activities: this.state.activities
          })
        });
      } catch (err) {
        console.error('Failed to persist dashboard state:', err);
      }
    }, 400);
  },

  // Stale-While-Revalidate: Instant synchronous cache hydration in < 10ms
  tryHydrateFromCache(targetUid = null) {
    try {
      const uid = targetUid || localStorage.getItem('ekagra_last_uid') || sessionStorage.getItem('ekagra_last_uid');
      if (!uid) return false;

      const raw = localStorage.getItem(`ekagra_cache_${uid}`) || sessionStorage.getItem(`ekagra_cache_${uid}`);
      if (!raw) return false;

      const cached = JSON.parse(raw);
      if (!cached || !cached.state || !cached.user || !cached.user.id) return false;

      // Hydrate state from cache, but always enforce initial view (defaults to 'home')
      const initialView = getInitialView();
      this.state = {
        ...this.state,
        ...cached.state,
        currentView: initialView,
        user: cached.user
      };
      this.isLoaded = true;

      // Fast synchronous paint
      renderTopBar(this.state);
      renderCurrentView(this.state);
      if (typeof window.updateGlobalRoutineBanner === 'function') {
        window.updateGlobalRoutineBanner(this.state);
      }
      return true;
    } catch (e) {
      console.warn('Failed to hydrate from cache:', e);
      return false;
    }
  },

  saveSnapshotToCache(userId, state) {
    try {
      if (!userId || !state) return;
      const snapshot = {
        timestamp: Date.now(),
        user: state.user,
        state: {
          user: state.user,
          isColdStart: Boolean(state.isColdStart),
          currentView: state.currentView || 'home',
          goals: state.goals || [],
          tasks: state.tasks || [],
          routines: state.routines || [],
          insightsData: state.insightsData || null,
          todaySchedule: state.todaySchedule || { blocks: [], routines: [] },
          routine_coverage_status: state.routine_coverage_status || null,
          routine_coverage_incomplete: Boolean(state.routine_coverage_incomplete),
          is_routine_complete: Boolean(state.is_routine_complete),
          incomplete_group: state.incomplete_group || null,
          routine_warning_message: state.routine_warning_message || null,
          scheduleSettings: state.scheduleSettings,
          metrics: state.metrics,
          insights: state.insights || [],
          activities: state.activities || [],
          user_preferences: state.user_preferences
        }
      };
      const serialized = JSON.stringify(snapshot);
      localStorage.setItem(`ekagra_cache_${userId}`, serialized);
      localStorage.setItem('ekagra_last_uid', String(userId));
      sessionStorage.setItem(`ekagra_cache_${userId}`, serialized);
      sessionStorage.setItem('ekagra_last_uid', String(userId));
    } catch (e) {
      console.warn('Failed to save snapshot to cache:', e);
    }
  },

  clearLocalCache() {
    try {
      const localKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('ekagra_cache_') || k === 'ekagra_last_uid')) {
          localKeys.push(k);
        }
      }
      localKeys.forEach((k) => localStorage.removeItem(k));

      const sessionKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('ekagra_cache_') || k === 'ekagra_last_uid')) {
          sessionKeys.push(k);
        }
      }
      sessionKeys.forEach((k) => sessionStorage.removeItem(k));
    } catch (e) { }
  },

  // Load initial data from unified bootstrap endpoint
  async init() {
    renderCurrentDateAndGreeting();
    const initialView = getInitialView();
    this.state.currentView = initialView;

    const cachedUid = localStorage.getItem('ekagra_last_uid') || sessionStorage.getItem('ekagra_last_uid');
    let hasHydratedFromCache = false;
    if (cachedUid) {
      hasHydratedFromCache = this.tryHydrateFromCache(cachedUid);
    }

    try {
      // 1 single round-trip bootstrap call
      const res = await fetch('/api/dashboard/bootstrap');
      if (res.status === 401 || !res.ok) {
        this.clearLocalCache();
        window.location.replace('/login');
        return;
      }

      const bootstrap = await res.json();
      if (!bootstrap || !bootstrap.user) {
        this.clearLocalCache();
        window.location.replace('/login');
        return;
      }

      // Check if user changed from cached user
      if (cachedUid && String(cachedUid) !== String(bootstrap.user.id)) {
        this.clearLocalCache();
      }

      const activeUser = {
        name: bootstrap.user.displayName || bootstrap.user.name || 'User',
        email: bootstrap.user.email || '',
        id: bootstrap.user.id,
        created_at: bootstrap.user.created_at
      };

      const dashData = bootstrap.dashboardData || {};
      const todayScheduleData = bootstrap.todaySchedule || {};
      const insightsDataPayload = bootstrap.insightsData || null;

      const rawTasks = Array.isArray(dashData.tasks) ? dashData.tasks : [];
      const rawGoals = Array.isArray(dashData.goals) ? dashData.goals : [];
      const initializedGoals = rawGoals.map((g) => ({
        ...g,
        health: g.health || calculateGoalHealth(g),
        deadline: g.target_date || g.deadline,
        tasks: Array.isArray(g.tasks) ? g.tasks : rawTasks.filter((t) => t.goal_id === g.id || t.goalId === g.id)
      }));

      const isCold = Boolean(dashData.isColdStart || (!initializedGoals.length && !rawTasks.length));
      const covStatus = todayScheduleData.routine_coverage_status || dashData.routine_coverage_status || null;

      this.state = {
        ...this.state,
        currentView: this.state.currentView || initialView,
        user: activeUser,
        isColdStart: isCold,
        goals: initializedGoals,
        tasks: rawTasks,
        routines: Array.isArray(dashData.routines) ? dashData.routines : [],
        insightsData: insightsDataPayload,
        todaySchedule: {
          blocks: todayScheduleData.blocks || [],
          routines: todayScheduleData.routines || [],
          coverageStatus: covStatus,
          next_task: todayScheduleData.next_task || null
        },
        routine_coverage_status: covStatus,
        routine_coverage_incomplete: covStatus ? covStatus.routine_coverage_incomplete : Boolean(dashData.routine_coverage_incomplete),
        is_routine_complete: covStatus ? covStatus.is_routine_complete : Boolean(dashData.is_routine_complete),
        incomplete_group: covStatus ? covStatus.incomplete_group : (dashData.incomplete_group || null),
        routine_warning_message: covStatus ? covStatus.message : (dashData.routine_warning_message || null),
        scheduleSettings: dashData.schedule_settings || {
          weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          weekends_days: ['Saturday', 'Sunday'],
          routine_setup_status: 'pending'
        },
        metrics: dashData.metrics || {
          completedToday: 0,
          missedToday: 0,
          rescheduledToday: 0,
          streak: 0,
          focusHours: 0,
          totalCompletedTasks: 0
        },
        insights: Array.isArray(dashData.insights) ? dashData.insights : [],
        activities: Array.isArray(dashData.activities) ? dashData.activities : [],
        user_preferences: dashData.preferences || dashData.user_preferences || { notify_tasks: true, notify_goals: true, notify_weekly: true }
      };

      this.isLoaded = true;

      // Persist fresh snapshot to cache for instant sub-10ms loads on future refreshes
      this.saveSnapshotToCache(activeUser.id, this.state);

      // Smooth re-render: preserve open modals and active input focus
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && ['INPUT', 'TEXTAREA'].includes(activeEl.tagName);
      const isModalOpen = Boolean(document.querySelector('.modal-backdrop-overlay.active'));

      renderTopBar(this.state);
      if (!isModalOpen && !isInputFocused) {
        renderCurrentView(this.state);
      } else {
        if (typeof window.updateGlobalRoutineBanner === 'function') {
          window.updateGlobalRoutineBanner(this.state);
        }
      }

      // Determine routine setup eligibility from authoritative backend status & routine configuration
      const needsSetup = Boolean(
        dashData.needs_routine_setup ||
        this.state.scheduleSettings?.needs_routine_setup ||
        !dashData.has_valid_routine_setup ||
        (Array.isArray(this.state.routines) && this.state.routines.length === 0)
      );

      if (needsSetup) {
        const sessionDismissed = sessionStorage.getItem('ekagra_routine_dismissed_session') === 'true';
        if (!sessionDismissed) {
          setTimeout(() => {
            if (typeof window.openInitialRoutineModal === 'function') {
              window.openInitialRoutineModal();
            }
          }, 350);
        }
      }
    } catch (err) {
      console.error('Failed to initialize dashboard store:', err);
      // Fallback: If network failed but cache hydrated, keep cached data! Otherwise safe cold state
      if (!hasHydratedFromCache) {
        this.isLoaded = true;
        this.state = {
          ...this.state,
          user: this.state.user && this.state.user.name ? this.state.user : { name: 'User', email: '' },
          isColdStart: true,
          goals: [],
          tasks: [],
          routines: [],
          metrics: {
            completedToday: 0,
            missedToday: 0,
            rescheduledToday: 0,
            streak: 0,
            focusHours: 0,
            totalCompletedTasks: 0
          },
          insights: [],
          activities: []
        };
        this.notify();
      }
    }
  },

  async loadTodaySchedule() {
    try {
      const res = await fetch('/api/schedule?date=today');
      if (res.ok) {
        const data = await res.json();
        const covStatus = data.routine_coverage_status || null;
        this.setState({
          todaySchedule: {
            blocks: data.blocks || [],
            routines: data.routines || [],
            coverageStatus: covStatus
          },
          routine_coverage_status: covStatus || this.state.routine_coverage_status,
          is_routine_complete: covStatus ? covStatus.is_routine_complete : this.state.is_routine_complete,
          routine_coverage_incomplete: covStatus ? covStatus.routine_coverage_incomplete : this.state.routine_coverage_incomplete,
          incomplete_group: covStatus ? covStatus.incomplete_group : this.state.incomplete_group,
          routine_warning_message: covStatus ? covStatus.message : this.state.routine_warning_message
        });
        if (typeof window.updateGlobalRoutineBanner === 'function') {
          window.updateGlobalRoutineBanner(this.state);
        }
      }
    } catch (e) {
      console.warn('loadTodaySchedule error:', e);
    }
  },

  async loadInsights() {
    try {
      const res = await fetch('/api/insights');
      if (res.ok) {
        const data = await res.json();
        this.setState({ insightsData: data });
      }
    } catch (e) {
      console.warn('loadInsights error:', e);
    }
  }
};
window.Store = Store;

// ==========================================================================
// Bootstrapping & View Router
// ==========================================================================

function renderDashboardSkeletons() {
  const nextTaskBox = document.getElementById('homeNextTaskContainer');
  if (nextTaskBox && !nextTaskBox.innerHTML.trim()) {
    nextTaskBox.innerHTML = `
      <div class="skeleton-shimmer" style="height: 104px; margin-bottom: 14px;"></div>
      <div class="skeleton-row">
        <div class="skeleton-shimmer" style="height: 38px; flex: 1;"></div>
        <div class="skeleton-shimmer" style="height: 38px; width: 110px;"></div>
      </div>
    `;
  }

  const timelineBox = document.getElementById('homeTimelineList');
  if (timelineBox && !timelineBox.innerHTML.trim()) {
    timelineBox.innerHTML = `
      <div class="skeleton-shimmer" style="height: 48px; margin-bottom: 8px;"></div>
      <div class="skeleton-shimmer" style="height: 48px; margin-bottom: 8px;"></div>
      <div class="skeleton-shimmer" style="height: 48px;"></div>
    `;
  }

  const goalsOverview = document.getElementById('homeGoalsOverviewList');
  if (goalsOverview && !goalsOverview.innerHTML.trim()) {
    goalsOverview.innerHTML = `
      <div class="skeleton-shimmer" style="height: 46px; margin-bottom: 8px;"></div>
      <div class="skeleton-shimmer" style="height: 46px;"></div>
    `;
  }

  const insightsFeed = document.getElementById('homeInsightsFeed');
  if (insightsFeed && !insightsFeed.innerHTML.trim()) {
    insightsFeed.innerHTML = `
      <div class="skeleton-shimmer" style="height: 64px; margin-bottom: 8px;"></div>
      <div class="skeleton-shimmer" style="height: 64px;"></div>
    `;
  }

  const activityFeed = document.getElementById('homeActivityFeed');
  if (activityFeed && !activityFeed.innerHTML.trim()) {
    activityFeed.innerHTML = `
      <div class="skeleton-shimmer" style="height: 36px; margin-bottom: 8px;"></div>
      <div class="skeleton-shimmer" style="height: 36px;"></div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderCurrentDateAndGreeting();
  initTheme();
  initSidebarRouter();
  initTopBar();
  initModals();
  initDeveloperConsole();

  // 1. Instant Stale-While-Revalidate Hydration (< 10ms paint)
  const hasHydrated = Store.tryHydrateFromCache();

  // If no cache exists (first ever visit or fresh incognito), show subtle shimmer skeletons
  if (!hasHydrated) {
    renderTopBar(Store.state);
    renderDashboardSkeletons();
  }

  // Subscribe UI renders to state changes
  Store.subscribe((state) => {
    renderTopBar(state);
    renderCurrentView(state);
    if (typeof window.updateGlobalRoutineBanner === 'function') {
      window.updateGlobalRoutineBanner(state);
    }
  });

  // Load backend state (revalidation in parallel)
  Store.init();
});

// Dual Theme Manager
function initTheme() {
  const savedTheme = localStorage.getItem('ekagra_theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

  setTheme(initialTheme);

  const toggleBtn = document.getElementById('themeSwitchSlider');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
      localStorage.setItem('ekagra_theme', next);
    });
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const themeBoxes = document.querySelectorAll('.theme-choice-box');
  themeBoxes.forEach((box) => {
    box.classList.toggle('active', box.getAttribute('data-theme-choice') === theme);
  });
}
window.setTheme = setTheme;

// Sidebar Navigation
function initSidebarRouter() {
  const navBtns = document.querySelectorAll('.nav-link-btn');
  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetView = btn.getAttribute('data-view');
      switchView(targetView);
    });
  });
}

function switchView(viewName) {
  Store.setState({ currentView: viewName });

  // Update active sidebar pill
  document.querySelectorAll('.nav-link-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });

  // Update active view section
  document.querySelectorAll('.dashboard-view').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });

  if (viewName === 'goals') {
    Store.state.goalFilter = 'All';
    Store.state.goalSearch = '';
    document.querySelectorAll('.goals-filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === 'All');
    });
    const searchInput = document.getElementById('goalSearchInput') || document.querySelector('#view-goals .search-field');
    if (searchInput) searchInput.value = '';
  }

  if (viewName === 'tasks') {
    Store.state.taskSearch = '';
    const searchInput = document.getElementById('taskSearchInput') || document.querySelector('#view-tasks .search-field');
    if (searchInput) searchInput.value = '';
  }

  if (viewName === 'settings' && typeof window.loadAiSettingsIntoSettingsPage === 'function') {
    window.loadAiSettingsIntoSettingsPage();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.switchView = switchView;

// Global Top Bar (Dynamic Authentication Binding)
function initTopBar() {
  const userBtn = document.getElementById('userProfileDropdownBtn');
  const dropdownMenu = document.getElementById('profileDropdownMenu');

  if (userBtn && dropdownMenu) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownMenu.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      dropdownMenu.classList.remove('show');
    });
  }

  // Dropdown actions
  const menuProfile = document.getElementById('menuProfileBtn');
  if (menuProfile) {
    menuProfile.addEventListener('click', () => switchView('profile'));
  }

  const menuSettings = document.getElementById('menuSettingsBtn');
  if (menuSettings) {
    menuSettings.addEventListener('click', () => switchView('settings'));
  }

  const menuSignout = document.getElementById('menuSignoutBtn');
  if (menuSignout) {
    menuSignout.addEventListener('click', async () => {
      Store.clearLocalCache();
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
      } catch (e) { }
      window.location.replace('/login');
    });
  }
}

function renderCurrentDateAndGreeting() {
  const hour = new Date().getHours();
  let timeGreeting = 'Good Morning';
  let emoji = '☀️';
  if (hour >= 12 && hour < 17) {
    timeGreeting = 'Good Afternoon';
    emoji = '🌤️';
  } else if (hour >= 17) {
    timeGreeting = 'Good Evening';
    emoji = '🌙';
  }

  const titleEl = document.getElementById('topbarGreetingTitle');
  if (titleEl && (!titleEl.dataset.hasUser || !titleEl.textContent.includes(','))) {
    titleEl.textContent = `${timeGreeting} ${emoji}`;
  }

  const dateEl = document.getElementById('topbarDateText');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }
}

function renderTopBar(state) {
  const user = state.user || {};
  const userName = user.name || 'User';

  const hour = new Date().getHours();
  let timeGreeting = 'Good Morning';
  let emoji = '☀️';
  if (hour >= 12 && hour < 17) {
    timeGreeting = 'Good Afternoon';
    emoji = '🌤️';
  } else if (hour >= 17) {
    timeGreeting = 'Good Evening';
    emoji = '🌙';
  }

  const titleEl = document.getElementById('topbarGreetingTitle');
  if (titleEl) {
    titleEl.dataset.hasUser = 'true';
    titleEl.innerHTML = `${timeGreeting}, ${escapeHtml(userName)} ${emoji}`;
  }

  const dateEl = document.getElementById('topbarDateText');
  if (dateEl) {
    const now = new Date();
    const formatted = now.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    dateEl.textContent = formatted;
  }

  const avatarEl = document.getElementById('topbarAvatarInitial');
  if (avatarEl) {
    avatarEl.textContent = userName.charAt(0).toUpperCase();
  }

  const badgeNameEl = document.getElementById('topbarUserName');
  if (badgeNameEl) {
    badgeNameEl.textContent = userName;
  }
}

// Master View Dispatcher
function renderCurrentView(state) {
  const view = state.currentView || 'home';

  // Ensure active view section matches state.currentView so sections are never desynchronized
  document.querySelectorAll('.dashboard-view').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${view}`);
  });

  // Ensure active sidebar pill matches state.currentView
  document.querySelectorAll('.nav-link-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
  });

  if (view === 'home') renderHome(state);
  else if (view === 'goals') renderGoals(state);
  else if (view === 'tasks') renderTasks(state);
  else if (view === 'schedule') renderSchedule(state);
  else if (view === 'routines') renderRoutines(state);
  else if (view === 'insights') renderInsights(state);
  else if (view === 'settings') renderSettings(state);
  else if (view === 'profile') renderProfile(state);
}

// ==========================================================================
// View 1: Dashboard Home (Collage Screen 1 & 11)
// Purposeful Empty States Implementation (No Gaping Voids)
// ==========================================================================

let isTaskActionInFlight = false;
let activeCheckInTask = null;

window.openQuickCheckInModal = function (taskId) {
  let task = (Store.state.tasks || []).find((t) => t.id === taskId);
  let block = null;
  if (Store.state.todaySchedule && Array.isArray(Store.state.todaySchedule.blocks)) {
    block = Store.state.todaySchedule.blocks.find((b) => b.task_id === taskId);
  }

  const title = (task && task.title) ? task.title : ((block && block.task_title) ? block.task_title : 'Focus Task');
  const estMinutes = (block && block.allocated_minutes)
    ? block.allocated_minutes
    : ((task && task.duration_minutes) ? task.duration_minutes : 30);

  activeCheckInTask = {
    taskId,
    title,
    estMinutes
  };

  const titleEl = document.getElementById('quickCheckInTaskTitle');
  if (titleEl) titleEl.textContent = title;

  const promptEl = document.getElementById('quickCheckInPrompt');
  if (promptEl) {
    promptEl.innerHTML = `Estimated: <strong style="color: var(--text-primary); font-weight: 700;">${estMinutes} min</strong> — How long did it actually take?`;
  }

  const inputEl = document.getElementById('quickCheckInMinutesInput');
  if (inputEl) {
    inputEl.value = estMinutes;
  }

  // Quick 1-tap chips: [-15m] [-5m] [Same (XXm)] [+15m] [+30m]
  const chipsContainer = document.getElementById('quickCheckInChipsContainer');
  if (chipsContainer) {
    const chips = [
      { label: '-15m', val: Math.max(1, estMinutes - 15) },
      { label: '-5m', val: Math.max(1, estMinutes - 5) },
      { label: `Same (${estMinutes}m)`, val: estMinutes, isDefault: true },
      { label: '+15m', val: estMinutes + 15 },
      { label: '+30m', val: estMinutes + 30 }
    ];

    chipsContainer.innerHTML = chips.map((c) => `
      <button type="button" class="quick-chip-btn ${c.isDefault ? 'active' : ''}" data-val="${c.val}" onclick="selectQuickCheckInChip(${c.val}, this)">
        ${escapeHtml(c.label)}
      </button>
    `).join('');
  }

  const confirmBtn = document.getElementById('quickCheckInConfirmBtn');
  const skipBtn = document.getElementById('quickCheckInSkipBtn');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.removeAttribute('aria-busy');
    confirmBtn.classList.remove('btn-action-locked');
  }
  if (skipBtn) {
    skipBtn.disabled = false;
    skipBtn.removeAttribute('aria-busy');
    skipBtn.classList.remove('btn-action-locked');
  }

  window.openModal('quickCheckInModal');
  setTimeout(() => {
    inputEl?.focus();
    inputEl?.select();
  }, 100);
};

window.selectQuickCheckInChip = function (val, chipEl) {
  const inputEl = document.getElementById('quickCheckInMinutesInput');
  if (inputEl) {
    inputEl.value = Math.max(1, parseInt(val, 10));
  }
  document.querySelectorAll('#quickCheckInChipsContainer .quick-chip-btn').forEach((btn) => {
    btn.classList.remove('active');
  });
  if (chipEl) chipEl.classList.add('active');
};

window.onQuickCheckInInputChange = function () {
  const inputEl = document.getElementById('quickCheckInMinutesInput');
  const curVal = parseInt(inputEl?.value, 10);
  document.querySelectorAll('#quickCheckInChipsContainer .quick-chip-btn').forEach((btn) => {
    const bVal = parseInt(btn.getAttribute('data-val'), 10);
    btn.classList.toggle('active', bVal === curVal);
  });
};

window.submitQuickCheckIn = async function(isVerified, btnEl) {
  if (!activeCheckInTask) return;
  const taskId = activeCheckInTask.taskId;
  const estMins = activeCheckInTask.estMinutes;
  const inputEl = document.getElementById('quickCheckInMinutesInput');
  const actualMinutes = isVerified ? Math.max(1, parseInt(inputEl?.value, 10) || estMins) : estMins;

  const confirmBtn = document.getElementById('quickCheckInConfirmBtn');
  const skipBtn = document.getElementById('quickCheckInSkipBtn');
  const clickedBtn = (btnEl && btnEl.nodeType === 1) ? btnEl : (isVerified ? confirmBtn : skipBtn);

  return withActionLock('submitQuickCheckIn', clickedBtn, 'Completing...', async () => {
    const otherBtn = clickedBtn === confirmBtn ? skipBtn : confirmBtn;
    if (otherBtn) {
      otherBtn.disabled = true;
      otherBtn.classList.add('btn-action-locked');
    }
    try {
      const success = await window.handleHomeCompleteNextTask(taskId, actualMinutes, Boolean(isVerified));
      if (success !== false) {
        window.closeModal('quickCheckInModal');
        activeCheckInTask = null;
      }
    } finally {
      if (otherBtn) {
        otherBtn.disabled = false;
        otherBtn.classList.remove('btn-action-locked');
      }
    }
  }, 'Please wait — still processing...', { disableSiblings: true });
};

window.handleTaskCheckboxClick = function(taskId, goalId, el) {
  const task = (Store.state.tasks || []).find((t) => t.id === taskId);
  if (task && (task.completed === 1 || task.completed === true)) {
    // Unchecking: directly toggle off
    window.toggleTaskCompletion(taskId, goalId, el);
  } else {
    // Checking: open the Quick Execution Check-In modal!
    window.openQuickCheckInModal(taskId);
  }
};

window.handleHomeCompleteNextTask = async function (taskId, actualMinutes = null, durationVerified = true) {
  return withActionLock('task_action_' + taskId, null, null, async () => {
    if (isTaskActionInFlight) return false;
    isTaskActionInFlight = true;
    try {
      const payload = { taskId };
      if (actualMinutes !== null && actualMinutes !== undefined) {
        payload.actualMinutes = actualMinutes;
        payload.duration_verified = Boolean(durationVerified);
      }
      const res = await fetch('/api/schedule/complete-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Task marked completed! Pace calibrated.', 'success');
        await Store.loadTodaySchedule();
        await Store.init();
        if (Store.state.currentView === 'home') renderHome(Store.state);
        if (Store.state.currentView === 'schedule') renderSchedule(Store.state);
        if (Store.state.currentView === 'insights') renderInsights(Store.state);
        if (Store.state.currentView === 'goals') renderGoals(Store.state);
        if (Store.state.currentView === 'tasks') renderTasks(Store.state);
        return true;
      } else {
        showToast(data.error || 'Failed to complete task.', 'error');
        return false;
      }
    } catch (err) {
      showToast('Failed to complete task.', 'error');
      return false;
    } finally {
      isTaskActionInFlight = false;
    }
  }, 'Please wait — still processing...');
};

window.handleHomeRescheduleNextTask = async function(taskId, btnEl) {
  const btn = (btnEl && btnEl.nodeType === 1) ? btnEl : document.querySelector(`[onclick*="handleHomeRescheduleNextTask('${taskId}')"], [onclick*="rescheduleScheduledBlock('${taskId}')"]`);
  return withActionLock('task_action_' + taskId, btn, 'Rescheduling...', async () => {
    if (isTaskActionInFlight) return;
    isTaskActionInFlight = true;
    try {
      const res = await fetch('/api/schedule/reschedule-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const targetDate = data.scheduled_date || data.date;
        const targetTime = (typeof formatTime12Hour === 'function' && data.start_time) ? formatTime12Hour(data.start_time) : (data.start_time || '');
        showToast(`Task rescheduled for ${targetDate}${targetTime ? ' at ' + targetTime : ''}.`, 'success');
        await Store.loadTodaySchedule();
        await Store.init();
        if (Store.state.currentView === 'home') renderHome(Store.state);
        if (Store.state.currentView === 'schedule') renderSchedule(Store.state);
        if (Store.state.currentView === 'insights') renderInsights(Store.state);
        if (Store.state.currentView === 'goals') renderGoals(Store.state);
        if (Store.state.currentView === 'tasks') renderTasks(Store.state);
      } else {
        showToast(data.error || 'Failed to reschedule task', 'error');
      }
    } catch (err) {
      showToast('Failed to reschedule task', 'error');
    } finally {
      isTaskActionInFlight = false;
    }
  }, 'Please wait — still processing...', { disableSiblings: true });
};

function renderHome(state) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const goals = Array.isArray(state.goals) ? state.goals : [];
  const scheduledBlocks = (state.todaySchedule && Array.isArray(state.todaySchedule.blocks))
    ? state.todaySchedule.blocks.filter((b) => b.status === 'scheduled' || b.status === 'completed')
    : [];
  const hasScheduledBlocks = scheduledBlocks.length > 0;
  const isCold = Boolean(state.isColdStart || (!goals.length && !tasks.length));

  // 1. Today's Progress Card
  let totalTasks = 0;
  let completedCount = 0;
  if (hasScheduledBlocks) {
    totalTasks = scheduledBlocks.length;
    completedCount = scheduledBlocks.filter((b) => b.status === 'completed' || b.task_completed).length;
  } else {
    totalTasks = tasks.length;
    completedCount = tasks.filter((t) => t.completed).length;
  }
  const pct = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  const countEl = document.getElementById('homeProgressTaskCount');
  const pctEl = document.getElementById('homeProgressPct');
  const barEl = document.getElementById('homeProgressBarFill');
  const trackEl = barEl ? barEl.parentElement : null;

  if (isCold || totalTasks === 0) {
    if (countEl) countEl.textContent = '0 / 0 tasks';
    if (pctEl) pctEl.textContent = '0%';
    if (trackEl) trackEl.className = 'meter-track empty-dashed';
    if (barEl) barEl.style.width = '0%';
  } else {
    if (countEl) countEl.textContent = `${completedCount} / ${totalTasks} tasks`;
    if (pctEl) pctEl.textContent = `${pct}%`;
    if (trackEl) trackEl.className = 'meter-track';
    if (barEl) barEl.style.width = `${pct}%`;
  }

  const numCompleted = document.getElementById('homeStatCompleted');
  const numMissed = document.getElementById('homeStatMissed');
  const numRescheduled = document.getElementById('homeStatRescheduled');

  const metrics = state.metrics || {};
  if (numCompleted) numCompleted.textContent = isCold ? 0 : completedCount;
  if (numMissed) numMissed.textContent = isCold ? 0 : (metrics.missedToday || 0);
  if (numRescheduled) numRescheduled.textContent = isCold ? 0 : (metrics.rescheduledToday || 0);

  const progressGuidanceEl = document.getElementById('homeProgressGuidance');
  if (progressGuidanceEl) {
    if (isCold || totalTasks === 0) {
      progressGuidanceEl.textContent = "No tasks scheduled for today";
    } else if (hasScheduledBlocks && completedCount === totalTasks) {
      progressGuidanceEl.textContent = "All scheduled focus blocks completed for today! 🎉";
    } else {
      progressGuidanceEl.textContent = "";
    }
  }

  // 2. Next Task (Do First) Card - Strictly ✓ Complete and ↻ Reschedule at the bottom
  const nextTaskBox = document.getElementById('homeNextTaskContainer');
  const incompleteScheduledBlocks = scheduledBlocks.filter((b) => b.status === 'scheduled' && !b.task_completed && !b.completed);

  if (nextTaskBox) {
    if (hasScheduledBlocks && incompleteScheduledBlocks.length > 0) {
      // Show first incomplete scheduled task as #1 DO FIRST
      const nextBlock = incompleteScheduledBlocks[0];
      const isGoalTask = Boolean(nextBlock.goal_id || nextBlock.goalId);
      const nextGoal = isGoalTask
        ? goals.find((g) => g.id === nextBlock.goal_id || g.id === nextBlock.goalId)
        : null;
      const rawGoalTitle = isGoalTask
        ? ((nextBlock.goal_title && nextBlock.goal_title !== 'Personal')
          ? nextBlock.goal_title
          : (nextGoal ? (nextGoal.title || nextGoal.name) : (nextBlock.goal_title || 'Goal Task')))
        : null;
      const goalName = rawGoalTitle ? escapeHtml(rawGoalTitle) : '';
      const rawGoalPrio = isGoalTask ? (nextBlock.goal_priority || (nextGoal && nextGoal.priority)) : null;
      const goalPriorityText = rawGoalPrio ? ` · ${escapeHtml(rawGoalPrio)} Priority` : '';
      const durationMins = nextBlock.allocated_minutes || nextBlock.task_duration || 30;
      const timeWindow = `${formatTime12Hour(nextBlock.start_time)} – ${formatTime12Hour(nextBlock.end_time)}`;
      const reasonTag = isGoalTask
        ? ((nextBlock.goal_priority === 'High' || (nextGoal && nextGoal.priority === 'High'))
          ? 'Highest Priority + Peak Focus Slot'
          : (nextBlock.task_due_date ? 'Urgent Due Date Slot' : 'Priority Focus Slot'))
        : (nextBlock.task_due_date ? 'Urgent Independent Slot' : 'Priority Focus Slot');

      const goalBadgeHtml = isGoalTask
        ? `<span class="category-pill pill-goal" style="font-size: 0.74rem;">🎯 ${goalName}${goalPriorityText}</span>`
        : `<span class="category-pill pill-independent" style="font-size: 0.74rem;">📌 Independent</span>`;

      nextTaskBox.innerHTML = `
        <div class="next-task-details">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="rank-badge-first">#1 DO FIRST</span>
            <span style="font-size: 0.72rem; color: var(--brand-emerald); background: rgba(16, 185, 129, 0.1); padding: 2px 8px; border-radius: 6px; font-weight: 600;">
              ${reasonTag}
            </span>
          </div>
          <div class="next-task-title">${escapeHtml(nextBlock.task_title || 'Focus Task')}</div>
          <div class="next-task-badge" style="flex-wrap: wrap; gap: 8px; margin-top: 6px;">
            <span>⏰ ${timeWindow}</span>
            <span>•</span>
            <span>⏱️ ${durationMins} min</span>
            <span>•</span>
            ${goalBadgeHtml}
            <span class="priority-tag prio-${(nextBlock.task_priority || 'medium').toLowerCase()}" style="font-size: 0.72rem;">
              ${escapeHtml(nextBlock.task_priority || 'Medium')}
            </span>
          </div>
        </div>
        <div class="next-task-actions">
          <button type="button" class="btn-complete-task" onclick="openQuickCheckInModal('${nextBlock.task_id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Complete</span>
          </button>
          <button type="button" class="btn-reschedule-task" onclick="handleHomeRescheduleNextTask('${nextBlock.task_id}', this)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span>Reschedule</span>
          </button>
        </div>
      `;
    } else if (tasks.some((t) => !t.completed)) {
      // Tasks exist and at least one is incomplete - Clean rank badge and ONLY ✓ Complete and ↻ Reschedule
      const firstIncomp = tasks.find((t) => !t.completed);
      const isGoalTask = Boolean(firstIncomp.goal_id || firstIncomp.goalId);
      const parentGoal = isGoalTask
        ? goals.find((g) => g.id === firstIncomp.goal_id || g.id === firstIncomp.goalId)
        : null;
      const rawGoalTitle = isGoalTask
        ? ((firstIncomp.goal_title && firstIncomp.goal_title !== 'Personal')
          ? firstIncomp.goal_title
          : (parentGoal ? (parentGoal.title || parentGoal.name) : (firstIncomp.goal_title || 'Goal Task')))
        : null;
      const goalName = rawGoalTitle ? escapeHtml(rawGoalTitle) : '';
      const rawGoalPrio = isGoalTask ? (firstIncomp.goal_priority || (parentGoal && parentGoal.priority)) : null;
      const goalPriorityText = rawGoalPrio ? ` · ${escapeHtml(rawGoalPrio)} Priority` : '';
      const durationMins = firstIncomp.duration_minutes || firstIncomp.estimated_minutes || 30;

      const goalBadgeHtml = isGoalTask
        ? `<span class="category-pill pill-goal" style="font-size: 0.74rem;">🎯 ${goalName}${goalPriorityText}</span>`
        : `<span class="category-pill pill-independent" style="font-size: 0.74rem;">📌 Independent</span>`;

      nextTaskBox.innerHTML = `
        <div class="next-task-details">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span class="rank-badge-first" style="background: rgba(245, 158, 11, 0.15); color: #F59E0B; border-color: rgba(245, 158, 11, 0.3);">#1 (UNSCHEDULED)</span>
            <span style="font-size: 0.72rem; color: var(--text-muted);">Not scheduled yet</span>
          </div>
          <div class="next-task-title">${escapeHtml(firstIncomp.title)}</div>
          <div class="next-task-badge" style="flex-wrap: wrap; gap: 8px; margin-top: 6px;">
            <span>⏰ Not scheduled yet</span>
            <span>•</span>
            <span>⏱️ ${durationMins} min</span>
            <span>•</span>
            ${goalBadgeHtml}
            <span class="priority-tag prio-${(firstIncomp.priority || 'medium').toLowerCase()}" style="font-size: 0.72rem;">${escapeHtml(firstIncomp.priority || 'Medium')}</span>
          </div>
        </div>
        <div class="next-task-actions">
          <button type="button" class="btn-complete-task" onclick="openQuickCheckInModal('${firstIncomp.id}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Complete</span>
          </button>
          <button type="button" class="btn-reschedule-task" onclick="handleHomeRescheduleNextTask('${firstIncomp.id}', this)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span>Reschedule</span>
          </button>
        </div>
      `;
    } else if (tasks.length > 0 || hasScheduledBlocks) {
      // All tasks are completed! Celebration state (Never show completed task or action buttons)
      nextTaskBox.innerHTML = `
        <div class="invitation-box" style="text-align: center; padding: 20px;">
          <div style="font-size: 1.5rem; margin-bottom: 6px;">🎉</div>
          <div class="invitation-headline" style="color: var(--brand-emerald);">All caught up!</div>
          <p class="invitation-desc">All caught up! Add a new task inside a goal to keep going.</p>
          <div class="invitation-actions" style="justify-content: center; margin-top: 10px;">
            <button class="btn-primary-emerald" onclick="openAddTaskModal()">+ Add Task</button>
          </div>
        </div>
      `;
    } else {
      // Day 0 Cold Start
      nextTaskBox.innerHTML = `
        <div class="invitation-box">
          <div class="invitation-header-row">
            <div class="invitation-headline">No tasks scheduled yet.</div>
          </div>
          <p class="invitation-desc">Add a task or milestone to begin your focused day.</p>
          <div class="invitation-actions">
            <button class="btn-primary-emerald" onclick="openAddTaskModal()">+ Add Task</button>
            <button class="btn-secondary-pill" onclick="switchView('routines')">Set Routine</button>
          </div>
        </div>
      `;
    }
  }

  // 3. Today's Schedule Card: Keep ⚡ Auto-Schedule Today button accessible
  const homeAutoBtn = document.getElementById('homeAutoScheduleBtn');
  if (homeAutoBtn) {
    // Show in header when scheduled blocks exist OR when tasks are waiting to be scheduled
    homeAutoBtn.style.display = (hasScheduledBlocks || tasks.length > 0) ? 'inline-flex' : 'none';
  }

  const timelineBox = document.getElementById('homeTimelineList');
  if (timelineBox) {
    if (hasScheduledBlocks) {
      timelineBox.innerHTML = scheduledBlocks.map((block, idx) => {
        const isCompleted = block.status === 'completed' || block.task_completed;
        const isFirstIncomplete = !isCompleted && incompleteScheduledBlocks.length > 0 && incompleteScheduledBlocks[0].id === block.id;
        const rankNum = idx + 1;
        const isGoalTask = Boolean(block.goal_id || block.goalId);
        const goalLabel = isGoalTask
          ? `🎯 ${block.goal_title || 'Goal Task'}${block.goal_priority ? ` · ${block.goal_priority} Priority` : ''}`
          : `📌 Independent`;
        const statusText = isCompleted ? 'Completed' : (isFirstIncomplete ? 'Next' : 'Scheduled');
        const statusColor = isCompleted ? 'rgba(16, 185, 129, 0.15); color: var(--brand-emerald);' : (isFirstIncomplete ? 'rgba(16, 185, 129, 0.15); color: var(--brand-emerald); font-weight: 700;' : 'rgba(6, 182, 212, 0.12); color: #06B6D4;');
        return `
          <div class="timeline-row-item ${isFirstIncomplete ? 'timeline-row-first' : ''}">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <span class="rank-number-pill ${isFirstIncomplete ? 'first' : ''}">#${rankNum}</span>
              <div style="display: flex; flex-direction: column; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="timeline-time" style="font-weight: 600;">${formatTime12Hour(block.start_time)} – ${formatTime12Hour(block.end_time)}</span>
                  <span style="font-weight: 600; font-size: 0.86rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(block.task_title || 'Focus Task')}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                  <span style="font-size: 0.72rem; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(goalLabel)}</span>
                  <span class="priority-tag prio-${(block.task_priority || 'Medium').toLowerCase()}" style="font-size: 0.68rem; padding: 1px 5px;">${escapeHtml(block.task_priority || 'Medium')}</span>
                </div>
              </div>
            </div>
            <span class="category-pill" style="font-size: 0.72rem; ${statusColor}">${statusText}</span>
          </div>
        `;
      }).join('');
    } else if (tasks.length > 0) {
      const routineIncomplete = Store.state.routine_coverage_incomplete;
      const subtitleText = routineIncomplete
        ? "Complete your 24-hour routine schedule first, then click '⚡ Auto-Schedule Today' to build your plan."
        : "Click '⚡ Auto-Schedule Today' in the card header above (or below) to build your priority execution plan.";
      timelineBox.innerHTML = `
        <div class="schedule-starter-box" style="padding: 24px 16px; text-align: center;">
          <div style="font-size: 1.4rem; margin-bottom: 6px;">⚡</div>
          <div class="schedule-starter-title" style="font-size: 0.95rem; font-weight: 700;">Ready to Schedule</div>
          <p class="schedule-starter-body" style="font-size: 0.82rem; margin: 4px 0 12px 0; color: var(--text-secondary);">${subtitleText}</p>
          <button type="button" class="btn-primary-emerald" style="padding: 6px 14px; font-size: 0.8rem; margin: 0 auto;" onclick="triggerAutoSchedule(this)">⚡ Auto-Schedule Today</button>
        </div>
      `;
    } else {
      timelineBox.innerHTML = `
        <div class="schedule-starter-box">
          <div class="schedule-starter-title">No schedule created yet.</div>
          <p class="schedule-starter-body">Add your first routine or goal, and EKAGRA will build your execution plan.</p>
          <div class="schedule-action-pair">
            <button class="btn-secondary-pill" onclick="openAddRoutineModal()">Create Routine</button>
            <button class="btn-secondary-pill" onclick="openAddGoalModal()">Add Goal</button>
          </div>
        </div>
      `;
    }
  }

  // 4. Goals Section (Compact Overviews)
  const goalsOverview = document.getElementById('homeGoalsOverviewList');
  if (goalsOverview) {
    if (isCold || !goals.length) {
      goalsOverview.innerHTML = `
        <div class="goal-blueprint-box">
          <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">No goals yet</div>
          <p class="blueprint-desc" style="margin-bottom: 14px;">Set your first goal to start your journey.</p>
          <button class="btn-primary-emerald" style="align-self: flex-start; padding: 8px 16px;" onclick="openAddGoalModal()">+ Add Goal</button>
        </div>
      `;
    } else {
      goalsOverview.innerHTML = goals.slice(0, 4).map((goal) => {
        const progress = Math.round(goal.progress || 0);
        return `
        <div class="goal-compact-item" onclick="switchView('goals')">
          <div class="goal-compact-top">
            <div class="goal-compact-ident">
              <div class="goal-target-glyph-sm">🎯</div>
              <div>
                <div class="goal-compact-title">${escapeHtml(goal.title || goal.name)}</div>
                <div class="goal-compact-meta">Target: ${escapeHtml(goal.target_date || goal.deadline)} • ${escapeHtml(goal.priority)} Priority</div>
              </div>
            </div>
            <span class="goal-pct-pill">${progress}%</span>
          </div>
          <div class="meter-track" style="margin-bottom: 0; height: 6px;">
            <div class="meter-fill" style="width: ${progress}%;"></div>
          </div>
        </div>
      `;
      }).join('');
    }
  }

  // 5. Dynamic Insights Box (Live Mini-Stats synced with GET /api/insights)
  const insightsBox = document.getElementById('homeInsightsFeed');
  if (insightsBox) {
    const ins = state.insightsData;
    const learning = ins?.learning;
    const capacity = ins?.capacity;

    const hasData = completedCount > 0 || (metrics.totalCompletedTasks > 0) || (state.routines && state.routines.length > 0) || (learning && learning.completed_count > 0);
    if (!hasData || isCold) {
      insightsBox.innerHTML = `
        <div class="insight-calibration-box" style="padding: 16px; text-align: center;">
          <p class="calibration-text" style="font-size: 0.84rem; color: var(--text-secondary); margin: 0;">Complete some tasks or set up your routine to begin generating real behavioral insights.</p>
        </div>
      `;
    } else {
      const pace = learning?.pace_factor || 1.0;
      const calCount = learning?.calibrated_count !== undefined ? learning.calibrated_count : (learning?.completed_count || 0);
      const paceDesc = calCount < 3
        ? `Baseline pace (1.0x). Calibrates after 3 verified task durations (${calCount}/3 verified).`
        : `Learned pace factor of ${pace}x calibrated from verified task execution durations.`;

      const peakWindow = learning?.peak_focus_window || 'Morning (05:00 AM – 12:00 PM)';

      let freeHours = capacity?.daily_available_hours;
      if (freeHours === undefined || freeHours === null) {
        let freeMins = 0;
        if (state.routines && state.routines.length > 0) {
          for (const r of state.routines) {
            if (['available', 'flexible'].includes((r.availability_type || '').toLowerCase())) {
              const s = parseTimeToMinutes(r.start_time);
              const e = parseTimeToMinutes(r.end_time);
              if (s !== null && e !== null) {
                freeMins += (e >= s ? e - s : 1440 - s + e);
              }
            }
          }
        }
        freeHours = freeMins > 0 ? (Math.round((freeMins / 60) * 10) / 10) : 0;
      }

      insightsBox.innerHTML = `
        <div class="insight-live-grid" style="display: flex; flex-direction: column; gap: 8px;">
          <div class="insight-card-item" style="padding: 10px 12px;">
            <div class="insight-type-icon pace" style="width: 24px; height: 24px; font-size: 0.8rem;">⚡</div>
            <div class="insight-content">
              <div class="insight-title" style="font-size: 0.82rem;">Execution Pace Factor: ${pace}x</div>
              <div class="insight-desc" style="font-size: 0.74rem;">${paceDesc}</div>
            </div>
          </div>
          <div class="insight-card-item" style="padding: 10px 12px;">
            <div class="insight-type-icon peak" style="width: 24px; height: 24px; font-size: 0.8rem;">🌅</div>
            <div class="insight-content">
              <div class="insight-title" style="font-size: 0.82rem;">Peak Focus Window: ${escapeHtml(peakWindow)}</div>
              <div class="insight-desc" style="font-size: 0.74rem;">Highest completion probability slot protected for high-priority goals.</div>
            </div>
          </div>
          <div class="insight-card-item" style="padding: 10px 12px;">
            <div class="insight-type-icon" style="width: 24px; height: 24px; font-size: 0.8rem; background: rgba(6, 182, 212, 0.12); color: #06B6D4;">📊</div>
            <div class="insight-content">
              <div class="insight-title" style="font-size: 0.82rem;">Daily Free Capacity: ${freeHours} hrs / day</div>
              <div class="insight-desc" style="font-size: 0.74rem;">Available focus hours calculated from your 24h routine.</div>
            </div>
          </div>
        </div>
      `;
    }
  }

  // 6. Recent Activity Log (Capped scrollable list)
  const activityBox = document.getElementById('homeActivityFeed');
  const activities = Array.isArray(state.activities) ? state.activities : [];
  if (activityBox) {
    if (isCold || !activities.length) {
      activityBox.innerHTML = `
        <div class="activity-empty-box" style="padding: 16px; text-align: center;">
          <div class="activity-empty-title" style="font-size: 0.84rem; color: var(--text-secondary);">No recent activity recorded.</div>
        </div>
      `;
    } else {
      activityBox.innerHTML = `
        <div style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px;">
          ${activities.map((act) => `
            <div class="activity-item">
              <div class="activity-main">
                <span class="activity-title">${escapeHtml(act.title)}</span>
                <span class="activity-sub">${escapeHtml(act.subtitle)}</span>
              </div>
              <span class="activity-time">${escapeHtml(act.time)}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  }
}

// ==========================================================================
// View 2 & 3: Goals Hub (Screens 2 & 12) & Execution Pacing
// ==========================================================================

function calculateGoalHealth(goal) {
  if (!goal) return 'On Track';
  const progress = Number(goal.progress) || 0;
  if (progress >= 100) return 'On Track';

  const rawTarget = goal.target_date || goal.deadline;
  if (!rawTarget) return 'On Track';

  const targetDate = parseLocalDate(rawTarget);
  if (!targetDate || isNaN(targetDate.getTime())) return 'On Track';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const targetDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 12, 0, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.round((targetDay - today) / msPerDay);

  if (daysRemaining < 0) return 'Behind';

  let createdDay = today;
  if (goal.created_at) {
    const parsedCreated = parseLocalDate(goal.created_at);
    if (parsedCreated && !isNaN(parsedCreated.getTime())) {
      createdDay = new Date(parsedCreated.getFullYear(), parsedCreated.getMonth(), parsedCreated.getDate(), 12, 0, 0);
    }
  }

  const totalDays = Math.max(1, Math.round((targetDay - createdDay) / msPerDay));
  const elapsedDays = Math.max(0, Math.round((today - createdDay) / msPerDay));

  if (daysRemaining <= 3 && progress < 20) return 'Behind';
  if (daysRemaining <= 7 && progress < 15) return 'At Risk';

  const expectedProgress = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
  const delta = progress - expectedProgress;

  if (delta >= -15) return 'On Track';
  if (delta >= -35) return 'At Risk';
  return 'Behind';
}

function formatDateForInput(dateStr) {
  return formatLocalDateKey(dateStr);
}

const recentToastMessages = new Map();
function showToast(message, type = 'success') {
  if (!message) return;
  const now = Date.now();
  const key = `${type}:${message}`;
  if (recentToastMessages.has(key) && (now - recentToastMessages.get(key)) < 2500) {
    return; // suppress duplicate identical toast within 2.5s
  }
  recentToastMessages.set(key, now);
  if (recentToastMessages.size > 20) {
    for (const [k, ts] of recentToastMessages.entries()) {
      if (now - ts > 5000) recentToastMessages.delete(k);
    }
  }

  const container = document.getElementById('ekagraToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  const icon = type === 'success' ? '✓' : (type === 'warning' ? '⚠️' : '✕');
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 250);
  }, 3500);
}

function renderGoals(state) {
  const container = document.getElementById('goalsCardsContainer');
  if (!container) return;

  if (window.checkAndDisplayFirstTaskPrompt) {
    window.checkAndDisplayFirstTaskPrompt(state);
  }

  const currentFilter = state.goalFilter || 'All';
  document.querySelectorAll('.goals-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === currentFilter);
  });
  const searchQuery = (state.goalSearch || '').trim().toLowerCase();

  let filtered = (state.goals || []).map((g) => ({
    ...g,
    health: g.health || calculateGoalHealth(g)
  }));

  if (currentFilter !== 'All') {
    filtered = filtered.filter((g) => g.health === currentFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter((g) =>
      (g.title || g.name || '').toLowerCase().includes(searchQuery) ||
      (g.description || '').toLowerCase().includes(searchQuery)
    );
  }

  // Exact Day-0 Empty State Requirement
  if (!state.goals.length) {
    container.innerHTML = `
      <div class="goal-empty-state-box" style="grid-column: 1 / -1; padding: 48px 24px; text-align: center; background: var(--card-bg); border: 1px dashed var(--card-border); border-radius: 16px;">
        <div style="font-size: 1.6rem; margin-bottom: 8px;">🌱</div>
        <div style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">No goals yet</div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 20px;">Set your first goal to start your journey.</p>
        <button type="button" class="btn-primary-emerald" onclick="openAddGoalModal()">+ Add Goal</button>
      </div>
    `;
    return;
  }

  if (!filtered.length) {
    container.innerHTML = `
      <div class="goal-empty-state-box" style="grid-column: 1 / -1; padding: 40px 24px; text-align: center; background: var(--card-bg); border: 1px dashed var(--card-border); border-radius: 16px;">
        <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">No matching goals</div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px;">Try adjusting your search query or status filter.</p>
        <button type="button" class="btn-secondary-pill" onclick="clearGoalFilters()">Clear Filters</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((goal) => {
    const health = goal.health || calculateGoalHealth(goal);
    const goalTasks = Array.isArray(goal.tasks) ? goal.tasks : (Store.state.tasks || []).filter((t) => t.goal_id === goal.id || t.goalId === goal.id);
    const totalTasks = goalTasks.length;
    const completedTasks = goalTasks.filter((t) => t.completed).length;
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const isExpanded = Store.state.expandedGoals && Store.state.expandedGoals.has(goal.id);

    let tasksInfoText = '';
    if (totalTasks > 0) {
      tasksInfoText = `${completedTasks} of ${totalTasks} tasks completed`;
    } else {
      tasksInfoText = `No tasks added yet.`;
    }

    return `
    <div class="goal-card-full" id="goal-card-${goal.id}" data-goal-id="${goal.id}">
      <div class="goal-card-header">
        <div class="goal-title-wrap">
          <div class="goal-target-glyph">🎯</div>
          <div>
            <div class="goal-title-lg">${escapeHtml(goal.title || goal.name)}</div>
            <div class="goal-deadline-text">Target: ${escapeHtml(goal.target_date || goal.deadline || 'No target date')}</div>
          </div>
        </div>
        <div class="goal-header-right">
          <span class="health-status-pill status-${cleanStatus(health)}">${escapeHtml(health)}</span>
          <span class="priority-tag prio-${(goal.priority || 'Medium').toLowerCase()}">${escapeHtml(goal.priority || 'Medium')} Priority</span>
          <div class="goal-card-actions">
            <button type="button" class="btn-goal-action" title="Edit Goal" onclick="openEditGoalModal('${goal.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button type="button" class="btn-goal-action btn-goal-delete" title="Delete Goal" onclick="openDeleteGoalModal('${goal.id}')">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>

      ${goal.description ? `<div class="goal-desc-text">${escapeHtml(goal.description)}</div>` : ''}

      <div class="goal-card-footer">
        <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-weight: 600; margin-bottom: 6px;">
          <span style="color: var(--text-secondary);">Progress</span>
          <span style="color: var(--brand-emerald);">${progress}%</span>
        </div>
        <div class="meter-track" style="margin-bottom: 0;">
          <div class="meter-fill" style="width: ${progress}%;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-secondary); margin-top: 8px;">
          <span>${tasksInfoText}</span>
          <button type="button" class="btn-toggle-goal-tasks ${isExpanded ? 'expanded' : ''}" onclick="toggleGoalExpand('${goal.id}')">
            <span>${isExpanded ? 'Hide Tasks' : 'Tasks'} (${totalTasks})</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
        </div>
      </div>

      <!-- Expandable Tasks Drawer (Inline Tasks) -->
      <div class="goal-tasks-drawer ${isExpanded ? 'expanded' : ''}" id="goal-tasks-drawer-${goal.id}">
        
        <!-- Inline Task Creation Form -->
        <div class="inline-task-create-box">
          <div class="inline-task-create-title">+ Add Inline Task</div>
          <form class="inline-task-form" onsubmit="handleInlineTaskCreate(event, '${goal.id}')">
            <div class="inline-task-row-top">
              <input type="text" class="modal-input inline-task-title-input" placeholder="Task title *" required style="flex: 2;">
              <select class="modal-select inline-task-prio-select" style="flex: 1;">
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div style="margin-top: 6px;">
              <input type="text" class="modal-input inline-task-desc-input" placeholder="Description (optional)">
            </div>
            <div class="inline-task-row-bottom" style="margin-top: 6px;">
              <div class="inline-duration-group">
                <input type="number" min="1" max="1440" class="modal-input inline-task-duration-input" placeholder="Duration (min)">
                <button type="button" class="btn-ai-estimate-pill" onclick="handleAiEstimateClick(this, null, null)">✨ AI Estimate</button>
              </div>
              <input type="date" class="modal-input inline-task-due-input" style="flex: 1; min-width: 130px;">
              <button type="submit" class="btn-primary-emerald" style="padding: 8px 16px; border-radius: 8px;">+ Add Task</button>
            </div>
            <div class="inline-ai-notice" style="display: none;"></div>
            <div class="inline-ai-clarification-box" style="display: none;"></div>
          </form>
        </div>

        <!-- Associated Tasks List -->
        <div class="goal-tasks-list">
          ${goalTasks.length === 0 ? `
            <div style="font-size: 0.82rem; color: var(--text-muted); text-align: center; padding: 12px; font-style: italic;">No tasks added yet.</div>
          ` : goalTasks.map((task) => `
            <div class="goal-task-item ${task.completed ? 'completed' : ''}" id="task-item-${task.id}">
              <div class="goal-task-left">
                <div class="goal-task-checkbox ${task.completed ? 'checked' : ''}" onclick="handleTaskCheckboxClick('${task.id}', '${goal.id}', this)">
                  <svg viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <div class="goal-task-details">
                  <div class="goal-task-title ${task.completed ? 'completed' : ''}">${escapeHtml(task.title)}</div>
                  ${task.description ? `<div class="goal-task-desc">${escapeHtml(task.description)}</div>` : ''}
                </div>
              </div>
              <div class="goal-task-right">
                <span class="priority-tag prio-${(task.priority || 'Medium').toLowerCase()}">${escapeHtml(task.priority || 'Medium')}</span>
                ${task.duration_minutes ? `<span class="duration-badge">⏱️ ${task.duration_minutes} min</span>` : ''}
                ${task.due_date ? `<span class="due-date-badge">📅 ${escapeHtml(task.due_date)}</span>` : ''}
                ${task.scheduled_start_time ? `<span class="time-badge" style="font-size: 0.74rem; color: var(--brand-emerald); background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 6px;">⏰ ${formatTime12Hour(task.scheduled_start_time)} – ${formatTime12Hour(task.scheduled_end_time)}</span>` : ''}
                <button type="button" class="goal-task-action-btn" title="Edit Task" onclick="openEditTaskModal('${task.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button type="button" class="goal-task-action-btn delete-btn" title="Delete Task" onclick="openDeleteTaskModal('${task.id}')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>

      </div>
    </div>
  `;
  }).join('');
}

window.setGoalFilter = function (filterVal) {
  document.querySelectorAll('.goals-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filterVal);
  });
  Store.setState({ goalFilter: filterVal });
};

window.handleGoalSearch = function (e) {
  Store.setState({ goalSearch: e.target.value });
};

window.clearGoalFilters = function () {
  const searchInput = document.getElementById('goalSearchInput') || document.querySelector('.search-field');
  if (searchInput) searchInput.value = '';
  document.querySelectorAll('.goals-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === 'All');
  });
  Store.setState({ goalFilter: 'All', goalSearch: '' });
};

window.openAddGoalModal = function () {
  const form = document.getElementById('addGoalForm');
  if (form) form.reset();
  const btn = document.getElementById('addGoalSubmitBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Create Goal';
  }
  document.querySelectorAll('.goal-priority-btn').forEach((b) => {
    b.classList.toggle('selected', b.getAttribute('data-prio') === 'Medium');
  });
  window.openModal('addGoalModal');
};

window.openEditGoalModal = function (goalId) {
  const goal = Store.state.goals.find((g) => g.id === goalId);
  if (!goal) return;

  const idEl = document.getElementById('editGoalId');
  const titleEl = document.getElementById('editGoalTitle');
  const descEl = document.getElementById('editGoalDesc');
  const dateEl = document.getElementById('editGoalDate');
  const progressValEl = document.getElementById('editGoalProgressVal');
  const progressBarFill = document.getElementById('editGoalProgressBarFill');
  const btn = document.getElementById('editGoalSubmitBtn');

  if (idEl) idEl.value = goal.id;
  if (titleEl) titleEl.value = goal.title || goal.name || '';
  if (descEl) descEl.value = goal.description || '';
  if (dateEl) dateEl.value = formatDateForInput(goal.target_date || goal.deadline);

  const totalTasks = typeof goal.totalTasks === 'number' ? goal.totalTasks : (typeof goal.total_tasks === 'number' ? goal.total_tasks : 0);
  const progress = Math.round(goal.progress || 0);

  if (progressValEl) {
    if (totalTasks === 0 && progress === 0) {
      progressValEl.textContent = '0% — No tasks yet';
    } else {
      progressValEl.textContent = `${progress}% Complete`;
    }
  }
  if (progressBarFill) {
    progressBarFill.style.width = `${progress}%`;
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }

  const priority = goal.priority || 'Medium';
  document.querySelectorAll('.edit-goal-priority-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.getAttribute('data-prio') === priority);
  });

  window.openModal('editGoalModal');
};

window.openDeleteGoalModal = function (goalId) {
  const goal = Store.state.goals.find((g) => g.id === goalId);
  if (!goal) return;

  const modal = document.getElementById('deleteGoalModal');
  if (modal) modal.dataset.goalId = goalId;

  const titleEl = document.getElementById('deleteGoalTargetTitle');
  if (titleEl) {
    titleEl.textContent = `"${goal.title || goal.name || 'Untitled Goal'}"`;
  }

  const deleteBtn = document.getElementById('confirmDeleteGoalBtn');
  const cancelBtn = document.getElementById('cancelDeleteGoalBtn');
  if (deleteBtn) {
    deleteBtn.disabled = false;
    deleteBtn.textContent = 'Delete Goal';
  }
  if (cancelBtn) cancelBtn.disabled = false;

  window.openModal('deleteGoalModal');
};

window.deleteGoal = function (goalId) {
  window.openDeleteGoalModal(goalId);
};

// ==========================================================================
// View 4 & 5: Tasks Hub (Screens 4 & 5)
// ==========================================================================

function renderTasks(state) {
  const container = document.getElementById('tasksTableRows');
  if (!container) return;

  const todayStr = getLocalDateString();
  let filtered = Array.isArray(state.tasks) ? state.tasks : [];

  if (state.taskTab === 'Today') {
    filtered = filtered.filter((t) => t.date === 'Today' || t.scheduled_date === todayStr || t.due_date === todayStr || (t.due_date && t.due_date <= todayStr && !t.completed));
  } else if (state.taskTab === 'Upcoming') {
    filtered = filtered.filter((t) => (!t.completed && ((t.scheduled_date && t.scheduled_date > todayStr) || (t.due_date && t.due_date > todayStr))));
  } else if (state.taskTab === 'Completed') {
    filtered = filtered.filter((t) => t.completed === 1 || t.completed === true);
  }

  // Type filter: all | goal | independent
  const typeFilter = state.taskTypeFilter || 'all';
  if (typeFilter === 'goal') {
    filtered = filtered.filter((t) => Boolean(t.goal_id || t.goalId));
  } else if (typeFilter === 'independent') {
    filtered = filtered.filter((t) => !t.goal_id && !t.goalId);
  }

  if (state.taskSearch) {
    const q = state.taskSearch.toLowerCase();
    filtered = filtered.filter((t) =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.goal_title || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    );
  }

  // Synchronize tabs and type pills active styling in DOM
  const currentTab = state.taskTab || 'All';
  document.querySelectorAll('.task-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === currentTab);
  });

  document.querySelectorAll('.task-type-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-type') === typeFilter);
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="invitation-box" style="margin: 12px 0;">
        <div class="invitation-header-row">
          <span style="font-size: 1.1rem;">🌱</span>
          <div class="invitation-headline">No tasks scheduled in this view</div>
        </div>
        <p class="invitation-desc">Break down your goals into single actionable focus blocks.</p>
        <div class="invitation-actions">
          <button class="btn-primary-emerald" onclick="openAddTaskModal()">+ Add Task</button>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((task) => {
    const isGoalTask = Boolean(task.goal_id || task.goalId);
    const parentGoal = isGoalTask
      ? (state.goals || []).find((g) => g.id === task.goal_id || g.id === task.goalId)
      : null;
    const rawGoalTitle = isGoalTask
      ? ((task.goal_title && task.goal_title !== 'Personal')
        ? task.goal_title
        : (parentGoal ? (parentGoal.title || parentGoal.name) : (task.goal_title || 'Goal Task')))
      : null;
    const badgeHtml = isGoalTask
      ? `<span class="category-pill pill-goal" style="font-size: 0.74rem;">🎯 ${escapeHtml(rawGoalTitle || 'Goal Task')}</span>`
      : `<span class="category-pill pill-independent" style="font-size: 0.74rem;">📌 Independent</span>`;

    const timeDisplay = task.scheduled_start_time
      ? `⏰ ${formatTime12Hour(task.scheduled_start_time)} – ${formatTime12Hour(task.scheduled_end_time)}`
      : (task.timeSlot ? `⏰ ${escapeHtml(task.timeSlot)}` : '');

    return `
      <div class="task-row-item ${task.completed ? 'completed' : ''}">
        <div class="task-row-left">
          <div class="task-checkbox-custom ${task.completed ? 'checked' : ''}" onclick="handleTaskCheckboxClick('${task.id}', '${task.goal_id || ''}', this)" title="${task.completed ? 'Mark incomplete' : 'Complete (Quick Check-In)'}">
            <svg viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <div style="display: flex; flex-direction: column;">
            <span class="task-name-text">${escapeHtml(task.title)}</span>
            <div style="display: flex; gap: 8px; align-items: center; margin-top: 3px; font-size: 0.74rem; color: var(--text-muted); flex-wrap: wrap;">
              ${task.duration_minutes ? `<span>⏱️ ${task.duration_minutes}m</span>` : ''}
              ${task.due_date ? `<span>📅 ${escapeHtml(task.due_date)}</span>` : ''}
              ${timeDisplay ? `<span style="color: var(--brand-emerald); font-weight: 600;">${timeDisplay}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="task-row-right">
          <span class="priority-tag prio-${(task.priority || 'medium').toLowerCase()}">${escapeHtml(task.priority || 'Medium')}</span>
          ${badgeHtml}
          <div style="display: flex; gap: 4px; align-items: center;">
            ${!task.completed ? `
              <button class="task-row-actions-btn" onclick="openQuickCheckInModal('${task.id}')" title="Complete (Quick Check-In)" style="background: none; border: none; color: var(--brand-emerald); cursor: pointer; padding: 4px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </button>
            ` : ''}
            <button class="task-row-actions-btn" onclick="openEditTaskModal('${task.id}')" title="Edit Task" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button class="task-row-actions-btn" onclick="deleteTask('${task.id}')" title="Delete Task" style="background: none; border: none; color: var(--accent-rose); cursor: pointer; padding: 4px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.setTaskTypeFilter = function (filter) {
  document.querySelectorAll('.task-type-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-type') === filter);
  });
  Store.setState({ taskTypeFilter: filter });
};

window.setTaskTab = function (tabName) {
  document.querySelectorAll('.task-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });
  Store.setState({ taskTab: tabName });
};

window.handleTaskSearch = function (e) {
  Store.setState({ taskSearch: e.target.value });
};

window.rescheduleTask = function(taskId, btnEl) {
  window.handleHomeRescheduleNextTask(taskId, btnEl);
};

window.deleteTask = function (taskId) {
  window.openDeleteTaskModal(taskId);
};

// ==========================================================================
// View 6: Interactive Schedule Timeline (Screen 6)
// ==========================================================================
// View 6: Schedule Multi-Day Views (Day, Week, Month)
// ==========================================================================

function renderScheduleWeekView(state, streamContainer) {
  const current = parseLocalDate(state.scheduleDate || new Date());
  const dayOfWeek = current.getDay();
  const distanceToMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - distanceToMonday, 12, 0, 0);

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 12, 0, 0);
    weekDays.push(d);
  }

  const startStr = monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endD = weekDays[6];
  const endStr = endD.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const titleEl = document.getElementById('scheduleCurrentDateTitle');
  if (titleEl) titleEl.textContent = `Week: ${startStr} – ${endStr}`;

  const allTasks = state.tasks || [];
  const scheduleSettings = state.scheduleSettings || { weekends_days: ['Saturday', 'Sunday'], weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] };
  const weekendsDays = scheduleSettings.weekends_days || ['Saturday', 'Sunday'];
  const todayIso = formatLocalDateKey(new Date());
  const selectedIso = formatLocalDateKey(current);

  const daysHtml = weekDays.map((d) => {
    const dateIso = formatLocalDateKey(d);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const isWeekend = weekendsDays.includes(dayName);
    const isSelected = dateIso === selectedIso;
    const isToday = dateIso === todayIso;

    // Filter tasks for this day: matching due date or scheduled blocks
    const dayTasks = allTasks.filter((t) => formatLocalDateKey(t.due_date) === dateIso || (isToday && !t.due_date && !t.completed));
    const completedTasks = dayTasks.filter((t) => t.completed).length;

    return `
      <div class="week-day-card ${isSelected ? 'active-day' : ''}">
        <div class="week-day-header">
          <div>
            <div class="week-day-title">${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${isToday ? ' (Today)' : ''}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">${dayTasks.length} task${dayTasks.length === 1 ? '' : 's'}${completedTasks > 0 ? ` · ${completedTasks} done` : ''}</div>
          </div>
          <span class="week-day-badge ${isWeekend ? 'weekend' : 'weekday'}">${isWeekend ? 'Weekend' : 'Weekday'}</span>
        </div>

        <div class="week-day-tasks-list">
          ${dayTasks.length === 0 ? `
            <div style="font-size: 0.76rem; color: var(--text-muted); font-style: italic; padding: 12px 0; text-align: center;">No scheduled tasks</div>
          ` : dayTasks.slice(0, 4).map((t) => `
            <div class="week-task-item">
              <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 140px; ${t.completed ? 'text-decoration: line-through; color: var(--text-muted);' : 'color: var(--text-primary);'}">${escapeHtml(t.title)}</span>
              <span class="priority-tag prio-${(t.priority || 'medium').toLowerCase()}" style="font-size: 0.64rem;">${escapeHtml(t.priority || 'Medium')}</span>
            </div>
          `).join('')}
          ${dayTasks.length > 4 ? `<div style="font-size: 0.72rem; color: var(--text-muted); text-align: center;">+${dayTasks.length - 4} more</div>` : ''}
        </div>

        <button type="button" class="btn-secondary-pill" style="width: 100%; justify-content: center; font-size: 0.76rem; padding: 6px;" onclick="selectScheduleDateAndMode('${dateIso}', 'Day')">
          📅 Focus Day
        </button>
      </div>
    `;
  }).join('');

  streamContainer.innerHTML = `
    <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
      <span style="font-size: 0.88rem; font-weight: 700; color: var(--text-secondary);">7-Day Weekly Capacity & Schedule</span>
      <span style="font-size: 0.76rem; color: var(--text-muted);">Click any day to jump to full 24h stream</span>
    </div>
    <div class="week-grid-view">
      ${daysHtml}
    </div>
  `;
}

function renderScheduleMonthView(state, streamContainer) {
  const current = parseLocalDate(state.scheduleDate || new Date());
  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1, 12, 0, 0);
  const lastDay = new Date(year, month + 1, 0, 12, 0, 0);
  const totalDays = lastDay.getDate();
  const monthTitle = current.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const titleEl = document.getElementById('scheduleCurrentDateTitle');
  if (titleEl) titleEl.textContent = monthTitle;

  const startOffset = (firstDay.getDay() + 6) % 7;
  const todayIso = formatLocalDateKey(new Date());
  const allTasks = state.tasks || [];
  const allGoals = state.goals || [];

  const cells = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push(`<div class="month-day-cell" style="opacity: 0.3; pointer-events: none;"></div>`);
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateIso === todayIso;

    const dayGoals = allGoals.filter((g) => {
      const gIso = formatLocalDateKey(g.target_date || g.deadline);
      return gIso === dateIso;
    });

    const dayTasks = allTasks.filter((t) => {
      const tIso = formatLocalDateKey(t.due_date || t.scheduled_date);
      return tIso === dateIso;
    });

    cells.push(`
      <div class="month-day-cell ${isToday ? 'is-today' : ''}" onclick="selectScheduleDateAndMode('${dateIso}', 'Day')">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="month-day-num" style="${isToday ? 'color: var(--brand-emerald);' : ''}">${day}</span>
          ${isToday ? '<span style="font-size: 0.62rem; color: var(--brand-emerald); font-weight: 700;">TODAY</span>' : ''}
        </div>
        ${dayGoals.map((g) => `
          <div class="month-cell-event" style="background: rgba(16, 185, 129, 0.15); color: var(--brand-emerald);" title="Goal Target: ${escapeHtml(g.title || g.name)}">
            🎯 ${escapeHtml(g.title || g.name)}
          </div>
        `).join('')}
        ${dayTasks.slice(0, 2).map((t) => `
          <div class="month-cell-event" style="background: rgba(6, 182, 212, 0.12); color: #06B6D4;" title="Task: ${escapeHtml(t.title)}">
            ✓ ${escapeHtml(t.title)}
          </div>
        `).join('')}
        ${dayTasks.length > 2 ? `<div style="font-size: 0.62rem; color: var(--text-muted); text-align: center;">+${dayTasks.length - 2} more</div>` : ''}
      </div>
    `);
  }

  streamContainer.innerHTML = `
    <div class="month-calendar-view">
      <div class="month-weekdays-row">
        <div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div><div>Sun</div>
      </div>
      <div class="month-days-grid">
        ${cells.join('')}
      </div>
    </div>
  `;
}

async function renderSchedule(state) {
  const streamContainer = document.getElementById('scheduleStreamContainer');
  if (!streamContainer) return;

  const mode = state.scheduleViewMode || 'Day';
  document.querySelectorAll('.schedule-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
  });

  if (mode === 'Week') {
    renderScheduleWeekView(state, streamContainer);
    return;
  }
  if (mode === 'Month') {
    renderScheduleMonthView(state, streamContainer);
    return;
  }

  const now = parseLocalDate(state.scheduleDate || new Date());
  const dateIso = formatLocalDateKey(now);
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const titleEl = document.getElementById('scheduleCurrentDateTitle');
  if (titleEl) titleEl.textContent = dateStr;

  const thisFetchId = ++scheduleFetchId;
  let blocks = [];
  let routines = [];

  try {
    const res = await fetch(`/api/schedule?date=${dateIso}`);
    const data = await res.json();
    if (thisFetchId !== scheduleFetchId || Store.state.scheduleViewMode !== 'Day' || Store.state.currentView !== 'schedule') {
      return;
    }
    if (data.success) {
      blocks = data.blocks || [];
      routines = data.routines || [];
      if (data.routine_coverage_status) {
        Store.state.routine_coverage_status = data.routine_coverage_status;
        Store.state.routine_coverage_incomplete = data.routine_coverage_status.routine_coverage_incomplete;
        Store.state.is_routine_complete = data.routine_coverage_status.is_routine_complete;
        Store.state.incomplete_group = data.routine_coverage_status.incomplete_group;
        Store.state.routine_warning_message = data.routine_coverage_status.message;
        window.updateGlobalRoutineBanner(Store.state);
      }
    }
  } catch (e) {
    if (thisFetchId !== scheduleFetchId || Store.state.scheduleViewMode !== 'Day' || Store.state.currentView !== 'schedule') {
      return;
    }
  }

  if (thisFetchId !== scheduleFetchId || Store.state.scheduleViewMode !== 'Day' || Store.state.currentView !== 'schedule') {
    return;
  }

  // If no backend blocks and no routines, display starter box
  if (blocks.length === 0 && routines.length === 0) {
    const unscheduledTasks = (state.tasks || []).filter((t) => !t.completed);
    let queueHtml = '';
    if (unscheduledTasks.length > 0) {
      queueHtml = `
        <div class="unscheduled-queue-card" style="margin-top: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">Unscheduled Queue</span>
              <span class="category-pill" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; font-size: 0.72rem;">${unscheduledTasks.length} pending</span>
            </div>
            <button type="button" class="btn-primary-emerald" style="padding: 4px 12px; font-size: 0.76rem;" onclick="triggerAutoSchedule(this)">⚡ Auto-Schedule</button>
          </div>
          <div class="unscheduled-queue-list">
            ${unscheduledTasks.map((t) => `
              <div class="unscheduled-task-row">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                  <span style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(t.title)}</span>
                  <span style="font-size: 0.72rem; color: var(--text-muted);">⏱️ ${t.duration_minutes || 30}m</span>
                  <span class="category-pill" style="font-size: 0.7rem; background: rgba(16, 185, 129, 0.12); color: var(--brand-emerald);">${escapeHtml(t.goal_title || 'Personal')}</span>
                  <span class="priority-tag prio-${(t.priority || 'medium').toLowerCase()}" style="font-size: 0.66rem;">${escapeHtml(t.priority || 'Medium')}</span>
                </div>
                <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                  <button type="button" class="btn-secondary-pill" style="font-size: 0.72rem; padding: 4px 10px;" onclick="triggerAutoSchedule(this)">⚡ Schedule</button>
                  <button type="button" class="btn-secondary-pill" style="font-size: 0.72rem; padding: 4px 10px; color: var(--brand-emerald);" onclick="openQuickCheckInModal('${t.id}')">✓ Complete</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    streamContainer.innerHTML = `
      <div class="schedule-starter-box">
        <div class="schedule-starter-title">Your Day Starts Here 🌱</div>
        <p class="schedule-starter-body">Complete your 24-hour routine (Fixed Commitments + Flexible Windows) to auto-schedule your goals into protected focus hours.</p>
        <div class="schedule-action-pair">
          <button class="btn-secondary-pill" onclick="openInitialRoutineModal(true)">Set Up Routine</button>
          <button class="btn-primary-emerald" onclick="triggerAutoSchedule(this)">⚡ Auto-Schedule Goals</button>
        </div>
      </div>
      ${queueHtml}
    `;
    return;
  }

  // Combine routines and scheduled blocks into chronological stream items
  const streamItems = [];

  for (const r of routines) {
    const isAvail = ['available', 'flexible'].includes((r.availability_type || '').toLowerCase());
    const sMins = (typeof parseTimeToMinutes === 'function') ? parseTimeToMinutes(r.start_time) : 0;
    const durMins = (typeof parseTimeToMinutes === 'function') ? (() => {
      const s = parseTimeToMinutes(r.start_time);
      const e = parseTimeToMinutes(r.end_time);
      if (s === null || e === null) return 60;
      return e >= s ? (e - s) : (1440 - s + e);
    })() : 60;
    streamItems.push({
      type: 'routine',
      timeSlot: `${formatTime12Hour(r.start_time)} – ${formatTime12Hour(r.end_time)}`,
      durationMinutes: durMins,
      startMins: sMins || 0,
      title: r.name,
      subtitle: isAvail ? 'Available Routine Window' : 'Fixed Commitment (Protected)',
      isFixed: !isAvail,
      raw: r
    });
  }

  const activeBlocks = blocks.filter((b) => b.status === 'scheduled' || b.status === 'completed');
  let taskRankCounter = 1;
  for (const b of activeBlocks) {
    const sMins = (typeof parseTimeToMinutes === 'function') ? parseTimeToMinutes(b.start_time) : 0;
    const isBlockCompleted = b.status === 'completed' || Boolean(b.task_completed || b.completed);
    streamItems.push({
      type: 'task',
      id: b.id,
      taskId: b.task_id,
      rank: isBlockCompleted ? null : taskRankCounter++,
      timeSlot: `${formatTime12Hour(b.start_time)} – ${formatTime12Hour(b.end_time)}`,
      durationMinutes: b.allocated_minutes || 30,
      startMins: sMins || 0,
      title: b.task_title || 'Focus Task',
      goalTitle: b.goal_title || '',
      goalPriority: b.goal_priority || '',
      status: isBlockCompleted ? 'completed' : b.status,
      isFixed: false,
      priority: b.task_priority || 'Medium',
      allocatedMinutes: b.allocated_minutes,
      raw: b
    });
  }

  streamItems.sort((a, b) => a.startMins - b.startMins);

  const timelineHtml = streamItems.map((item) => {
    if (item.type === 'routine') {
      const slotClass = item.isFixed ? 'fixed-commitment fixed-commitment-dimmed' : 'flexible-slot';
      return `
        <div class="stream-slot-row ${slotClass}">
          <div style="display: flex; align-items: center; gap: 14px; min-width: 0;">
            <span class="timeline-time" style="font-weight: 600;">${escapeHtml(item.timeSlot)} (${item.durationMinutes}m)</span>
            <div style="min-width: 0;">
              <div style="font-weight: 700; font-size: 0.92rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(item.title)}</div>
              <div style="font-size: 0.74rem; color: var(--text-muted);">${escapeHtml(item.subtitle)}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <span class="category-pill" style="background: rgba(100, 116, 139, 0.15); color: var(--text-muted); font-size: 0.72rem;">${item.isFixed ? 'FIXED' : 'AVAILABLE'}</span>
          </div>
        </div>
      `;
    }

    const isCompleted = item.status === 'completed' || Boolean(item.raw && (item.raw.task_completed || item.raw.completed));
    const isMissed = item.status === 'missed';
    const isGoalTask = Boolean(item.raw && (item.raw.goal_id || item.raw.goalId));
    const goalBadgeText = isGoalTask
      ? `🎯 ${escapeHtml(item.goalTitle || 'Goal Task')}${item.goalPriority ? ` · ${escapeHtml(item.goalPriority)} Priority` : ''}`
      : `📌 Independent`;
    const goalBadgeClass = isGoalTask ? 'pill-goal' : 'pill-independent';

    return `
      <div class="stream-slot-row scheduled-task-slot ${isCompleted ? 'completed-task-slot' : ''} ${isMissed ? 'missed-task-slot' : ''}">
        <div style="display: flex; align-items: center; gap: 14px; min-width: 0;">
          ${item.rank ? `<span class="rank-number-pill ${item.rank === 1 ? 'first' : ''}">#${item.rank}</span>` : `<span class="rank-number-pill" style="opacity: 0.5; background: rgba(16, 185, 129, 0.1); color: var(--brand-emerald);">✓</span>`}
          <div style="min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="timeline-time" style="font-weight: 600;">${escapeHtml(item.timeSlot)} (${item.allocatedMinutes}m)</span>
              <span style="font-weight: 700; font-size: 0.92rem; color: var(--text-primary); ${isCompleted ? 'text-decoration: line-through; opacity: 0.7;' : ''}">${escapeHtml(item.title)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 0.76rem;">
              <span class="category-pill ${goalBadgeClass}" style="font-size: 0.72rem;">${goalBadgeText}</span>
              <span class="priority-tag prio-${(item.priority || 'medium').toLowerCase()}" style="font-size: 0.68rem;">${escapeHtml(item.priority)}</span>
            </div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          ${isCompleted ? '<span style="font-size: 0.78rem; color: var(--brand-emerald); font-weight: 700; padding: 4px 8px; background: rgba(16, 185, 129, 0.1); border-radius: 6px;">✓ Completed</span>' : ''}
          ${isMissed ? '<span style="font-size: 0.78rem; color: #ef4444; font-weight: 700; padding: 4px 8px; background: rgba(239, 68, 68, 0.1); border-radius: 6px;">✕ Missed</span>' : ''}
          ${!isCompleted && !isMissed ? `
            <button type="button" class="btn-secondary-pill" style="font-size: 0.74rem; padding: 5px 12px; color: var(--brand-emerald); font-weight: 600;" onclick="openQuickCheckInModal('${item.taskId}')">✓ Complete</button>
            <button type="button" class="btn-secondary-pill" style="font-size: 0.74rem; padding: 5px 12px; color: #f59e0b; font-weight: 600;" onclick="rescheduleScheduledBlock('${item.taskId}', this)">↻ Reschedule</button>
            <button type="button" class="btn-secondary-pill" style="font-size: 0.74rem; padding: 5px 12px; color: #ef4444; font-weight: 600;" onclick="missScheduledBlock('${item.taskId}', this)">✕ Miss</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Unscheduled tasks queue below the timeline
  const scheduledTaskIds = new Set(blocks.map((b) => String(b.task_id)));
  const unscheduledTasks = (state.tasks || []).filter((t) => !t.completed && !scheduledTaskIds.has(String(t.id)));

  let unscheduledQueueHtml = '';
  if (unscheduledTasks.length > 0) {
    unscheduledQueueHtml = `
      <div class="unscheduled-queue-card" style="margin-top: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary);">Unscheduled Queue</span>
            <span class="category-pill" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; font-size: 0.72rem;">${unscheduledTasks.length} pending</span>
          </div>
          <button type="button" class="btn-primary-emerald" style="padding: 4px 12px; font-size: 0.76rem;" onclick="triggerAutoSchedule(this)">⚡ Auto-Schedule</button>
        </div>
        <div class="unscheduled-queue-list">
          ${unscheduledTasks.map((t) => `
            <div class="unscheduled-task-row">
              <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                <span style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(t.title)}</span>
                <span style="font-size: 0.72rem; color: var(--text-muted);">⏱️ ${t.duration_minutes || 30}m</span>
                ${Boolean(t.goal_id || t.goalId)
        ? `<span class="category-pill pill-goal" style="font-size: 0.7rem;">🎯 ${escapeHtml(t.goal_title || 'Goal Task')}</span>`
        : `<span class="category-pill pill-independent" style="font-size: 0.7rem;">📌 Independent</span>`}
                <span class="priority-tag prio-${(t.priority || 'medium').toLowerCase()}" style="font-size: 0.66rem;">${escapeHtml(t.priority || 'Medium')}</span>
              </div>
              <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
                <button type="button" class="btn-secondary-pill" style="font-size: 0.72rem; padding: 4px 10px;" onclick="triggerAutoSchedule(this)">⚡ Schedule</button>
                <button type="button" class="btn-secondary-pill" style="font-size: 0.72rem; padding: 4px 10px; color: var(--brand-emerald);" onclick="openQuickCheckInModal('${t.id}')">✓ Complete</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  streamContainer.innerHTML = timelineHtml + unscheduledQueueHtml;
}

window.triggerAutoSchedule = async function(btnEl) {
  if (Store.state.routine_coverage_incomplete) {
    const msg = Store.state.routine_warning_message ||
      (Store.state.routine_coverage_status && Store.state.routine_coverage_status.message) ||
      'Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.';
    showToast(msg, 'warning');
    if (typeof window.openInitialRoutineModal === 'function') {
      window.openInitialRoutineModal(true);
    }
    return;
  }

  const activeBtn = (btnEl && btnEl.nodeType === 1)
    ? btnEl
    : (document.getElementById('homeAutoScheduleBtn') || document.getElementById('btnAutoScheduleGoals') || document.querySelector('[onclick*="triggerAutoSchedule"]'));
  return withActionLock('triggerAutoSchedule', activeBtn, 'Scheduling...', async () => {
    if (isTaskActionInFlight) return;
    isTaskActionInFlight = true;
    showToast('Generating priority schedule...', 'info');
    try {
      const res = await fetch('/api/schedule/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysAhead: 7, clearExisting: false })
      });
      const data = await res.json();
      if (data.routine_coverage_incomplete) {
        Store.setState({
          routine_coverage_incomplete: true,
          is_routine_complete: false,
          incomplete_group: data.incomplete_group,
          routine_warning_message: data.message
        });
        window.updateGlobalRoutineBanner(Store.state);
        showToast(data.message || 'Without your full 24-hour schedule, EKAGRA cannot know when you are free vs. busy to schedule your goals.', 'warning');
        window.openInitialRoutineModal(true);
        return;
      }
      if (data.success) {
        showToast(data.message || 'Auto-scheduled goals successfully!', 'success');
        await Store.loadTodaySchedule();
        await Store.init();
        if (Store.state.currentView === 'schedule') {
          renderSchedule(Store.state);
        }
        if (Store.state.currentView === 'home') {
          renderHome(Store.state);
        }
        if (Store.state.currentView === 'tasks') {
          renderTasks(Store.state);
        }
      } else {
        showToast(data.message || data.error || 'Could not schedule tasks.', 'error');
      }
    } catch (err) {
      console.error('Auto-schedule network error:', err);
      showToast('Network error while generating schedule.', 'error');
    } finally {
      isTaskActionInFlight = false;
    }
  }, 'Please wait — still processing...');
};

window.completeScheduledBlock = async function (taskId) {
  if (typeof window.openQuickCheckInModal === 'function') {
    window.openQuickCheckInModal(taskId);
  } else {
    await window.handleHomeCompleteNextTask(taskId);
  }
};

window.missScheduledBlock = async function(taskId, btnEl) {
  const btn = (btnEl && btnEl.nodeType === 1) ? btnEl : document.querySelector(`[onclick*="missScheduledBlock('${taskId}')"]`);
  return withActionLock('task_action_' + taskId, btn, 'Updating...', async () => {
    if (isTaskActionInFlight) return;
    isTaskActionInFlight = true;
    try {
      const res = await fetch('/api/schedule/miss-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Task marked missed. Adaptive focus model updated.', 'info');
        await Store.loadTodaySchedule();
        await Store.init();
        renderSchedule(Store.state);
        renderHome(Store.state);
        if (Store.state.currentView === 'insights') renderInsights(Store.state);
        if (Store.state.currentView === 'goals') renderGoals(Store.state);
        if (Store.state.currentView === 'tasks') renderTasks(Store.state);
      } else {
        showToast(data.error || 'Failed to record missed task.', 'error');
      }
    } catch (e) {
      showToast('Failed to record missed task.', 'error');
    } finally {
      isTaskActionInFlight = false;
    }
  }, 'Please wait — still processing...', { disableSiblings: true });
};

window.rescheduleScheduledBlock = async function(taskId, btnEl) {
  await window.handleHomeRescheduleNextTask(taskId, btnEl);
};

window.navigateScheduleDay = function (delta) {
  scheduleFetchId++;
  const mode = Store.state.scheduleViewMode || 'Day';
  const current = parseLocalDate(Store.state.scheduleDate || new Date());
  if (mode === 'Month') {
    current.setMonth(current.getMonth() + delta);
  } else if (mode === 'Week') {
    current.setDate(current.getDate() + (delta * 7));
  } else {
    current.setDate(current.getDate() + delta);
  }
  Store.setState({ scheduleDate: current });
};

window.snapScheduleToday = function () {
  scheduleFetchId++;
  Store.setState({ scheduleDate: new Date() });
};

window.setScheduleViewMode = function (mode) {
  scheduleFetchId++;
  document.querySelectorAll('.schedule-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
  });
  Store.setState({ scheduleViewMode: mode });
};

window.selectScheduleDateAndMode = function (dateIsoString, mode = 'Day') {
  scheduleFetchId++;
  const d = parseLocalDate(dateIsoString);
  document.querySelectorAll('.schedule-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
  });
  Store.setState({ scheduleDate: d, scheduleViewMode: mode });
};

// ==========================================================================
// View 7: Routines Builder (Screen 7)
// ==========================================================================

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function formatDaysListSummary(days) {
  if (!Array.isArray(days) || !days.length) return '';
  const abbrs = days.map((d) => d.slice(0, 3));
  if (abbrs.length >= 2 && isConsecutiveDays(days)) {
    return `${abbrs[0]} – ${abbrs[abbrs.length - 1]}`;
  }
  return abbrs.join(', ');
}

function isConsecutiveDays(days) {
  const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const indices = days.map((d) => order.indexOf(d)).filter((i) => i !== -1).sort((a, b) => a - b);
  if (indices.length < 2) return false;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] !== indices[i - 1] + 1) return false;
  }
  return true;
}

function getRoutineCategoryIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('sleep') || n.includes('rest') || n.includes('bed')) {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
  }
  if (n.includes('college') || n.includes('school') || n.includes('class') || n.includes('univ') || n.includes('study')) {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 10h1"></path><path d="M14 10h1"></path><path d="M9 14h1"></path><path d="M14 14h1"></path></svg>`;
  }
  if (n.includes('travel') || n.includes('commute') || n.includes('drive') || n.includes('transit') || n.includes('car')) {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 3c-.1.2-.1.4-.1.6v4.5c0 .6.4 1 1 1h2"></path><circle cx="7" cy="17" r="2"></circle><path d="M9 17h6"></path><circle cx="17" cy="17" r="2"></circle></svg>`;
  }
  if (n.includes('gym') || n.includes('fit') || n.includes('workout') || n.includes('exercise')) {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6.5 6.5 11 11"></path><path d="m21 21-1-1a2.83 2.83 0 0 0-4 0l-1 1"></path><path d="m16 16-1-1a2.83 2.83 0 0 0-4 0l-1 1"></path><path d="m3 3 1 1a2.83 2.83 0 0 0 4 0l1-1"></path><path d="m8 8 1 1a2.83 2.83 0 0 0 4 0l1-1"></path></svg>`;
  }
  if (n.includes('meal') || n.includes('lunch') || n.includes('dinner') || n.includes('food') || n.includes('eat')) {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 2v6a3 3 0 0 1-3 3 3 3 0 0 1-3-3V2"></path><path d="M15 2v18"></path><path d="M6 2v20"></path><path d="M4 2v4a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V2"></path></svg>`;
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
}

function minutesToClientTime24(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

function formatDurationHoursMinutes(mins) {
  if (!mins) return '0 mins';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h} hr ${m} mins`;
  if (h > 0) return `${h} ${h === 1 ? 'hr' : 'hrs'}`;
  return `${m} mins`;
}

function formatDaysListFull(days) {
  if (!Array.isArray(days) || !days.length) return 'None';
  return days.join(', ');
}

function calculateClientDayGaps(routinesList) {
  if (!Array.isArray(routinesList) || routinesList.length === 0) {
    return {
      gaps: [
        {
          start_time: '00:00',
          end_time: '00:00',
          start_minutes: 0,
          end_minutes: 1440,
          duration_minutes: 1440,
          is_overnight: false,
          is_unclassified: true
        }
      ],
      covered_minutes: 0,
      uncovered_minutes: 1440,
      is_full_day_covered: false
    };
  }

  const coveredIntervals = [];

  for (const r of routinesList) {
    const start = parseTimeToMinutes(r.start_time);
    const end = parseTimeToMinutes(r.end_time);
    if (start === null || end === null || start === end) continue;

    if (start < end) {
      coveredIntervals.push({ start, end, routine: r });
    } else {
      // Overnight
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
          start_minutes: 0,
          end_minutes: 1440,
          duration_minutes: 1440,
          is_overnight: false,
          is_unclassified: true
        }
      ],
      covered_minutes: 0,
      uncovered_minutes: 1440,
      is_full_day_covered: false
    };
  }

  coveredIntervals.sort((a, b) => a.start - b.start || a.end - b.end);

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

  if (uncoveredMinutes === 0) {
    return {
      gaps: [],
      covered_minutes: 1440,
      uncovered_minutes: 0,
      is_full_day_covered: true
    };
  }

  const gaps = [];

  if (merged[0].start > 0) {
    gaps.push({
      start_minutes: 0,
      end_minutes: merged[0].start,
      start_time: '00:00',
      end_time: minutesToClientTime24(merged[0].start),
      duration_minutes: merged[0].start,
      is_overnight: false,
      is_unclassified: true
    });
  }

  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i].end < merged[i + 1].start) {
      const dur = merged[i + 1].start - merged[i].end;
      const s24 = minutesToClientTime24(merged[i].end);
      const e24 = minutesToClientTime24(merged[i + 1].start);
      gaps.push({
        start_minutes: merged[i].end,
        end_minutes: merged[i + 1].start,
        start_time: s24,
        end_time: e24,
        duration_minutes: dur,
        is_overnight: false,
        is_unclassified: true
      });
    }
  }

  const last = merged[merged.length - 1];
  if (last.end < 1440) {
    const dur = 1440 - last.end;
    const s24 = minutesToClientTime24(last.end);
    gaps.push({
      start_minutes: last.end,
      end_minutes: 1440,
      start_time: s24,
      end_time: '00:00',
      duration_minutes: dur,
      is_overnight: false,
      is_unclassified: true
    });
  }

  return {
    gaps,
    covered_minutes: coveredMinutes,
    uncovered_minutes: uncoveredMinutes,
    is_full_day_covered: uncoveredMinutes === 0
  };
}

function renderRoutines(state) {
  const container = document.getElementById('routinesListContainer');
  if (!container) return;

  const currentGroup = state.activeRoutineGroup || 'weekdays';
  const settings = state.scheduleSettings || {
    weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    weekends_days: ['Saturday', 'Sunday'],
    routine_setup_status: 'pending'
  };

  // Update tabs active state
  const btnWeekdays = document.getElementById('btnGroupWeekdays');
  const btnWeekends = document.getElementById('btnGroupWeekends');
  if (btnWeekdays) btnWeekdays.classList.toggle('active', currentGroup === 'weekdays');
  if (btnWeekends) btnWeekends.classList.toggle('active', currentGroup === 'weekends');

  const btnCopyWeekdays = document.getElementById('btnCopyWeekdaysToWeekends');
  if (btnCopyWeekdays) {
    btnCopyWeekdays.style.display = (currentGroup === 'weekends') ? 'inline-flex' : 'none';
  }

  // Update tab subtitles
  const subWeekdays = document.getElementById('tabWeekdaysSubtitle');
  const subWeekends = document.getElementById('tabWeekendsSubtitle');
  if (subWeekdays) subWeekdays.textContent = formatDaysListSummary(settings.weekdays_days);
  if (subWeekends) subWeekends.textContent = formatDaysListSummary(settings.weekends_days);

  // Filter routines by active schedule group
  const allRoutines = Array.isArray(state.routines) ? state.routines : [];
  const routines = allRoutines.filter((r) => {
    const rGroup = r.schedule_group || 'weekdays';
    return rGroup === currentGroup;
  });

  const groupLabel = currentGroup === 'weekdays' ? 'Weekday' : 'Weekend';
  const groupDays = currentGroup === 'weekdays' ? (settings.weekdays_days || []) : (settings.weekends_days || []);

  // Empty state: exact required text
  if (!routines.length) {
    container.innerHTML = `
      <div class="schedule-starter-box" style="padding: 44px 24px; text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 12px;">⏰</div>
        <div class="schedule-starter-title" style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary); margin-bottom: 6px;">Your routine is not set up yet.</div>
        <p class="schedule-starter-body" style="max-width: 480px; margin: 8px auto 20px; font-size: 0.88rem; color: var(--text-secondary); line-height: 1.45;">
          Add your regular commitments so EKAGRA can understand your available time.
        </p>
        <div class="schedule-action-pair" style="justify-content: center;">
          <button class="btn-primary-emerald" onclick="openAddRoutineModal('${currentGroup}')">+ Add Routine</button>
        </div>
      </div>
    `;
    return;
  }

  // Calculate gaps and coverage
  const coverage = calculateClientDayGaps(routines);
  const coveredHours = Math.round((coverage.covered_minutes / 60) * 10) / 10;
  const uncoveredHours = Math.round((coverage.uncovered_minutes / 60) * 10) / 10;

  // Build timeline items chronologically in [0, 1440)
  const timelineItems = [];

  // Add routine commitments
  for (const r of routines) {
    const startMin = parseTimeToMinutes(r.start_time);
    const endMin = parseTimeToMinutes(r.end_time);
    if (startMin === null || endMin === null) continue;

    if (startMin < endMin) {
      // Normal within-day commitment
      timelineItems.push({
        type: 'commitment',
        start_minutes: startMin,
        end_minutes: endMin,
        start_time: r.start_time,
        end_time: r.end_time,
        duration_minutes: endMin - startMin,
        routine: r,
        is_overnight: false
      });
    } else {
      // Overnight commitment (e.g. 11:00 PM – 07:00 AM)
      // Displays at its start time at night with overnight indicator:
      timelineItems.push({
        type: 'commitment',
        start_minutes: startMin,
        end_minutes: 1440,
        start_time: r.start_time,
        end_time: r.end_time,
        duration_minutes: (1440 - startMin) + endMin,
        routine: r,
        is_overnight: true
      });
    }
  }

  // Add gaps
  for (const g of coverage.gaps) {
    timelineItems.push({
      type: 'gap',
      start_minutes: g.start_minutes,
      end_minutes: g.end_minutes,
      start_time: g.start_time,
      end_time: g.end_time,
      duration_minutes: g.duration_minutes,
      gap: g
    });
  }

  // Sort timeline chronologically by start_minutes
  timelineItems.sort((a, b) => a.start_minutes - b.start_minutes);

  // Render header card and timeline
  container.innerHTML = `
    <!-- Schedule Group Header Card -->
    <div class="routine-timeline-header-card">
      <div>
        <div class="routine-timeline-header-title">Your ${groupLabel} Routine</div>
        <div class="routine-timeline-header-sub">
          Applied on: <strong>${escapeHtml(formatDaysListFull(groupDays))}</strong>
        </div>
      </div>
      <div>
        ${coverage.is_full_day_covered
      ? `<span class="routine-coverage-badge complete">✓ 24-Hour Day Fully Covered</span>`
      : `<span class="routine-coverage-badge incomplete">⚠️ Incomplete: ${uncoveredHours} hrs unclassified</span>`
    }
      </div>
    </div>

    <!-- Subtle Incomplete Helper (if unclassified intervals remain) -->
    ${!coverage.is_full_day_covered ? `
      <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 12px; padding: 10px 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
        <div style="font-size: 0.82rem; color: var(--text-secondary);">
          <strong style="color: var(--status-at-risk-text);">${uncoveredHours} hours unclassified:</strong> Classify remaining gaps below so EKAGRA can schedule tasks into protected hours.
        </div>
        <button type="button" class="btn-secondary-pill" style="font-size: 0.74rem; padding: 4px 12px; flex-shrink: 0;" onclick="openFirstUnclassifiedGap('${currentGroup}')">Review Gaps</button>
      </div>
    ` : ''}

    <!-- Vertical Timeline -->
    <div class="routine-timeline-wrapper">
      ${timelineItems.map((item) => {
      if (item.type === 'commitment') {
        const r = item.routine;
        const typeClass = (r.type || 'Fixed').toLowerCase();
        const isFlex = typeClass === 'flexible';
        const isAvail = (r.availability_type === 'available');
        const iconHtml = getRoutineCategoryIcon(r.name);
        const durationStr = formatDurationHoursMinutes(item.duration_minutes);

        return `
            <div class="routine-timeline-item" id="routine-timeline-${r.id}">
              <div class="routine-timeline-time-col">
                <div class="routine-timeline-time-text">${formatTime12Hour(r.start_time)} – ${formatTime12Hour(r.end_time)}</div>
                <div class="routine-timeline-duration-sub">${durationStr}</div>
              </div>

              <div class="routine-timeline-spine">
                <div class="routine-timeline-dot ${isAvail ? 'available' : (isFlex ? 'flexible' : '')}"></div>
                <div class="routine-timeline-line"></div>
              </div>

              <div class="routine-timeline-content-card" id="routine-card-${r.id}">
                <div style="display: flex; align-items: center; gap: 14px;">
                  <div class="routine-type-icon-circle">
                    ${iconHtml}
                  </div>
                  <div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <span class="routine-title-lg">${escapeHtml(r.name)}</span>
                      ${item.is_overnight ? `<span class="routine-overnight-pill">🌙 Overnight</span>` : ''}
                      ${r.activity_classification ? `<span class="routine-category-badge">${escapeHtml(r.activity_classification)}</span>` : ''}
                      ${isAvail ? `<span class="routine-category-badge" style="background: rgba(6, 182, 212, 0.15); color: #06B6D4;">✨ Available for Tasks</span>` : ''}
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">
                      ${formatTime12Hour(r.start_time)} – ${formatTime12Hour(r.end_time)}
                    </div>
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 10px;">
                  <span class="routine-type-pill ${typeClass}">${escapeHtml(r.type || 'Fixed')}</span>
                  <div class="goal-card-actions">
                    <button type="button" class="btn-goal-action" title="Edit Routine" onclick="openEditRoutineModal('${r.id}')">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button type="button" class="btn-goal-action btn-goal-delete" title="Delete Routine" onclick="openDeleteRoutineModal('${r.id}')">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          `;
      } else if (item.type === 'gap') {
        const gap = item.gap;
        const durationStr = formatDurationHoursMinutes(gap.duration_minutes);

        return `
            <div class="routine-timeline-item">
              <div class="routine-timeline-time-col">
                <div class="routine-timeline-time-text" style="color: var(--text-muted);">${formatTime12Hour(gap.start_time)} – ${formatTime12Hour(gap.end_time)}</div>
                <div class="routine-timeline-duration-sub">${durationStr}</div>
              </div>

              <div class="routine-timeline-spine">
                <div class="routine-timeline-dot gap"></div>
                <div class="routine-timeline-line"></div>
              </div>

              <div class="routine-gap-card">
                <div>
                  <div class="routine-gap-title">Unclassified Gap (${durationStr})</div>
                  <div class="routine-gap-hint">Not accounted for • Excluded from task scheduling</div>
                </div>

                <div>
                  <button type="button" class="btn-secondary-pill" style="font-size: 0.78rem; padding: 6px 14px;" onclick="openClassifyGapModal('${gap.start_time}', '${gap.end_time}', '${currentGroup}')">
                    + Classify
                  </button>
                </div>
              </div>
            </div>
          `;
      }
    }).join('')}
    </div>
  `;
}

// ==========================================================================
// View 8: Insights & Analytics Hub (Screen 8)
// ==========================================================================

async function renderInsights(state) {
  let insightsData = null;
  try {
    const res = await fetch('/api/insights');
    if (res.ok) {
      insightsData = await res.json();
    }
  } catch (err) {
    console.warn('Insights fetch error:', err);
  }

  const isCold = Boolean(state.isColdStart || (!state.goals.length && !state.tasks.length));
  const metrics = insightsData?.metrics || {
    completed_tasks: (state.tasks || []).filter((t) => t.completed).length,
    focus_hours: 0,
    streak: 0
  };

  // KPIs (100% Real DB calculations)
  const kpiCompleted = document.getElementById('insightsKpiCompleted');
  const kpiFocusHours = document.getElementById('insightsKpiHours');
  const kpiStreak = document.getElementById('insightsKpiStreak');

  if (kpiCompleted) kpiCompleted.textContent = metrics.completed_tasks;
  if (kpiFocusHours) kpiFocusHours.textContent = `${metrics.focus_hours} hrs`;
  if (kpiStreak) kpiStreak.textContent = `${metrics.streak} days`;

  // Draw SVG Bezier Curve Chart with real productivity trend data
  const trend = insightsData?.productivity_trend;
  renderProductivityBezierChart(
    trend?.values || [0, 0, 0, 0, 0, 0, 0],
    trend?.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    Boolean(trend?.has_data)
  );

  // Draw SVG Doughnut Breakdown Ring Chart with real task breakdown
  const breakdown = insightsData?.task_breakdown;
  renderTaskBreakdownDonut(breakdown);

  // Dynamic ML Insights from Real Behavioral Pipeline
  const hubFeed = document.getElementById('insightsHubFeed');
  if (hubFeed) {
    if (insightsData && insightsData.success && insightsData.learning) {
      const pace = insightsData.learning.pace_factor || 1.0;
      const count = insightsData.learning.completed_count || 0;
      const calCount = (insightsData.learning && insightsData.learning.calibrated_count !== undefined)
        ? insightsData.learning.calibrated_count
        : count;
      const speedDesc = calCount < 3
        ? `Cold Start Calibration: default 1.0x pace active until 3 verified task durations (${calCount}/3 verified).`
        : `Calibrated from ${calCount} verified task durations.`;
      const b = insightsData.learning.bucket_stats || {};
      const cap = insightsData.capacity || {};
      const forecasts = insightsData.goal_forecasts || [];

      hubFeed.innerHTML = `
        <!-- Speed Learner Model Card -->
        <div class="insight-card-item" style="border-left: 3px solid var(--brand-emerald);">
          <div class="insight-type-icon peak">⚡</div>
          <div class="insight-content">
            <div class="insight-title">Speed Learner: Pace Factor ${pace}x</div>
            <div class="insight-desc">
              ${speedDesc}
            </div>
          </div>
        </div>

        <!-- Focus Quality & Slip Risk Buckets -->
        <div class="insight-card-item" style="border-left: 3px solid #06b6d4;">
          <div class="insight-type-icon focus">🎯</div>
          <div class="insight-content">
            <div class="insight-title">Focus Quality & Slip Risk by Time Bucket</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-top: 6px;">
              <div style="background: var(--surface-subtle); padding: 6px 8px; border-radius: 8px; font-size: 0.74rem;">
                <strong>Morning</strong>: ${Math.round((b.morning?.p_complete || 0.5) * 100)}%
                <div style="color: var(--text-muted);">Risk: ${Math.round((b.morning?.slip_risk || 0.5) * 100)}%</div>
              </div>
              <div style="background: var(--surface-subtle); padding: 6px 8px; border-radius: 8px; font-size: 0.74rem;">
                <strong>Afternoon</strong>: ${Math.round((b.afternoon?.p_complete || 0.5) * 100)}%
                <div style="color: var(--text-muted);">Risk: ${Math.round((b.afternoon?.slip_risk || 0.5) * 100)}%</div>
              </div>
              <div style="background: var(--surface-subtle); padding: 6px 8px; border-radius: 8px; font-size: 0.74rem;">
                <strong>Evening</strong>: ${Math.round((b.evening?.p_complete || 0.5) * 100)}%
                <div style="color: var(--text-muted);">Risk: ${Math.round((b.evening?.slip_risk || 0.5) * 100)}%</div>
              </div>
              <div style="background: var(--surface-subtle); padding: 6px 8px; border-radius: 8px; font-size: 0.74rem;">
                <strong>Night</strong>: ${Math.round((b.night?.p_complete || 0.5) * 100)}%
                <div style="color: var(--text-muted);">Risk: ${Math.round((b.night?.slip_risk || 0.5) * 100)}%</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Available Routine Capacity -->
        <div class="insight-card-item" style="border-left: 3px solid #8b5cf6;">
          <div class="insight-type-icon">📅</div>
          <div class="insight-content">
            <div class="insight-title">Routine Availability: ${Math.round((cap.daily_available_mins || 0) / 60 * 10) / 10} hrs/day</div>
            <div class="insight-desc">
              Weekdays: ${Math.round((cap.weekday?.available_mins || 0) / 60 * 10) / 10}h free (${Math.round((cap.weekday?.busy_mins || 0) / 60 * 10) / 10}h fixed) • 
              Weekends: ${Math.round((cap.weekend?.available_mins || 0) / 60 * 10) / 10}h free (${Math.round((cap.weekend?.busy_mins || 0) / 60 * 10) / 10}h fixed)
            </div>
          </div>
        </div>

        <!-- Goal Health Rolling-Velocity Forecasts -->
        ${forecasts.length > 0 ? `
          <div class="insight-card-item" style="border-left: 3px solid #f59e0b;">
            <div class="insight-type-icon">📈</div>
            <div class="insight-content" style="width: 100%;">
              <div class="insight-title">Goal Velocity & Pacing Forecasts</div>
              <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px;">
                ${forecasts.map((g) => `
                  <div style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-subtle); padding: 6px 10px; border-radius: 8px; font-size: 0.78rem;">
                    <div>
                      <strong>${escapeHtml(g.title)}</strong>
                      <div style="font-size: 0.72rem; color: var(--text-muted);">${g.forecast.remaining_minutes}m left • Burn: ${g.forecast.burn_rate_mins_day}m/day</div>
                    </div>
                    <div style="text-align: right;">
                      <span class="category-pill" style="font-size: 0.72rem; ${g.forecast.status === 'On Track' ? 'background: rgba(16, 185, 129, 0.15); color: var(--brand-emerald);' : g.forecast.status === 'At Risk' ? 'background: rgba(245, 158, 11, 0.15); color: #f59e0b;' : 'background: rgba(239, 68, 68, 0.15); color: #ef4444;'}">${escapeHtml(g.forecast.status)}</span>
                      <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">${g.forecast.days_needed}d needed / ${g.forecast.days_left}d left</div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        ` : ''}
      `;
      return;
    }

    if (isCold || !state.insights.length) {
      hubFeed.innerHTML = `
        <div class="insight-calibration-box">
          <span class="calibration-badge">🔬 Awaiting Baseline</span>
          <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">Learning From Observation</div>
          <p class="calibration-text">EKAGRA builds your biological focus profile from real execution data. Meaningful insights unlock after 3 active sessions.</p>
        </div>
      `;
    } else {
      hubFeed.innerHTML = state.insights.map((ins) => `
        <div class="insight-card-item">
          <div class="insight-type-icon ${ins.type || 'peak'}">💡</div>
          <div class="insight-content">
            <div class="insight-title">${escapeHtml(ins.title)}</div>
            <div class="insight-desc">${escapeHtml(ins.detail)}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

// Interactive SVG Bezier Area Chart
function renderProductivityBezierChart(points = [0, 0, 0, 0, 0, 0, 0], days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], hasData = false) {
  const container = document.getElementById('productivityChartContainer');
  if (!container) return;

  const w = 540;
  const h = 180;
  const padding = 28;

  if (!hasData) {
    container.innerHTML = `
      <div style="height: 180px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--surface-subtle); border-radius: 12px; border: 1px dashed var(--card-border); padding: 16px; text-align: center;">
        <span style="font-size: 1.4rem; margin-bottom: 6px;">📈</span>
        <div style="font-size: 0.88rem; font-weight: 600; color: var(--text-primary);">No productivity data recorded yet</div>
        <p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Complete tasks to plot your real 7-day trend.</p>
      </div>
    `;
    return;
  }

  const maxVal = Math.max(...points, 60);
  const coords = points.map((val, idx) => {
    const x = padding + (idx * (w - 2 * padding)) / (points.length - 1);
    const y = h - padding - (val / maxVal) * (h - 2 * padding);
    return { x, y, val };
  });

  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const cpX1 = p0.x + (p1.x - p0.x) / 2;
    const cpY1 = p0.y;
    const cpX2 = p0.x + (p1.x - p0.x) / 2;
    const cpY2 = p1.y;
    pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
  }

  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${h - padding} L ${coords[0].x} ${h - padding} Z`;

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" style="width: 100%; height: 100%; overflow: visible;">
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10B981" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#10B981" stop-opacity="0.0"/>
        </linearGradient>
      </defs>

      <!-- Grid lines -->
      <line x1="${padding}" y1="${h - padding}" x2="${w - padding}" y2="${h - padding}" stroke="var(--card-border)" stroke-width="1"/>
      <line x1="${padding}" y1="${(h - padding) / 2}" x2="${w - padding}" y2="${(h - padding) / 2}" stroke="var(--card-border)" stroke-width="1" stroke-dasharray="3,3"/>

      <!-- Curve area & line -->
      <path d="${areaD}" fill="url(#curveGrad)"/>
      <path d="${pathD}" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round"/>

      <!-- Data Dots & Day Labels -->
      ${coords.map((c, i) => `
        <circle cx="${c.x}" cy="${c.y}" r="4" fill="#FFFFFF" stroke="#10B981" stroke-width="2"/>
        <text x="${c.x}" y="${h - 6}" font-size="10" font-family="var(--font-sans)" fill="var(--text-muted)" text-anchor="middle">${days[i] || ''}</text>
      `).join('')}
    </svg>
  `;
}

// Interactive SVG Doughnut Chart
function renderTaskBreakdownDonut(breakdown) {
  const container = document.getElementById('taskBreakdownDonutContainer');
  if (!container) return;

  const total = breakdown ? (breakdown.total || 0) : 0;
  const size = 160;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;

  if (!total || total === 0) {
    container.innerHTML = `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        <svg width="${size}" height="${size}">
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
            fill="transparent"
            stroke="var(--card-border)"
            stroke-width="${stroke}"
          />
        </svg>
        <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none;">
          <span style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary);">0 Tasks</span>
          <span style="font-size: 0.68rem; color: var(--text-muted);">No activity</span>
        </div>
      </div>
    `;
    return;
  }

  // When all tasks are completed, guarantee 100% Emerald Green (#10B981) ring
  if ((breakdown.completed || 0) >= total && total > 0) {
    container.innerHTML = `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        <svg width="${size}" height="${size}">
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
            fill="transparent"
            stroke="#10B981"
            stroke-width="${stroke}"
          />
        </svg>
        <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <span style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: #10B981;">
            ${total} / ${total}
          </span>
          <span style="font-size: 0.72rem; color: var(--brand-emerald); font-weight: 600;">
            Completed
          </span>
        </div>
      </div>
    `;
    return;
  }

  const completedPct = Math.round(((breakdown.completed || 0) / total) * 100);
  const scheduledPct = Math.round(((breakdown.scheduled || 0) / total) * 100);
  const missedPct = Math.round(((breakdown.missed || 0) / total) * 100);
  const unscheduledPct = Math.max(0, 100 - completedPct - scheduledPct - missedPct);

  const segments = [
    { name: 'Completed', pct: completedPct, color: '#10B981' },
    { name: 'Scheduled', pct: scheduledPct, color: '#06B6D4' },
    { name: 'Missed', pct: missedPct, color: '#F59E0B' },
    { name: 'Unscheduled', pct: unscheduledPct, color: '#8B5CF6' }
  ].filter((s) => s.pct > 0);

  let currentOffset = 0;
  const circlesHtml = segments.map((seg) => {
    const dash = (seg.pct / 100) * circ;
    const offset = currentOffset;
    currentOffset -= dash;
    return `
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
        fill="transparent"
        stroke="${seg.color}"
        stroke-width="${stroke}"
        stroke-dasharray="${dash} ${circ - dash}"
        stroke-dashoffset="${offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})"
      />
    `;
  }).join('');

  container.innerHTML = `
    <div style="position: relative; width: ${size}px; height: ${size}px;">
      <svg width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="transparent"
          stroke="var(--surface-subtle)"
          stroke-width="${stroke}"
        />
        ${circlesHtml}
      </svg>
      <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <span style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: var(--text-primary);">
          ${breakdown.completed || 0} / ${total}
        </span>
        <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">
          Completed
        </span>
      </div>
    </div>
  `;
}

// ==========================================================================
// View 9 & 10: Settings & Profile (Screens 9 & 10)
// ==========================================================================

function renderSettings(state) {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('.theme-choice-box').forEach((box) => {
    box.classList.toggle('active', box.getAttribute('data-theme-choice') === currentTheme);
  });

  const prefs = state.user_preferences || { notify_tasks: true, notify_goals: true, notify_weekly: true };
  const taskToggle = document.getElementById('settingNotifyTasks');
  const goalToggle = document.getElementById('settingNotifyGoals');
  const weeklyToggle = document.getElementById('settingNotifyWeekly');

  if (taskToggle) taskToggle.checked = Boolean(prefs.notify_tasks);
  if (goalToggle) goalToggle.checked = Boolean(prefs.notify_goals);
  if (weeklyToggle) weeklyToggle.checked = Boolean(prefs.notify_weekly);
}

window.handleNotificationSettingChange = async function (settingKey, isChecked) {
  const currentPrefs = Store.state.user_preferences || { notify_tasks: true, notify_goals: true, notify_weekly: true };
  const updatedPrefs = { ...currentPrefs, [settingKey]: isChecked };
  Store.state.user_preferences = updatedPrefs;

  try {
    const res = await fetch('/api/dashboard/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedPrefs)
    });
    const data = await res.json();
    if (data.success && data.settings) {
      Store.state.user_preferences = data.settings;
      showToast('Notification preferences updated.', 'info');
    }
  } catch (err) {
    console.error('Failed to update notification settings:', err);
    Store.state.user_preferences = currentPrefs;
    renderSettings(Store.state);
    showToast('Failed to save preferences.', 'error');
  }
};

window.handleSettingsChangePassword = async function () {
  const email = Store.state?.user?.email;
  if (!email) {
    showToast('Unable to determine account email.', 'error');
    return;
  }

  const btn = document.getElementById('btnSettingsChangePassword');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || `Password reset link sent to ${email}`, 'success');
    } else {
      showToast(data.error || 'Failed to request password reset.', 'error');
    }
  } catch (err) {
    console.error('Change password error:', err);
    showToast('Failed to send password reset request.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

window.handleEmailNotificationsClick = function () {
  const notifSection = document.getElementById('settingsNotificationsTitle');
  if (notifSection) {
    notifSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    notifSection.style.transition = 'color 0.3s ease';
    notifSection.style.color = 'var(--brand-emerald)';
    setTimeout(() => {
      notifSection.style.color = '';
    }, 1500);
  }
  showToast('Email alerts are dispatched based on your Notification preferences below.', 'info');
};

function renderProfile(state) {
  const user = state.user;
  const userName = user.name || 'User';

  const nameEl = document.getElementById('profileHubName');
  const emailEl = document.getElementById('profileHubEmail');
  const avatarEl = document.getElementById('profileHubAvatar');
  const joinedEl = document.getElementById('profileHubJoined');

  if (nameEl) nameEl.textContent = userName;
  if (emailEl) emailEl.textContent = user.email || '--';
  if (avatarEl) avatarEl.textContent = userName.charAt(0).toUpperCase();
  if (joinedEl && user.created_at) {
    joinedEl.textContent = new Date(user.created_at).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // Lifetime counts
  const countGoals = document.getElementById('profileStatGoals');
  const countTasks = document.getElementById('profileStatTasks');
  const countStreak = document.getElementById('profileStatStreak');

  if (countGoals) countGoals.textContent = state.goals.length;
  if (countTasks) countTasks.textContent = state.metrics.totalCompletedTasks || 0;
  if (countStreak) countStreak.textContent = `${state.metrics.streak} days`;
}

// ==========================================================================
// Modals: Add Goal, Add Task, Add Routine
// ==========================================================================

function initModals() {
  // Goal Priority buttons (Add Modal)
  document.querySelectorAll('.goal-priority-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.goal-priority-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Goal Priority buttons (Edit Modal)
  document.querySelectorAll('.edit-goal-priority-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.edit-goal-priority-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Task Priority buttons
  document.querySelectorAll('.task-priority-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.task-priority-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // Goal Form Submission (Add Goal - Zero Category)
  window.handleAddGoalFormSubmit = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const submitBtn = document.getElementById('addGoalSubmitBtn');
    return withActionLock('addGoal', submitBtn, 'Creating...', async () => {
      const title = document.getElementById('newGoalTitle').value.trim();
      const target_date = document.getElementById('newGoalDate').value;
      const desc = document.getElementById('newGoalDesc').value.trim();
      const selectedPriority = document.querySelector('.goal-priority-btn.selected')?.getAttribute('data-prio') || 'Medium';

      if (!title) {
        showToast('Goal Name is required.', 'error');
        return;
      }
      if (!target_date) {
        showToast('Target Date is required.', 'error');
        return;
      }

      try {
        const res = await fetch('/api/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            target_date,
            description: desc,
            priority: selectedPriority
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success || !data.goal) {
          showToast(data.error || 'Failed to create goal.', 'error');
          return;
        }

        const createdGoal = {
          ...data.goal,
          deadline: data.goal.target_date,
          health: data.goal.health || calculateGoalHealth(data.goal)
        };

        const updatedGoals = [createdGoal, ...Store.state.goals];
        const newActivity = {
          id: `a-${Date.now()}`,
          title: 'Added goal',
          subtitle: title,
          time: 'Just now'
        };

        Store.setState({
          goals: updatedGoals,
          isColdStart: false,
          lastCreatedGoalId: createdGoal.id,
          scheduleSettings: data.schedule_settings || Store.state.scheduleSettings,
          activities: [newActivity, ...Store.state.activities.slice(0, 9)]
        });

        // 1. Immediately switch to Goals view and display the goal in the Goals section
        switchView('goals');
        renderGoals(Store.state);
        renderHome(Store.state);

        // 2. Close the goal creation modal
        const goalForm = document.getElementById('addGoalForm');
        if (goalForm) goalForm.reset();
        window.closeModal('addGoalModal');

        // 3. If routine setup has not been completed or 24-hour routine coverage is incomplete, open routine setup modal
        if (data.show_routine_setup || data.routine_coverage_incomplete) {
          Store.setState({ routine_coverage_incomplete: true, is_routine_complete: false });
          window.openInitialRoutineModal();
        } else {
          showToast('Goal created successfully.', 'success');
          window.checkAndDisplayFirstTaskPrompt(Store.state);
        }
      } catch (err) {
        console.error('Goal creation failed:', err);
        showToast('Network error while creating goal.', 'error');
      }
    });
  };

  const goalForm = document.getElementById('addGoalForm');
  if (goalForm) {
    goalForm.addEventListener('submit', window.handleAddGoalFormSubmit);
  }

  // Goal Form Submission (Edit Goal - Zero Category)
  window.handleEditGoalFormSubmit = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const submitBtn = document.getElementById('editGoalSubmitBtn');
    return withActionLock('editGoal', submitBtn, 'Saving...', async () => {
      const id = document.getElementById('editGoalId').value;
      const title = document.getElementById('editGoalTitle').value.trim();
      const target_date = document.getElementById('editGoalDate').value;
      const desc = document.getElementById('editGoalDesc').value.trim();
      const selectedPriority = document.querySelector('.edit-goal-priority-btn.selected')?.getAttribute('data-prio') || 'Medium';

      if (!title) {
        showToast('Goal Name cannot be empty.', 'error');
        return;
      }
      if (!target_date) {
        showToast('Target Date cannot be empty.', 'error');
        return;
      }

      try {
        const res = await fetch(`/api/goals/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            target_date,
            description: desc,
            priority: selectedPriority
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success || !data.goal) {
          showToast(data.error || 'Failed to update goal.', 'error');
          return;
        }

        const updated = {
          ...data.goal,
          deadline: data.goal.target_date,
          health: data.goal.health || calculateGoalHealth(data.goal)
        };

        const updatedGoals = Store.state.goals.map((g) => (g.id === id ? updated : g));
        Store.setState({ goals: updatedGoals });

        // Immediately update UI without requiring page refresh
        renderGoals(Store.state);
        renderHome(Store.state);

        window.closeModal('editGoalModal');
        showToast('Goal updated successfully.', 'success');
      } catch (err) {
        console.error('Goal update failed:', err);
        showToast('Network error while updating goal.', 'error');
      }
    });
  };

  const editGoalForm = document.getElementById('editGoalForm');
  if (editGoalForm) {
    editGoalForm.addEventListener('submit', window.handleEditGoalFormSubmit);
  }

  // Delete Goal Confirmation Button
  const confirmDeleteBtn = document.getElementById('confirmDeleteGoalBtn');
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
      const modal = document.getElementById('deleteGoalModal');
      const goalId = modal?.dataset?.goalId;
      if (!goalId) return;

      const cancelBtn = document.getElementById('cancelDeleteGoalBtn');
      return withActionLock('deleteGoal', confirmDeleteBtn, 'Deleting...', async () => {
        if (cancelBtn) cancelBtn.disabled = true;
        try {
          const res = await fetch(`/api/goals/${goalId}`, {
            method: 'DELETE'
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast(data.error || 'Failed to delete goal.', 'error');
            return;
          }

          const updatedGoals = Store.state.goals.filter((g) => g.id !== goalId);
          Store.setState({ goals: updatedGoals });

          // Immediately update UI without requiring page refresh
          renderGoals(Store.state);
          renderHome(Store.state);

          window.closeModal('deleteGoalModal');
          showToast('Goal deleted successfully.', 'success');
        } catch (err) {
          console.error('Delete goal error:', err);
          showToast('Network error while deleting goal.', 'error');
        } finally {
          if (cancelBtn) cancelBtn.disabled = false;
        }
      });
    });
  }

  // Task Form Submission
  const taskForm = document.getElementById('addTaskForm');
  if (taskForm) {
    taskForm.addEventListener('submit', (e) => {
      window.handleAddTaskFormSubmit(e);
    });
  }

  // Confirm Delete Task Button Listener
  const confirmDeleteTaskBtn = document.getElementById('confirmDeleteTaskBtn');
  if (confirmDeleteTaskBtn) {
    confirmDeleteTaskBtn.addEventListener('click', async () => {
      const modal = document.getElementById('deleteTaskModal');
      const taskId = modal?.dataset?.taskId;
      if (!taskId) return;

      const task = (Store.state.tasks || []).find((t) => t.id === taskId);
      const goalId = task ? (task.goal_id || task.goalId) : null;

      return withActionLock('deleteTask', confirmDeleteTaskBtn, 'Deleting...', async () => {
        try {
          const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok) {
            showToast(data.error || 'Failed to delete task.', 'error');
            return;
          }

          const updatedTasks = (Store.state.tasks || []).filter((t) => t.id !== taskId);
          const updatedGoals = (Store.state.goals || []).map((g) => {
            if (g.id === goalId) {
              const goalTasks = (g.tasks || []).filter((t) => t.id !== taskId);
              const total = goalTasks.length;
              const comp = goalTasks.filter((t) => t.completed).length;
              const progress = total > 0 ? Math.round((comp / total) * 100) : 0;
              return {
                ...g,
                tasks: goalTasks,
                totalTasks: total,
                completedTasks: comp,
                progress,
                health: calculateGoalHealth({ ...g, progress })
              };
            }
            return g;
          });

          Store.setState({ tasks: updatedTasks, goals: updatedGoals });
          window.closeModal('deleteTaskModal');
          renderGoals(Store.state);
          renderHome(Store.state);
          showToast('Task deleted successfully.', 'success');
        } catch (err) {
          showToast('Network error while deleting task.', 'error');
        }
      });
    });
  }

  // Confirm Delete Routine Button Listener
  const confirmDeleteRoutineBtn = document.getElementById('confirmDeleteRoutineBtn');
  if (confirmDeleteRoutineBtn) {
    confirmDeleteRoutineBtn.addEventListener('click', async () => {
      const modal = document.getElementById('deleteRoutineModal');
      const routineId = modal?.dataset?.routineId;
      if (!routineId) return;

      return withActionLock('deleteRoutine', confirmDeleteRoutineBtn, 'Deleting...', async () => {
        try {
          const res = await fetch(`/api/routines/${routineId}`, { method: 'DELETE' });
          const data = await res.json();
          if (!res.ok) {
            showToast(data.error || 'Failed to delete routine.', 'error');
            return;
          }

          const updatedRoutines = data.routines || (Store.state.routines || []).filter((r) => r.id !== routineId);
          Store.setState({ routines: updatedRoutines });
          window.closeModal('deleteRoutineModal');
          renderRoutines(Store.state);
          showToast('Routine deleted successfully.', 'success');
        } catch (err) {
          showToast('Network error while deleting routine.', 'error');
        }
      });
    });
  }

  // Day Pill and Type Selector Click Delegation
  document.addEventListener('click', (e) => {
    const dayPill = e.target.closest('.day-pill-opt');
    if (dayPill) {
      dayPill.classList.toggle('selected');
    }
    const typeBtn = e.target.closest('.wizard-routine-type-btn, .routine-type-btn');
    if (typeBtn) {
      const parent = typeBtn.parentElement;
      if (parent) {
        parent.querySelectorAll('.priority-btn').forEach((b) => b.classList.remove('selected'));
        typeBtn.classList.add('selected');
      }
    }
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop-overlay').forEach((m) => m.classList.remove('open'));
      if (typeof window.updateGlobalRoutineBanner === 'function') {
        window.updateGlobalRoutineBanner(Store.state);
      }
    }
  });

  // Backdrop overlay click closes modals
  document.querySelectorAll('.modal-backdrop-overlay').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('open');
        if (typeof window.updateGlobalRoutineBanner === 'function') {
          window.updateGlobalRoutineBanner(Store.state);
        }
      }
    });
  });
}

window.openModal = function (modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('open');
  if (typeof window.updateGlobalRoutineBanner === 'function') {
    window.updateGlobalRoutineBanner(Store.state);
  }
};

window.openAddTaskModal = function (preselectedGoalId = null) {
  const modal = document.getElementById('addTaskModal');
  if (!modal) return;

  const form = document.getElementById('addTaskForm');
  if (form) form.reset();

  const titleInput = document.getElementById('newTaskTitle');
  if (titleInput) titleInput.value = '';

  const descInput = document.getElementById('newTaskDesc');
  if (descInput) descInput.value = '';

  const prioSelect = document.getElementById('newTaskPriority');
  if (prioSelect) prioSelect.value = 'Medium';

  const dueDateInput = document.getElementById('newTaskDueDate');
  if (dueDateInput) dueDateInput.value = '';

  // Reset duration to 30
  const durInput = document.getElementById('newTaskDuration');
  if (durInput) durInput.value = 30;

  // Clear AI notice and clarification boxes
  const notice = document.getElementById('newTaskAiNotice');
  if (notice) {
    notice.innerHTML = '';
    notice.style.display = 'none';
  }
  const clarifyBox = document.getElementById('newTaskAiClarification');
  if (clarifyBox) {
    clarifyBox.innerHTML = '';
    clarifyBox.style.display = 'none';
  }

  // Populate goals dropdown
  const goalSelect = document.getElementById('newTaskGoalId');
  if (goalSelect) {
    const goals = Array.isArray(Store.state.goals) ? Store.state.goals : [];
    goalSelect.innerHTML = `
      <option value="">📌 Independent Task (No Goal)</option>
      ${goals.map((g) => `<option value="${g.id}">🎯 ${escapeHtml(g.title || g.name)}</option>`).join('')}
    `;
    if (preselectedGoalId && goals.some((g) => g.id === preselectedGoalId)) {
      goalSelect.value = preselectedGoalId;
    } else {
      goalSelect.value = '';
    }
  }

  window.openModal('addTaskModal');
  setTimeout(() => {
    document.getElementById('newTaskTitle')?.focus();
  }, 100);
};

window.handleAddTaskFormSubmit = async function (e) {
  if (e) e.preventDefault();
  const titleInput = document.getElementById('newTaskTitle');
  const title = (titleInput?.value || '').trim();
  if (!title) {
    showToast('Task title is required.', 'error');
    titleInput?.focus();
    return;
  }

  const submitBtn = document.getElementById('newTaskSubmitBtn');
  return withActionLock('addTask', submitBtn, 'Creating...', async () => {
    const goalIdSelect = document.getElementById('newTaskGoalId');
    const goalId = (goalIdSelect && goalIdSelect.value) ? goalIdSelect.value : null;

    const descInput = document.getElementById('newTaskDesc');
    const description = (descInput?.value || '').trim();

    const prioritySelect = document.getElementById('newTaskPriority');
    const priority = prioritySelect?.value || 'Medium';

    const durationInput = document.getElementById('newTaskDuration');
    const duration = parseInt(durationInput?.value, 10) || 30;

    const dueDateInput = document.getElementById('newTaskDueDate');
    const dueDate = (dueDateInput?.value || '').trim() || null;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          goal_id: goalId,
          description,
          priority,
          duration_minutes: duration,
          due_date: dueDate
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.task) {
        showToast(data.error || 'Failed to create task.', 'error');
        return;
      }

      const newTask = data.task;
      const updatedTasks = [...(Store.state.tasks || []), newTask];

      let updatedGoals = Store.state.goals;
      if (data.goalProgress && newTask.goal_id) {
        updatedGoals = (Store.state.goals || []).map((g) => {
          if (g.id === newTask.goal_id) {
            const goalTasks = [...(g.tasks || []), newTask];
            return {
              ...g,
              tasks: goalTasks,
              totalTasks: data.goalProgress.totalTasks,
              completedTasks: data.goalProgress.completedTasks,
              progress: data.goalProgress.progress,
              health: calculateGoalHealth({ ...g, progress: data.goalProgress.progress })
            };
          }
          return g;
        });
      }

      const newActivity = {
        id: `a-${Date.now()}`,
        title: 'Added task',
        subtitle: title,
        time: 'Just now'
      };

      Store.setState({
        tasks: updatedTasks,
        goals: updatedGoals,
        isColdStart: false,
        activities: [newActivity, ...(Store.state.activities || []).slice(0, 9)]
      });

      closeModal('addTaskModal');
      const form = document.getElementById('addTaskForm');
      if (form) form.reset();

      await Store.loadTodaySchedule();
      await Store.loadInsights();

      renderGoals(Store.state);
      renderHome(Store.state);
      renderTasks(Store.state);
      if (Store.state.currentView === 'schedule') renderSchedule(Store.state);

      showToast(goalId ? 'Task added to goal.' : 'Independent task created.', 'success');
    } catch (err) {
      showToast('Network error while creating task.', 'error');
    }
  });
};

// ==========================================================================
// One-Time Initial Routine Setup & Day Customization Handlers
// ==========================================================================

const ALL_DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let initialSetupDays = {
  weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  weekends_days: ['Saturday', 'Sunday']
};
let initialSetupBlocks = [];

function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const str = timeStr.trim().toUpperCase();
  const match12 = str.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const meridian = match12[3];
    if (meridian) {
      if (meridian === 'AM') {
        if (hours === 12) hours = 0;
      } else if (meridian === 'PM') {
        if (hours !== 12) hours += 12;
      }
    }
    return hours * 60 + minutes;
  }
  const parts = str.split(':').map((p) => parseInt(p, 10));
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function timeToMins(t) {
  return parseTimeToMinutes(t);
}

function normalizeTo24Hour(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '00:00';
  const str = timeStr.trim().toUpperCase();
  const match12 = str.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = parseInt(match12[2], 10);
    const meridian = match12[3];
    if (meridian) {
      if (meridian === 'AM') {
        if (hours === 12) hours = 0;
      } else if (meridian === 'PM') {
        if (hours !== 12) hours += 12;
      }
    }
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return timeStr.trim();
}

function formatTime12Hour(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const str = timeStr.trim().toUpperCase();
  if (str.includes('AM') || str.includes('PM')) {
    const m = str.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/);
    if (m) {
      const hh = String(parseInt(m[1], 10)).padStart(2, '0');
      const mm = m[2];
      return `${hh}:${mm} ${m[3]}`;
    }
    return str;
  }
  const parts = str.split(':');
  if (parts.length < 2) return timeStr;
  let hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return timeStr;

  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  return `${hh}:${mm} ${ampm}`;
}

function parse24HourTo12HourComponents(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { hour: '08', minute: '00', ampm: 'AM' };
  }
  const str = timeStr.trim().toUpperCase();
  const match12 = str.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/);
  if (match12) {
    return {
      hour: String(parseInt(match12[1], 10)).padStart(2, '0'),
      minute: match12[2],
      ampm: match12[3]
    };
  }
  const parts = str.split(':');
  let h = parseInt(parts[0] || '8', 10);
  const m = parseInt(parts[1] || '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return {
    hour: String(h).padStart(2, '0'),
    minute: String(m).padStart(2, '0'),
    ampm
  };
}

function getTimePickerValue(prefix) {
  const hEl = document.getElementById(`${prefix}Hour`);
  const mEl = document.getElementById(`${prefix}Minute`);
  const aEl = document.getElementById(`${prefix}Ampm`);
  if (!hEl || !mEl || !aEl) return '';
  const hour = hEl.value;
  const minute = mEl.value;
  const ampm = aEl.value;
  return `${hour}:${minute} ${ampm}`;
}

function setTimePickerValue(prefix, timeStr) {
  const { hour, minute, ampm } = parse24HourTo12HourComponents(timeStr);
  const hEl = document.getElementById(`${prefix}Hour`);
  const mEl = document.getElementById(`${prefix}Minute`);
  const aEl = document.getElementById(`${prefix}Ampm`);
  if (hEl) hEl.value = hour;
  if (mEl) {
    const hasOption = Array.from(mEl.options).some((opt) => opt.value === minute);
    if (!hasOption) {
      const newOpt = document.createElement('option');
      newOpt.value = minute;
      newOpt.textContent = minute;
      mEl.appendChild(newOpt);
    }
    mEl.value = minute;
  }
  if (aEl) aEl.value = ampm;
}

function timeIntervalsCollide(s1, e1, s2, e2) {
  const intervals1 = s1 < e1 ? [[s1, e1]] : [[s1, 1440], [0, e1]];
  const intervals2 = s2 < e2 ? [[s2, e2]] : [[s2, 1440], [0, e2]];

  for (const [a1, b1] of intervals1) {
    for (const [a2, b2] of intervals2) {
      if (Math.max(a1, a2) < Math.min(b1, b2)) {
        return true;
      }
    }
  }
  return false;
}

function checkBlocksTimeOverlap(blocks, newBlock) {
  const sNew = timeToMins(newBlock.start_time);
  const eNew = timeToMins(newBlock.end_time);

  for (const b of blocks) {
    if (b.schedule_group !== newBlock.schedule_group) continue;
    if (b.id && newBlock.id && b.id === newBlock.id) continue;
    const sOld = timeToMins(b.start_time);
    const eOld = timeToMins(b.end_time);
    if (timeIntervalsCollide(sNew, eNew, sOld, eOld)) {
      return b;
    }
  }
  return null;
}

function validateInitialDays() {
  const errEl = document.getElementById('initialSetupErrorAlert');
  const msgEl = document.getElementById('initialSetupErrorMsg');
  const weekdays = initialSetupDays.weekdays_days || [];
  const weekends = initialSetupDays.weekends_days || [];

  if (!weekdays.length || !weekends.length) {
    if (errEl && msgEl) {
      msgEl.textContent = 'Both Weekdays and Weekends must have at least one assigned day.';
      errEl.style.display = 'flex';
    }
    return false;
  }

  const total = weekdays.length + weekends.length;
  const hasOverlap = weekdays.some((d) => weekends.includes(d));
  if (total !== 7 || hasOverlap) {
    if (errEl && msgEl) {
      msgEl.textContent = 'Every day must belong to exactly one group, and no days can overlap.';
      errEl.style.display = 'flex';
    }
    return false;
  }

  if (errEl) errEl.style.display = 'none';
  return true;
}

function renderInitialDaysRows() {
  const container = document.getElementById('initialDaysSelectorContainer');
  if (!container) return;

  const wSummary = document.getElementById('initialWeekdaysSummaryText');
  const eSummary = document.getElementById('initialWeekendsSummaryText');
  if (wSummary) {
    wSummary.textContent = initialSetupDays.weekdays_days.map((d) => d.slice(0, 3)).join(', ') || 'None';
  }
  if (eSummary) {
    eSummary.textContent = initialSetupDays.weekends_days.map((d) => d.slice(0, 3)).join(', ') || 'None';
  }

  container.innerHTML = ALL_DAYS_OF_WEEK.map((day) => {
    const isW = initialSetupDays.weekdays_days.includes(day);
    const isE = initialSetupDays.weekends_days.includes(day);
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: var(--card-bg); border-radius: 8px; border: 1px solid var(--card-border);">
        <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary);">${day}</span>
        <div style="display: flex; gap: 4px;">
          <button type="button" class="btn-preset-chip ${isW ? 'active' : ''}" style="${isW ? 'background: rgba(16, 185, 129, 0.2); border-color: var(--brand-emerald); color: var(--brand-emerald); font-weight: 700;' : ''}" onclick="toggleInitialDay('${day}', 'weekdays')">
            Weekdays
          </button>
          <button type="button" class="btn-preset-chip ${isE ? 'active' : ''}" style="${isE ? 'background: rgba(139, 92, 246, 0.2); border-color: var(--accent-purple); color: var(--accent-purple); font-weight: 700;' : ''}" onclick="toggleInitialDay('${day}', 'weekends')">
            Weekends
          </button>
        </div>
      </div>
    `;
  }).join('');

  validateInitialDays();
}

window.toggleInitialDay = function (day, targetGroup) {
  if (targetGroup === 'weekdays') {
    if (!initialSetupDays.weekdays_days.includes(day)) {
      initialSetupDays.weekdays_days.push(day);
    }
    initialSetupDays.weekends_days = initialSetupDays.weekends_days.filter((d) => d !== day);
  } else {
    if (!initialSetupDays.weekends_days.includes(day)) {
      initialSetupDays.weekends_days.push(day);
    }
    initialSetupDays.weekdays_days = initialSetupDays.weekdays_days.filter((d) => d !== day);
  }
  initialSetupDays.weekdays_days.sort((a, b) => ALL_DAYS_OF_WEEK.indexOf(a) - ALL_DAYS_OF_WEEK.indexOf(b));
  initialSetupDays.weekends_days.sort((a, b) => ALL_DAYS_OF_WEEK.indexOf(a) - ALL_DAYS_OF_WEEK.indexOf(b));
  renderInitialDaysRows();
};

let initialModalActiveGroup = 'weekdays';

function updateModalCoverageIndicators() {
  const weekdaysBlocks = initialSetupBlocks.filter((b) => b.schedule_group === 'weekdays');
  const weekendsBlocks = initialSetupBlocks.filter((b) => b.schedule_group === 'weekends');

  const weekdaysCoverage = calculateClientDayGaps(weekdaysBlocks);
  const weekendsCoverage = calculateClientDayGaps(weekendsBlocks);

  const wdMins = weekdaysCoverage.covered_minutes || 0;
  const weMins = weekendsCoverage.covered_minutes || 0;

  const pillWd = document.getElementById('modalCovPillWeekdays');
  const pillWe = document.getElementById('modalCovPillWeekends');
  if (pillWd) pillWd.textContent = `${Math.floor(wdMins / 60)}h ${wdMins % 60}m / 24h`;
  if (pillWe) pillWe.textContent = `${Math.floor(weMins / 60)}h ${weMins % 60}m / 24h`;

  const activeCov = initialModalActiveGroup === 'weekdays' ? weekdaysCoverage : weekendsCoverage;
  const activeMins = activeCov.covered_minutes || 0;
  const activeUncov = activeCov.uncovered_minutes || 0;
  const activePct = Math.min(100, Math.round((activeMins / 1440) * 100));

  const barFill = document.getElementById('modalCoverageMeterFill');
  const labelEl = document.getElementById('modalCoverageLabel');
  const remEl = document.getElementById('modalCoverageRemaining');

  if (barFill) barFill.style.width = `${activePct}%`;
  if (labelEl) labelEl.textContent = `${Math.floor(activeMins / 60)}h ${String(activeMins % 60).padStart(2, '0')}m / 24h covered (${activePct}%)`;
  if (remEl) remEl.textContent = activeCov.is_full_day_covered ? '✓ 100% Covered' : `${Math.floor(activeUncov / 60)}h ${String(activeUncov % 60).padStart(2, '0')}m unallocated`;
}

window.switchModalRoutineGroup = function (group) {
  initialModalActiveGroup = group;
  document.getElementById('modalTabWeekdays')?.classList.toggle('active', group === 'weekdays');
  document.getElementById('modalTabWeekends')?.classList.toggle('active', group === 'weekends');

  const groupSelect = document.getElementById('initialInputGroup');
  if (groupSelect) groupSelect.value = group;

  const groupLabel = document.getElementById('initialSetupGroupLabel');
  if (groupLabel) groupLabel.textContent = group === 'weekdays' ? 'Weekdays' : 'Weekends';

  const copyBox = document.getElementById('modalWeekendsCopyBox');
  if (copyBox) copyBox.style.display = group === 'weekends' ? 'flex' : 'none';

  renderInitialBlocksList();
  updateModalCoverageIndicators();
};

function renderInitialBlocksList() {
  const container = document.getElementById('initialRoutineBlocksList');
  if (!container) return;

  const groupBlocks = initialSetupBlocks.filter((b) => b.schedule_group === initialModalActiveGroup);

  if (!groupBlocks.length) {
    container.innerHTML = `<div style="font-size: 0.78rem; color: var(--text-muted); text-align: center; padding: 10px; background: var(--surface-subtle); border-radius: 8px;">No ${initialModalActiveGroup} routine blocks added yet. Click a suggestion above or enter your commitments.</div>`;
    updateModalCoverageIndicators();
    return;
  }

  container.innerHTML = groupBlocks.map((b) => {
    const groupBadge = b.schedule_group === 'weekdays'
      ? `<span style="background: rgba(16, 185, 129, 0.15); color: var(--brand-emerald); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">Weekdays</span>`
      : `<span style="background: rgba(139, 92, 246, 0.15); color: var(--accent-purple); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">Weekends</span>`;

    return `
      <div class="initial-block-item" style="display: flex; justify-content: space-between; align-items: center; background: var(--surface-subtle); padding: 6px 10px; border-radius: 8px; border: 1px solid var(--card-border);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-primary);">${escapeHtml(b.name)}</span>
          <span style="font-size: 0.78rem; color: var(--text-secondary);">${formatTime12Hour(b.start_time)} – ${formatTime12Hour(b.end_time)}</span>
          ${groupBadge}
          <span style="font-size: 0.72rem; color: var(--text-muted);">${b.type}</span>
        </div>
        <button type="button" class="initial-block-del" style="background: none; border: none; color: var(--accent-rose); cursor: pointer; font-size: 0.85rem;" onclick="removeInitialBlock('${b.id}')" title="Remove">✕</button>
      </div>
    `;
  }).join('');

  updateModalCoverageIndicators();
}

window.addInitialPresetBlock = function (name, startTime, endTime, group, type) {
  const errEl = document.getElementById('initialSetupErrorAlert');
  const msgEl = document.getElementById('initialSetupErrorMsg');
  const targetGroup = group || initialModalActiveGroup;

  const s24 = normalizeTo24Hour(startTime);
  const e24 = normalizeTo24Hour(endTime);

  const conflict = checkBlocksTimeOverlap(initialSetupBlocks, {
    name,
    start_time: s24,
    end_time: e24,
    schedule_group: targetGroup
  });

  if (conflict) {
    if (errEl && msgEl) {
      msgEl.textContent = `"${name}" (${formatTime12Hour(s24)}–${formatTime12Hour(e24)}) overlaps with "${conflict.name}" (${formatTime12Hour(conflict.start_time)}–${formatTime12Hour(conflict.end_time)}) in ${targetGroup}.`;
      errEl.style.display = 'flex';
    }
    return;
  }

  if (errEl) errEl.style.display = 'none';

  initialSetupBlocks.push({
    id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    start_time: s24,
    end_time: e24,
    schedule_group: targetGroup,
    type: type || 'Fixed'
  });

  renderInitialBlocksList();
};

window.addInitialCustomBlock = function () {
  const nameEl = document.getElementById('initialInputName');
  const groupEl = document.getElementById('initialInputGroup');
  const typeEl = document.getElementById('initialInputType');
  const errEl = document.getElementById('initialSetupErrorAlert');
  const msgEl = document.getElementById('initialSetupErrorMsg');

  const name = (nameEl?.value || '').trim();
  const startTime12 = getTimePickerValue('initialStart');
  const endTime12 = getTimePickerValue('initialEnd');
  const startTime = normalizeTo24Hour(startTime12);
  const endTime = normalizeTo24Hour(endTime12);
  const group = groupEl?.value || initialModalActiveGroup;
  const type = typeEl?.value || 'Fixed';

  if (!name) {
    if (errEl && msgEl) {
      msgEl.textContent = 'Routine name is required.';
      errEl.style.display = 'flex';
    }
    return;
  }
  if (!startTime || !endTime) {
    if (errEl && msgEl) {
      msgEl.textContent = 'Start and end times are required.';
      errEl.style.display = 'flex';
    }
    return;
  }
  if (startTime === endTime) {
    if (errEl && msgEl) {
      msgEl.textContent = 'Start and end time cannot be identical.';
      errEl.style.display = 'flex';
    }
    return;
  }

  const conflict = checkBlocksTimeOverlap(initialSetupBlocks, {
    name,
    start_time: startTime,
    end_time: endTime,
    schedule_group: group
  });

  if (conflict) {
    if (errEl && msgEl) {
      msgEl.textContent = `"${name}" (${formatTime12Hour(startTime)}–${formatTime12Hour(endTime)}) overlaps with "${conflict.name}" (${formatTime12Hour(conflict.start_time)}–${formatTime12Hour(conflict.end_time)}) in ${group}.`;
      errEl.style.display = 'flex';
    }
    return;
  }

  if (errEl) errEl.style.display = 'none';

  initialSetupBlocks.push({
    id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    start_time: startTime,
    end_time: endTime,
    schedule_group: group,
    type
  });

  if (nameEl) nameEl.value = '';
  renderInitialBlocksList();
};

window.removeInitialBlock = function (id) {
  initialSetupBlocks = initialSetupBlocks.filter((b) => b.id !== id);
  renderInitialBlocksList();
};

let initialSetupGaps = [];
let initialSetupClassifiedGaps = {};

window.openInitialRoutineModal = function (forceOpen = false) {
  const settings = Store.state.scheduleSettings || {
    weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    weekends_days: ['Saturday', 'Sunday'],
    routine_setup_status: 'pending'
  };

  initialSetupDays = {
    weekdays_days: [...(settings.weekdays_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])],
    weekends_days: [...(settings.weekends_days || ['Saturday', 'Sunday'])]
  };

  // Pre-load initialSetupBlocks with existing user routines so user does not lose previous work
  initialSetupBlocks = [];
  if (Array.isArray(Store.state.routines) && Store.state.routines.length > 0) {
    initialSetupBlocks = Store.state.routines.map((r) => ({
      id: r.id || `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: r.name,
      start_time: r.start_time,
      end_time: r.end_time,
      schedule_group: r.schedule_group || 'weekdays',
      type: r.type || 'Fixed',
      availability_type: r.availability_type || 'busy'
    }));
  }

  initialSetupGaps = [];
  initialSetupClassifiedGaps = {};

  // Clear inputs and kill browser autofill
  const inp = document.getElementById('initialInputName');
  if (inp) {
    inp.value = '';
    inp.setAttribute('readonly', 'true');
  }

  const step1 = document.getElementById('initialSetupStep1');
  const step2 = document.getElementById('initialSetupStep2');
  const footer1 = document.getElementById('initialSetupFooterStep1');
  const footer2 = document.getElementById('initialSetupFooterStep2');
  const titleEl = document.getElementById('initialSetupModalTitle');
  const subEl = document.getElementById('initialSetupModalSubtitle');

  if (step1) step1.style.display = 'block';
  if (step2) step2.style.display = 'none';
  if (footer1) footer1.style.display = 'flex';
  if (footer2) footer2.style.display = 'none';
  if (titleEl) titleEl.textContent = 'Set Up Your Daily Routine';
  if (subEl) subEl.textContent = "Tell EKAGRA when you're busy so we can understand when you are available for your tasks.";

  const errEl = document.getElementById('initialSetupErrorAlert');
  if (errEl) errEl.style.display = 'none';

  setTimePickerValue('initialStart', '08:00');
  setTimePickerValue('initialEnd', '15:00');

  const startGroup = Store.state.incomplete_group === 'weekends' ? 'weekends' : 'weekdays';
  renderInitialDaysRows();
  switchModalRoutineGroup(startGroup);

  window.openModal('initialRoutineModal');
};

function renderInitialGapsReview(gaps) {
  const container = document.getElementById('initialSetupGapsList');
  if (!container) return;
  initialSetupGaps = gaps || [];

  if (!initialSetupGaps.length) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--brand-emerald); font-weight: 700;">
        ✓ Your entire 24-hour day is accounted for!
      </div>
    `;
    return;
  }

  container.innerHTML = initialSetupGaps.map((gap, idx) => {
    const timeDisplay = `${formatTime12Hour(gap.start_time)} – ${formatTime12Hour(gap.end_time)}`;
    const durDisplay = formatDurationHoursMinutes(gap.duration_minutes);
    const existing = initialSetupClassifiedGaps[idx] || {};

    return `
      <div class="gap-classify-item" id="gap-card-${idx}" style="background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 12px 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 0.88rem; font-weight: 700; color: var(--text-primary); font-feature-settings: 'tnum';">
            ⏱️ ${timeDisplay}
          </span>
          <span style="font-size: 0.76rem; color: var(--text-muted); font-weight: 600;">
            ${durDisplay}
          </span>
        </div>

        <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;">
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'Sleep / Rest' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'Sleep / Rest', 'Fixed', 'busy')">🌙 Sleep / Rest</button>
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'Meals' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'Meals', 'Fixed', 'busy')">🍽️ Meals</button>
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'Travel' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'Travel', 'Fixed', 'busy')">🚗 Travel</button>
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'College / Work' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'College / Work', 'Fixed', 'busy')">🏛️ College / Work</button>
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'Exercise' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'Exercise', 'Flexible', 'busy')">🏃 Exercise</button>
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'Personal / Family Time' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'Personal / Family Time', 'Flexible', 'busy')">👥 Personal / Family</button>
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'Flexible Time' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'Flexible Time', 'Flexible', 'flexible')">⏳ Flexible Time</button>
          <button type="button" class="interval-classify-chip ${existing.activity_classification === 'Usually Available' ? 'selected' : ''}" onclick="selectInitialGapClassification(${idx}, 'Usually Available', 'Flexible', 'available')">✨ Usually Available</button>
        </div>

        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="text" id="initialGapName_${idx}" class="modal-input" placeholder="Or type custom activity..." value="${escapeHtml(existing.name || '')}" style="font-size: 0.8rem; padding: 6px 10px; flex: 1;" oninput="updateInitialGapCustomName(${idx})">
          <label style="font-size: 0.76rem; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap;">
            <input type="checkbox" id="initialGapFlex_${idx}" ${existing.type === 'Flexible' ? 'checked' : ''} onchange="updateInitialGapFlexibility(${idx})"> Flexible
          </label>
        </div>
      </div>
    `;
  }).join('');
}

window.selectInitialGapClassification = function (idx, activityName, type, availType) {
  const gap = initialSetupGaps[idx];
  if (!gap) return;

  const flexBox = document.getElementById(`initialGapFlex_${idx}`);
  const isFlex = flexBox ? flexBox.checked : (type === 'Flexible');
  const activeGrp = (typeof initialModalActiveGroup !== 'undefined' ? initialModalActiveGroup : 'weekdays');

  initialSetupClassifiedGaps[idx] = {
    name: activityName,
    start_time: gap.start_time,
    end_time: gap.end_time,
    schedule_group: activeGrp,
    type: isFlex ? 'Flexible' : type,
    activity_classification: activityName,
    availability_type: availType,
    is_reviewed: 1
  };

  const nameInput = document.getElementById(`initialGapName_${idx}`);
  if (nameInput) nameInput.value = activityName;

  renderInitialGapsReview(initialSetupGaps);
};

window.updateInitialGapCustomName = function (idx) {
  const gap = initialSetupGaps[idx];
  if (!gap) return;
  const nameInput = document.getElementById(`initialGapName_${idx}`);
  const flexBox = document.getElementById(`initialGapFlex_${idx}`);
  const val = (nameInput?.value || '').trim();

  if (!val) {
    delete initialSetupClassifiedGaps[idx];
    return;
  }

  const isFlex = flexBox ? flexBox.checked : false;
  const isAvail = val.toLowerCase().includes('available') || val.toLowerCase().includes('free');
  const activeGrp = (typeof initialModalActiveGroup !== 'undefined' ? initialModalActiveGroup : 'weekdays');

  initialSetupClassifiedGaps[idx] = {
    name: val,
    start_time: gap.start_time,
    end_time: gap.end_time,
    schedule_group: activeGrp,
    type: isFlex ? 'Flexible' : 'Fixed',
    activity_classification: val,
    availability_type: isAvail ? 'available' : (isFlex ? 'flexible' : 'busy'),
    is_reviewed: 1
  };
};

window.updateInitialGapFlexibility = function (idx) {
  const flexBox = document.getElementById(`initialGapFlex_${idx}`);
  if (initialSetupClassifiedGaps[idx] && flexBox) {
    initialSetupClassifiedGaps[idx].type = flexBox.checked ? 'Flexible' : 'Fixed';
  }
};

window.skipInitialRoutineSetup = function () {
  window.closeModal('initialRoutineModal');
  // Temporary dismissal for the current session; does NOT mark routine complete
  sessionStorage.setItem('ekagra_routine_dismissed_session', 'true');
  Store.setState({ routine_coverage_incomplete: true, is_routine_complete: false });
  if (typeof window.updateGlobalRoutineBanner === 'function') {
    window.updateGlobalRoutineBanner(Store.state);
  }
  renderGoals(Store.state);
  showToast('24-Hour Routine Incomplete — Set up your 24-hour availability so EKAGRA can schedule your goals.', 'warning');
  window.showFirstTaskNotification();
};

window.openInitialGapsStep = function () {
  if (!validateInitialDays()) return;
  const curGroup = (typeof initialModalActiveGroup !== 'undefined' ? initialModalActiveGroup : 'weekdays');
  const groupBlocks = initialSetupBlocks.filter((b) => (b.schedule_group || 'weekdays') === curGroup);
  const coverage = calculateClientDayGaps(groupBlocks);

  const step1 = document.getElementById('initialSetupStep1');
  const step2 = document.getElementById('initialSetupStep2');
  const footer1 = document.getElementById('initialSetupFooterStep1');
  const footer2 = document.getElementById('initialSetupFooterStep2');
  if (step1) step1.style.display = 'none';
  if (step2) step2.style.display = 'block';
  if (footer1) footer1.style.display = 'none';
  if (footer2) footer2.style.display = 'flex';

  const titleEl = document.getElementById('initialSetupModalTitle');
  const subEl = document.getElementById('initialSetupModalSubtitle');
  if (titleEl) titleEl.textContent = "Let's complete your daily routine.";
  if (subEl) subEl.textContent = "Some parts of your day are still unaccounted for. What do you usually do during these times?";

  renderInitialGapsReview(coverage.gaps);
};

window.backToInitialStep1 = function () {
  const step1 = document.getElementById('initialSetupStep1');
  const step2 = document.getElementById('initialSetupStep2');
  const footer1 = document.getElementById('initialSetupFooterStep1');
  const footer2 = document.getElementById('initialSetupFooterStep2');
  const titleEl = document.getElementById('initialSetupModalTitle');
  const subEl = document.getElementById('initialSetupModalSubtitle');

  if (step1) step1.style.display = 'block';
  if (step2) step2.style.display = 'none';
  if (footer1) footer1.style.display = 'flex';
  if (footer2) footer2.style.display = 'none';
  if (titleEl) titleEl.textContent = 'Set Up Your Daily Routine';
  if (subEl) subEl.textContent = "Tell EKAGRA when you're busy so we can understand when you are available for your tasks.";
};

window.saveInitialRoutineSetup = async function () {
  const errEl = document.getElementById('initialSetupErrorAlert');
  const msgEl = document.getElementById('initialSetupErrorMsg');

  if (!validateInitialDays()) {
    return;
  }

  await executeSaveInitialSetup(true);
};

window.saveInitialRoutineProgress = async function () {
  await executeSaveInitialSetup(false);
};

window.finishInitialRoutineSetup = async function () {
  await executeSaveInitialSetup(true);
};

async function executeSaveInitialSetup(isCompleting) {
  const errEl = document.getElementById('initialSetupErrorAlert');
  const msgEl = document.getElementById('initialSetupErrorMsg');

  if (!validateInitialDays()) {
    return;
  }

  const activeBtn = isCompleting
    ? (document.getElementById('finishInitialRoutineBtn') || document.getElementById('saveInitialRoutineBtn'))
    : (document.getElementById('saveProgressRoutineBtn') || document.getElementById('saveInitialRoutineBtn'));

  return withActionLock('executeSaveInitialSetup', activeBtn, isCompleting ? 'Saving routine...' : 'Saving progress...', async () => {
    // Combine initial commitments and any classified gaps
    const classifiedBlocks = Object.values(initialSetupClassifiedGaps).filter((g) => g && g.name);
    const allBlocksToSave = [...initialSetupBlocks, ...classifiedBlocks];

    try {
      const res = await fetch('/api/routines/initial-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekdays_days: initialSetupDays.weekdays_days,
          weekends_days: initialSetupDays.weekends_days,
          routines: allBlocksToSave
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (errEl && msgEl) {
          msgEl.textContent = data.error || 'Failed to save routine setup.';
          errEl.style.display = 'flex';
        }
        return;
      }

      sessionStorage.removeItem('ekagra_routine_dismissed_session');

      Store.setState({
        scheduleSettings: data.settings,
        routines: data.routines || [],
        routine_coverage_incomplete: false,
        is_routine_complete: true,
        needs_routine_setup: false
      });

      const banner = document.getElementById('globalRoutineIncompleteBanner');
      if (banner) {
        banner.style.display = 'none';
      }
      if (typeof window.updateGlobalRoutineBanner === 'function') {
        window.updateGlobalRoutineBanner(Store.state);
      }

      window.closeModal('initialRoutineModal');
      if (typeof renderGoals === 'function') renderGoals(Store.state);
      if (typeof renderRoutines === 'function') renderRoutines(Store.state);
      if (typeof renderScheduleCalendar === 'function') renderScheduleCalendar(Store.state);
      if (typeof renderInsights === 'function') renderInsights(Store.state);
      if (typeof updateDashboardCards === 'function') updateDashboardCards(Store.state);

      showToast(isCompleting ? 'Routine saved successfully!' : 'Routine progress saved! You can complete your remaining schedule anytime in Routines.', 'success');
      window.showFirstTaskNotification();
    } catch (e) {
      if (errEl && msgEl) {
        msgEl.textContent = 'Network error saving routine setup.';
        errEl.style.display = 'flex';
      }
    }
  });
}

// Gap Classification Modal Functions for Routines Section
window.openClassifyGapModal = function (startTime, endTime, group) {
  const startEl = document.getElementById('classifyGapStart');
  const endEl = document.getElementById('classifyGapEnd');
  const groupEl = document.getElementById('classifyGapGroup');
  const dispEl = document.getElementById('classifyGapTimeDisplay');
  const nameEl = document.getElementById('classifyGapName');
  const availEl = document.getElementById('classifyGapAvailType');

  if (startEl) startEl.value = startTime;
  if (endEl) endEl.value = endTime;
  if (groupEl) groupEl.value = group || Store.state.activeRoutineGroup || 'weekdays';
  if (dispEl) dispEl.textContent = `${formatTime12Hour(startTime)} – ${formatTime12Hour(endTime)}`;
  if (nameEl) {
    nameEl.value = '';
    nameEl.setAttribute('readonly', 'true');
  }
  if (availEl) availEl.value = 'busy';

  window.setClassifyGapType('Fixed');
  window.openModal('classifyGapModal');
};

window.openFirstUnclassifiedGap = function (group) {
  const currentGroup = group || Store.state.activeRoutineGroup || 'weekdays';
  const routines = (Store.state.routines || []).filter((r) => (r.schedule_group || 'weekdays') === currentGroup);
  const coverage = calculateClientDayGaps(routines);
  if (coverage.gaps.length > 0) {
    const firstGap = coverage.gaps[0];
    window.openClassifyGapModal(firstGap.start_time, firstGap.end_time, currentGroup);
  } else {
    showToast('Your entire schedule is fully covered!', 'info');
  }
};

window.selectGapPreset = function (activityName, type, availType) {
  const nameEl = document.getElementById('classifyGapName');
  const availEl = document.getElementById('classifyGapAvailType');
  if (nameEl) nameEl.value = activityName;
  if (availEl) availEl.value = availType || 'busy';
  window.setClassifyGapType(type);
};

window.setClassifyGapType = function (type) {
  const fixedBtn = document.getElementById('classifyTypeFixedBtn');
  const flexBtn = document.getElementById('classifyTypeFlexBtn');
  if (fixedBtn) fixedBtn.classList.toggle('selected', type === 'Fixed');
  if (flexBtn) flexBtn.classList.toggle('selected', type === 'Flexible');
};

window.handleClassifyGapSubmit = async function (e) {
  if (e && e.preventDefault) e.preventDefault();
  const startTime = document.getElementById('classifyGapStart')?.value;
  const endTime = document.getElementById('classifyGapEnd')?.value;
  const group = document.getElementById('classifyGapGroup')?.value || 'weekdays';
  const name = (document.getElementById('classifyGapName')?.value || '').trim();
  const isFlex = document.getElementById('classifyTypeFlexBtn')?.classList.contains('selected');
  const availType = document.getElementById('classifyGapAvailType')?.value || (name.toLowerCase().includes('available') ? 'available' : (isFlex ? 'flexible' : 'busy'));

  if (!name) {
    showToast('Please enter an activity name.', 'error');
    return;
  }

  const btn = document.querySelector('#classifyGapModal button[type="submit"]') || document.getElementById('classifyGapSubmitBtn');
  return withActionLock('classifyGap', btn, 'Saving...', async () => {
    try {
      const res = await fetch('/api/routines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          start_time: startTime,
          end_time: endTime,
          schedule_group: group,
          type: isFlex ? 'Flexible' : 'Fixed',
          activity_classification: name,
          availability_type: availType
        })
      });

      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to classify gap.', 'error');
        return;
      }

      const updatedRoutines = data.routines || [...(Store.state.routines || []), data.routine];
      Store.setState({
        routines: updatedRoutines,
        activeRoutineGroup: group
      });

      window.closeModal('classifyGapModal');
      renderRoutines(Store.state);
      showToast('Gap classified successfully!', 'success');
    } catch (err) {
      showToast('Network error classifying gap.', 'error');
    }
  });
};

window.openAddRoutineModalForGroup = function (group, event) {
  if (event) event.stopPropagation();
  window.closeModal('initialRoutineModal');
  window.openAddRoutineModal(group);
};

window.checkAndDisplayFirstTaskPrompt = function (state) {
  const banner = document.getElementById('firstTaskBanner');
  if (!banner) return;

  const current = state || Store.state;
  const routineStatus = current.scheduleSettings?.routine_setup_status || 'pending';
  if (routineStatus === 'pending') {
    banner.style.display = 'none';
    return;
  }

  const targetGoalId = current.lastCreatedGoalId || (current.goals?.length === 1 ? current.goals[0].id : null);
  if (!targetGoalId) {
    banner.style.display = 'none';
    return;
  }

  const targetGoal = (current.goals || []).find((g) => g.id === targetGoalId);
  if (!targetGoal || (targetGoal.tasks && targetGoal.tasks.length > 0)) {
    banner.style.display = 'none';
    return;
  }

  if (localStorage.getItem(`ekagra_first_task_dismissed_${targetGoalId}`) === 'true') {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
};

window.showFirstTaskNotification = function () {
  switchView('goals');
  window.checkAndDisplayFirstTaskPrompt(Store.state);
};

window.handleBannerAddFirstTask = function () {
  const banner = document.getElementById('firstTaskBanner');
  if (banner) banner.style.display = 'none';

  switchView('goals');

  const goalId = Store.state.lastCreatedGoalId || (Store.state.goals && Store.state.goals.length > 0 ? Store.state.goals[0].id : null);
  if (goalId) {
    if (!Store.state.expandedGoals) Store.state.expandedGoals = new Set();
    Store.state.expandedGoals.add(goalId);
    renderGoals(Store.state);

    setTimeout(() => {
      const card = document.getElementById(`goal-card-${goalId}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const titleInput = card.querySelector('.inline-task-title-input');
        if (titleInput) titleInput.focus();
      }
    }, 120);
  }
};

window.dismissFirstTaskBanner = function () {
  const goalId = Store.state.lastCreatedGoalId || (Store.state.goals?.length === 1 ? Store.state.goals[0].id : null);
  if (goalId) {
    localStorage.setItem(`ekagra_first_task_dismissed_${goalId}`, 'true');
  }
  const banner = document.getElementById('firstTaskBanner');
  if (banner) banner.style.display = 'none';
};

window.switchRoutineActiveGroup = function (group) {
  const btnWeekdays = document.getElementById('btnGroupWeekdays');
  const btnWeekends = document.getElementById('btnGroupWeekends');
  if (btnWeekdays) btnWeekdays.classList.toggle('active', group === 'weekdays');
  if (btnWeekends) btnWeekends.classList.toggle('active', group === 'weekends');
  const copyBtn = document.getElementById('btnCopyWeekdaysToWeekends');
  if (copyBtn) {
    copyBtn.style.display = (group === 'weekends') ? 'inline-flex' : 'none';
  }
  Store.setState({ activeRoutineGroup: group });
};

window.openCustomizeDaysModal = function () {
  const settings = Store.state.scheduleSettings || {
    weekdays_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    weekends_days: ['Saturday', 'Sunday']
  };

  Store.state.editingDayAssignments = {
    weekdays_days: [...(settings.weekdays_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])],
    weekends_days: [...(settings.weekends_days || ['Saturday', 'Sunday'])]
  };

  renderCustomizeDaysModalContent();
  window.openModal('customizeDaysModal');
};

function renderCustomizeDaysModalContent() {
  const container = document.getElementById('daysAssignmentRowsContainer');
  if (!container) return;

  const current = Store.state.editingDayAssignments;
  const weekdaysSummary = document.getElementById('daysAssignmentWeekdaysSummary');
  const weekendsSummary = document.getElementById('daysAssignmentWeekendsSummary');

  if (weekdaysSummary) {
    weekdaysSummary.textContent = current.weekdays_days.map((d) => d.slice(0, 3)).join(', ') || 'None';
  }
  if (weekendsSummary) {
    weekendsSummary.textContent = current.weekends_days.map((d) => d.slice(0, 3)).join(', ') || 'None';
  }

  container.innerHTML = ALL_DAYS_OF_WEEK.map((day) => {
    const isWeekday = current.weekdays_days.includes(day);
    const isWeekend = current.weekends_days.includes(day);

    return `
      <div class="day-assignment-row">
        <span class="day-assignment-name">${day}</span>
        <div class="day-segmented-control">
          <button type="button" class="day-segmented-btn ${isWeekday ? 'active weekdays' : ''}" onclick="toggleDayAssignment('${day}', 'weekdays')">
            Weekdays
          </button>
          <button type="button" class="day-segmented-btn ${isWeekend ? 'active weekends' : ''}" onclick="toggleDayAssignment('${day}', 'weekends')">
            Weekends
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.toggleDayAssignment = function (day, targetGroup) {
  const editing = Store.state.editingDayAssignments;
  if (!editing) return;

  if (targetGroup === 'weekdays') {
    if (editing.weekdays_days.includes(day)) return;
    if (editing.weekends_days.length <= 1 && editing.weekends_days.includes(day)) {
      showToast('Weekends schedule must have at least one assigned day.', 'error');
      return;
    }
    editing.weekends_days = editing.weekends_days.filter((d) => d !== day);
    if (!editing.weekdays_days.includes(day)) editing.weekdays_days.push(day);
  } else {
    if (editing.weekends_days.includes(day)) return;
    if (editing.weekdays_days.length <= 1 && editing.weekdays_days.includes(day)) {
      showToast('Weekdays schedule must have at least one assigned day.', 'error');
      return;
    }
    editing.weekdays_days = editing.weekdays_days.filter((d) => d !== day);
    if (!editing.weekends_days.includes(day)) editing.weekends_days.push(day);
  }

  editing.weekdays_days.sort((a, b) => ALL_DAYS_OF_WEEK.indexOf(a) - ALL_DAYS_OF_WEEK.indexOf(b));
  editing.weekends_days.sort((a, b) => ALL_DAYS_OF_WEEK.indexOf(a) - ALL_DAYS_OF_WEEK.indexOf(b));

  renderCustomizeDaysModalContent();
};

window.saveDayAssignmentsSubmit = async function () {
  const editing = Store.state.editingDayAssignments;
  if (!editing) return;

  if (!editing.weekdays_days.length || !editing.weekends_days.length) {
    showToast('Both Weekdays and Weekends must have at least one day assigned.', 'error');
    return;
  }

  const btn = document.querySelector('#customizeDaysModal .btn-primary-emerald') || document.getElementById('saveDaysSettingsBtn');
  return withActionLock('saveDayAssignments', btn, 'Saving...', async () => {
    try {
      const res = await fetch('/api/routines/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekdays_days: editing.weekdays_days,
          weekends_days: editing.weekends_days
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to update schedule day assignments.', 'error');
        return;
      }

      Store.setState({
        scheduleSettings: data.settings,
        editingDayAssignments: null
      });

      window.closeModal('customizeDaysModal');
      renderRoutines(Store.state);
      showToast('Schedule day assignments updated successfully.', 'success');
    } catch (e) {
      showToast('Network error updating day assignments.', 'error');
    }
  });
};

window.setRoutineFormGroup = function (group) {
  document.querySelectorAll('#routineGroupSelector .routine-group-select-btn').forEach((b) => {
    b.classList.toggle('selected', b.getAttribute('data-group') === group);
  });
  const hintEl = document.getElementById('routineGroupAssignedHint');
  const settings = Store.state.scheduleSettings;
  if (hintEl && settings) {
    const days = group === 'weekdays' ? settings.weekdays_days : settings.weekends_days;
    hintEl.textContent = `Applies to: ${(days || []).join(', ')}`;
  }
  window.setRoutineDaysForGroup(group);
};

window.setRoutineDaysForGroup = function (group) {
  const settings = Store.state.scheduleSettings;
  const assigned = group === 'weekdays'
    ? (settings?.weekdays_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])
    : (settings?.weekends_days || ['Saturday', 'Sunday']);
  const abbrs = assigned.map((d) => d.slice(0, 3).toLowerCase());

  document.querySelectorAll('#routineDaysPills .day-pill-opt').forEach((pill) => {
    const pillDay = pill.getAttribute('data-day').toLowerCase();
    pill.classList.toggle('selected', abbrs.includes(pillDay));
  });
};

window.openAddRoutineModal = function (preselectedGroup) {
  const form = document.getElementById('routineForm');
  if (form && typeof form.reset === 'function') form.reset();
  const idEl = document.getElementById('routineModalEditId');
  if (idEl) idEl.value = '';
  const nameEl = document.getElementById('routineInputName');
  if (nameEl) {
    nameEl.value = '';
    nameEl.setAttribute('readonly', 'true');
  }
  const titleEl = document.getElementById('routineModalTitle');
  if (titleEl) titleEl.textContent = 'Add Routine Block';
  const alertEl = document.getElementById('routineConflictAlert');
  if (alertEl) alertEl.style.display = 'none';

  const classEl = document.getElementById('routineInputClassification');
  if (classEl) classEl.value = '';

  setTimePickerValue('routineStart', '08:00');
  setTimePickerValue('routineEnd', '16:00');

  const group = preselectedGroup || Store.state.activeRoutineGroup || 'weekdays';
  window.setRoutineFormGroup(group);

  document.querySelectorAll('#routineTypePills .routine-type-btn').forEach((b) => {
    b.classList.toggle('selected', b.getAttribute('data-type') === 'Fixed');
  });
  window.updateRoutineOvernightIndicator();
  window.openModal('addRoutineModal');
};

window.openEditRoutineModal = function (routineId) {
  const routine = (Store.state.routines || []).find((r) => r.id === routineId);
  if (!routine) return;

  const idEl = document.getElementById('routineModalEditId');
  const nameEl = document.getElementById('routineInputName');
  const classEl = document.getElementById('routineInputClassification');
  const titleEl = document.getElementById('routineModalTitle');
  const alertEl = document.getElementById('routineConflictAlert');

  if (idEl) idEl.value = routine.id;
  if (nameEl) nameEl.value = routine.name || '';
  if (classEl) classEl.value = routine.activity_classification || '';
  setTimePickerValue('routineStart', routine.start_time || '08:00');
  setTimePickerValue('routineEnd', routine.end_time || '16:00');
  if (titleEl) titleEl.textContent = 'Edit Routine Block';
  if (alertEl) alertEl.style.display = 'none';

  const group = routine.schedule_group || 'weekdays';
  window.setRoutineFormGroup(group);

  const days = Array.isArray(routine.days) ? routine.days : (typeof routine.days === 'string' ? JSON.parse(routine.days || '[]') : []);
  const dayAbbrs = days.map((d) => d.slice(0, 3).toLowerCase());
  document.querySelectorAll('#routineDaysPills .day-pill-opt').forEach((pill) => {
    const pillDay = pill.getAttribute('data-day').toLowerCase();
    pill.classList.toggle('selected', dayAbbrs.includes(pillDay));
  });

  const type = routine.type || 'Fixed';
  document.querySelectorAll('#routineTypePills .routine-type-btn').forEach((b) => {
    b.classList.toggle('selected', b.getAttribute('data-type') === type);
  });

  window.updateRoutineOvernightIndicator();
  window.openModal('addRoutineModal');
};

window.handleRoutineFormSubmit = async function (event) {
  event.preventDefault();
  const id = document.getElementById('routineModalEditId')?.value;
  const name = (document.getElementById('routineInputName')?.value || '').trim();
  const activity_classification = document.getElementById('routineInputClassification')?.value || '';
  const start_time_12 = getTimePickerValue('routineStart');
  const end_time_12 = getTimePickerValue('routineEnd');
  const start_time = normalizeTo24Hour(start_time_12);
  const end_time = normalizeTo24Hour(end_time_12);
  const alertEl = document.getElementById('routineConflictAlert');
  const msgEl = document.getElementById('routineConflictMsg');

  if (!name) {
    showToast('Routine Name is required.', 'error');
    return;
  }
  if (!start_time || !end_time) {
    showToast('Start and end times are required.', 'error');
    return;
  }

  const selectedGroup = document.querySelector('#routineGroupSelector .routine-group-select-btn.selected')?.getAttribute('data-group') || Store.state.activeRoutineGroup || 'weekdays';

  // Use group's assigned days as default if pills not individually customized
  const settings = Store.state.scheduleSettings;
  const groupDays = selectedGroup === 'weekdays' ? (settings?.weekdays_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) : (settings?.weekends_days || ['Saturday', 'Sunday']);
  const defaultGroupAbbrs = groupDays.map((d) => d.slice(0, 3));

  let selectedDays = Array.from(document.querySelectorAll('#routineDaysPills .day-pill-opt.selected')).map((b) => b.getAttribute('data-day'));
  if (!selectedDays.length) {
    selectedDays = defaultGroupAbbrs;
  }

  const type = document.querySelector('#routineTypePills .routine-type-btn.selected')?.getAttribute('data-type') || 'Fixed';

  const submitBtn = document.getElementById('routineSubmitBtn') || document.querySelector('#addRoutineModal button[type="submit"]');
  return withActionLock('routineSubmit', submitBtn, 'Saving...', async () => {
    try {
      const url = id ? `/api/routines/${id}` : '/api/routines';
      const method = id ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          start_time,
          end_time,
          days: selectedDays,
          type,
          schedule_group: selectedGroup,
          activity_classification
        })
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && alertEl && msgEl) {
          msgEl.textContent = data.error || 'This time slot overlaps an existing routine block.';
          alertEl.style.display = 'flex';
        } else {
          showToast(data.error || 'Failed to save routine.', 'error');
        }
        return;
      }

      if (alertEl) alertEl.style.display = 'none';

      let updatedRoutines = data.routines;
      if (!updatedRoutines) {
        if (id) {
          updatedRoutines = (Store.state.routines || []).map((r) => (r.id === id ? data.routine : r));
        } else {
          updatedRoutines = [...(Store.state.routines || []), data.routine];
        }
      }

      Store.setState({
        routines: updatedRoutines,
        activeRoutineGroup: selectedGroup
      });
      window.closeModal('addRoutineModal');
      renderRoutines(Store.state);
      showToast(id ? 'Routine updated successfully.' : 'Routine added successfully.', 'success');
    } catch (err) {
      showToast('Network error saving routine.', 'error');
    }
  });
};

window.openDeleteRoutineModal = function (routineId) {
  const routine = (Store.state.routines || []).find((r) => r.id === routineId);
  if (!routine) return;

  const modal = document.getElementById('deleteRoutineModal');
  if (modal) modal.dataset.routineId = routineId;

  const titleEl = document.getElementById('deleteRoutineTargetTitle');
  if (titleEl) titleEl.textContent = `"${routine.name}"`;

  window.openModal('deleteRoutineModal');
};

window.setRoutineDaysPreset = function (preset) {
  const pills = document.querySelectorAll('#routineDaysPills .day-pill-opt');
  pills.forEach((p) => {
    const day = p.getAttribute('data-day');
    if (preset === 'all') {
      p.classList.add('selected');
    } else if (preset === 'weekdays') {
      p.classList.toggle('selected', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day));
    } else if (preset === 'weekends') {
      p.classList.toggle('selected', ['Sat', 'Sun'].includes(day));
    }
  });
};

window.updateRoutineOvernightIndicator = function () {
  const start12 = getTimePickerValue('routineStart');
  const end12 = getTimePickerValue('routineEnd');
  const hintEl = document.getElementById('routineOvernightHint');
  if (!hintEl) return;

  const startMin = parseTimeToMinutes(start12);
  const endMin = parseTimeToMinutes(end12);
  if (startMin !== null && endMin !== null && startMin > endMin) {
    hintEl.style.display = 'block';
  } else {
    hintEl.style.display = 'none';
  }
};

window.toggleGoalExpand = function (goalId) {
  if (!Store.state.expandedGoals) Store.state.expandedGoals = new Set();
  const isNowExpanded = !Store.state.expandedGoals.has(goalId);
  if (isNowExpanded) {
    Store.state.expandedGoals.add(goalId);
  } else {
    Store.state.expandedGoals.delete(goalId);
  }

  const card = document.getElementById(`goal-card-${goalId}`);
  const drawer = document.getElementById(`goal-tasks-drawer-${goalId}`);
  if (card && drawer) {
    const btn = card.querySelector('.btn-toggle-goal-tasks');
    drawer.classList.toggle('expanded', isNowExpanded);
    if (btn) {
      btn.classList.toggle('expanded', isNowExpanded);
      const textSpan = btn.querySelector('span');
      if (textSpan) {
        const goalTasks = (Store.state.tasks || []).filter((t) => t.goal_id === goalId || t.goalId === goalId);
        textSpan.textContent = `${isNowExpanded ? 'Hide Tasks' : 'Tasks'} (${goalTasks.length})`;
      }
    }
  } else {
    renderGoals(Store.state);
  }
};
window.toggleGoalTasks = window.toggleGoalExpand;

window.handleInlineTaskCreate = async function (event, goalId) {
  if (event && event.preventDefault) event.preventDefault();
  const form = event.target || event.currentTarget;
  const submitBtn = form?.querySelector('button[type="submit"]') || form?.querySelector('.btn-primary-emerald');
  const lockKey = `inline-add-task-${goalId}`;

  return withActionLock(lockKey, submitBtn, 'Adding...', async () => {
    const titleInput = form?.querySelector('.inline-task-title-input');
    const prioSelect = form?.querySelector('.inline-task-prio-select');
    const descInput = form?.querySelector('.inline-task-desc-input');
    const durationInput = form?.querySelector('.inline-task-duration-input');
    const dueDateInput = form?.querySelector('.inline-task-due-input');

    const title = (titleInput?.value || '').trim();
    const priority = prioSelect?.value || 'Medium';
    const desc = (descInput?.value || '').trim();
    const duration = parseInt(durationInput?.value, 10) || null;
    const dueDate = dueDateInput?.value || null;

    if (!title) {
      showToast('Task title is required.', 'error');
      titleInput?.focus();
      return;
    }

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          goal_id: goalId,
          description: desc,
          priority,
          duration_minutes: duration,
          due_date: dueDate
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.task) {
        showToast(data.error || 'Failed to create task.', 'error');
        return;
      }

      const newTask = data.task;
      const updatedTasks = [...(Store.state.tasks || []), newTask];

      const updatedGoals = (Store.state.goals || []).map((g) => {
        if (g.id === goalId) {
          const goalTasks = [...(g.tasks || []), newTask];
          const total = goalTasks.length;
          const comp = goalTasks.filter((t) => t.completed).length;
          const progress = total > 0 ? Math.round((comp / total) * 100) : 0;
          return {
            ...g,
            tasks: goalTasks,
            totalTasks: total,
            completedTasks: comp,
            progress,
            health: calculateGoalHealth({ ...g, progress })
          };
        }
        return g;
      });

      if (!Store.state.expandedGoals) Store.state.expandedGoals = new Set();
      Store.state.expandedGoals.add(goalId);

      // Dismiss first-task banner upon creating task for this goal
      localStorage.setItem(`ekagra_first_task_dismissed_${goalId}`, 'true');
      const banner = document.getElementById('firstTaskBanner');
      if (banner) banner.style.display = 'none';

      // Clear the inline inputs on success
      if (form && typeof form.reset === 'function') form.reset();
      const aiNotice = form?.querySelector('.inline-ai-notice');
      if (aiNotice) {
        aiNotice.innerHTML = '';
        aiNotice.style.display = 'none';
      }
      const clarifyBox = form?.querySelector('.inline-ai-clarification-box');
      if (clarifyBox) {
        clarifyBox.innerHTML = '';
        clarifyBox.style.display = 'none';
      }

      Store.setState({ tasks: updatedTasks, goals: updatedGoals });
      renderGoals(Store.state);
      renderHome(Store.state);
      showToast('Task added to goal.', 'success');
    } catch (err) {
      showToast('Network error while adding task.', 'error');
    }
  }, 'Please wait — adding task...');
};

window.toggleTaskCompletion = async function(taskId, goalId, el) {
  const checkboxEl = (el && el.nodeType === 1) ? el : document.querySelector(`.task-checkbox-custom[onclick*="${taskId}"], .goal-task-checkbox[onclick*="${taskId}"]`);
  return withActionLock('toggle_task_' + taskId, checkboxEl, null, async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/toggle`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to update task completion.', 'error');
        return;
      }

      const updatedTask = data.task;
      const updatedTasks = (Store.state.tasks || []).map((t) => (t.id === taskId ? updatedTask : t));

      const updatedGoals = (Store.state.goals || []).map((g) => {
        if (g.id === goalId || (g.tasks && g.tasks.some((t) => t.id === taskId))) {
          const goalTasks = (g.tasks || []).map((t) => (t.id === taskId ? updatedTask : t));
          const total = goalTasks.length;
          const comp = goalTasks.filter((t) => t.completed).length;
          const progress = total > 0 ? Math.round((comp / total) * 100) : 0;
          return {
            ...g,
            tasks: goalTasks,
            totalTasks: total,
            completedTasks: comp,
            progress,
            health: calculateGoalHealth({ ...g, progress })
          };
        }
        return g;
      });

      Store.setState({ tasks: updatedTasks, goals: updatedGoals });
      await Store.loadTodaySchedule();
      await Store.loadInsights();
      renderGoals(Store.state);
      renderHome(Store.state);
      renderTasks(Store.state);
      if (Store.state.currentView === 'schedule') renderSchedule(Store.state);
      if (Store.state.currentView === 'insights') renderInsights(Store.state);
    } catch (err) {
      showToast('Network error updating task.', 'error');
    }
  }, 'Please wait — updating task...');
};

window.openEditTaskModal = function (taskId) {
  const task = (Store.state.tasks || []).find((t) => t.id === taskId);
  if (!task) return;

  const idEl = document.getElementById('editTaskId');
  const goalIdEl = document.getElementById('editTaskGoalId');
  const titleEl = document.getElementById('editTaskTitle');
  const descEl = document.getElementById('editTaskDesc');
  const prioEl = document.getElementById('editTaskPriority');
  const durEl = document.getElementById('editTaskDuration');
  const dueEl = document.getElementById('editTaskDueDate');
  const noticeEl = document.getElementById('editTaskAiNotice');

  if (idEl) idEl.value = task.id;
  if (goalIdEl) goalIdEl.value = task.goal_id || task.goalId || '';
  if (titleEl) titleEl.value = task.title || '';
  if (descEl) descEl.value = task.description || '';
  if (prioEl) prioEl.value = task.priority || 'Medium';
  if (durEl) durEl.value = task.duration_minutes || '';
  if (dueEl) dueEl.value = task.due_date || '';
  if (noticeEl) noticeEl.style.display = 'none';

  window.openModal('editTaskModal');
};

window.handleEditTaskFormSubmit = async function (event) {
  event.preventDefault();
  const taskId = document.getElementById('editTaskId')?.value;
  const goalId = document.getElementById('editTaskGoalId')?.value;
  const title = (document.getElementById('editTaskTitle')?.value || '').trim();
  const desc = (document.getElementById('editTaskDesc')?.value || '').trim();
  const priority = document.getElementById('editTaskPriority')?.value || 'Medium';
  const duration = parseInt(document.getElementById('editTaskDuration')?.value, 10) || null;
  const dueDate = document.getElementById('editTaskDueDate')?.value || null;

  if (!taskId || !title) {
    showToast('Task title cannot be empty.', 'error');
    return;
  }

  const submitBtn = document.getElementById('editTaskSubmitBtn') || document.querySelector('#editTaskModal button[type="submit"]');
  return withActionLock('editTask', submitBtn, 'Saving...', async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: desc,
          priority,
          duration_minutes: duration,
          due_date: dueDate
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || 'Failed to update task.', 'error');
        return;
      }

      const updatedTask = data.task;
      const updatedTasks = (Store.state.tasks || []).map((t) => (t.id === taskId ? updatedTask : t));

      const updatedGoals = (Store.state.goals || []).map((g) => {
        if (g.id === goalId || (g.tasks && g.tasks.some((t) => t.id === taskId))) {
          const goalTasks = (g.tasks || []).map((t) => (t.id === taskId ? updatedTask : t));
          const total = goalTasks.length;
          const comp = goalTasks.filter((t) => t.completed).length;
          const progress = total > 0 ? Math.round((comp / total) * 100) : 0;
          return {
            ...g,
            tasks: goalTasks,
            totalTasks: total,
            completedTasks: comp,
            progress,
            health: calculateGoalHealth({ ...g, progress })
          };
        }
        return g;
      });

      Store.setState({ tasks: updatedTasks, goals: updatedGoals });
      window.closeModal('editTaskModal');
      await Store.loadTodaySchedule();
      renderGoals(Store.state);
      renderHome(Store.state);
      renderTasks(Store.state);
      if (Store.state.currentView === 'schedule') renderSchedule(Store.state);
      showToast('Task updated successfully.', 'success');
    } catch (err) {
      showToast('Network error while updating task.', 'error');
    }
  });
};

window.openDeleteTaskModal = function (taskId) {
  const task = (Store.state.tasks || []).find((t) => t.id === taskId);
  if (!task) return;

  const modal = document.getElementById('deleteTaskModal');
  if (modal) modal.dataset.taskId = taskId;

  const titleEl = document.getElementById('deleteTaskTargetTitle');
  if (titleEl) titleEl.textContent = `"${task.title}"`;

  window.openModal('deleteTaskModal');
};

/* ==========================================================================
   AI TASK DURATION ESTIMATION, SMART CLARIFICATION & PROVIDER SETTINGS
   ========================================================================== */

window.ekagraAiSettings = null;
let pendingEstimateResumeCallback = null;

// Fetch AI settings for authenticated user
async function fetchAiSettings() {
  try {
    const res = await fetch('/api/tasks/ai-settings');
    if (!res.ok) return null;
    const data = await res.json();
    if (data.success && data.settings) {
      window.ekagraAiSettings = data.settings;
      return data.settings;
    }
  } catch (err) {
    console.warn('[EKAGRA AI] Could not fetch settings:', err);
  }
  return null;
}
window.fetchAiSettings = fetchAiSettings;

// Load settings into Settings Page view
async function loadAiSettingsIntoSettingsPage(options = {}) {
  const card = document.getElementById('aiSettingsCard');
  if (!card) return;

  const badge = document.getElementById('aiSettingsStatusBadge');
  const keyStatusPill = document.getElementById('aiKeyStatusPill');
  const savedKeyVal = document.getElementById('aiSettingsSavedKeyVal');
  const openModalBtn = document.getElementById('openAiKeyModalBtn');
  const removeKeyBtn = document.getElementById('removeAiKeyBtn');
  const feedbackMsg = document.getElementById('aiSettingsFeedbackMsg');

  if (feedbackMsg && !options.preserveFeedback) {
    feedbackMsg.style.display = 'none';
  }

  const settings = await fetchAiSettings();
  if (!settings) {
    if (badge) {
      badge.textContent = '⚪ Not configured';
      badge.className = 'ai-status-badge ai-status-pending';
    }
    if (keyStatusPill) {
      keyStatusPill.textContent = 'Not configured';
      keyStatusPill.className = 'ai-key-status-pill';
    }
    if (savedKeyVal) savedKeyVal.textContent = 'None configured';
    if (openModalBtn) openModalBtn.textContent = 'Add API Key';
    if (removeKeyBtn) removeKeyBtn.style.display = 'none';
    return;
  }

  // Key status and masked key display
  if (settings.hasKey) {
    if (keyStatusPill) {
      keyStatusPill.textContent = 'Connected';
      keyStatusPill.className = 'ai-key-status-pill active';
    }
    if (savedKeyVal) {
      savedKeyVal.textContent = settings.keyHint || '••••••••';
    }
    if (openModalBtn) {
      openModalBtn.textContent = 'Change API Key';
    }
    if (removeKeyBtn) {
      removeKeyBtn.style.display = 'inline-block';
    }
    if (badge) {
      badge.textContent = '🟢 Connected';
      badge.className = 'ai-status-badge ai-status-ready';
    }
  } else {
    if (keyStatusPill) {
      keyStatusPill.textContent = 'Not configured';
      keyStatusPill.className = 'ai-key-status-pill';
    }
    if (savedKeyVal) {
      savedKeyVal.textContent = 'None configured';
    }
    if (openModalBtn) {
      openModalBtn.textContent = 'Add API Key';
    }
    if (removeKeyBtn) {
      removeKeyBtn.style.display = 'none';
    }
    if (badge) {
      badge.textContent = settings.defaultAvailable ? '🟢 Server Ready' : '⚪ Not configured';
      badge.className = settings.defaultAvailable ? 'ai-status-badge ai-status-ready' : 'ai-status-badge ai-status-pending';
    }
  }
}
window.loadAiSettingsIntoSettingsPage = loadAiSettingsIntoSettingsPage;

// Open Gemini Key Modal
window.openGeminiKeyModal = function () {
  const modalInput = document.getElementById('modalGeminiApiKey');
  const errorMsg = document.getElementById('modalAiKeyErrorMsg');
  const title = document.getElementById('aiKeyModalTitle');
  const saveBtn = document.getElementById('saveModalAiKeyBtn');

  // Never prefill existing saved key!
  if (modalInput) {
    modalInput.value = '';
    modalInput.type = 'password';
  }

  const eyeBtn = document.getElementById('toggleModalKeyEyeBtn');
  if (eyeBtn) eyeBtn.textContent = '👁️';

  if (errorMsg) errorMsg.style.display = 'none';

  const hasKey = Boolean(window.ekagraAiSettings && window.ekagraAiSettings.hasKey);
  if (title) {
    title.textContent = hasKey ? 'Change Gemini API Key' : 'Add Gemini API Key';
  }
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save API Key';
  }

  window.openModal('aiKeyModal');
  setTimeout(() => modalInput?.focus(), 150);
};

// Handle saving key from the modal
window.handleSaveAiKeyFromModal = async function (event) {
  if (event && event.preventDefault) event.preventDefault();

  const modalInput = document.getElementById('modalGeminiApiKey');
  const errorMsg = document.getElementById('modalAiKeyErrorMsg');
  const saveBtn = document.getElementById('saveModalAiKeyBtn');
  const feedback = document.getElementById('aiSettingsFeedbackMsg');
  const apiKey = (modalInput?.value || '').trim();

  if (!apiKey) {
    if (errorMsg) {
      errorMsg.textContent = '⚠️ Please enter a valid Gemini API key.';
      errorMsg.className = 'inline-ai-notice ai-notice-error';
      errorMsg.style.display = 'block';
    }
    modalInput?.focus();
    return;
  }

  return withActionLock('saveAiKey', saveBtn, 'Encrypting & Saving...', async () => {
    try {
      const res = await fetch('/api/tasks/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'user_key',
          provider: 'gemini',
          apiKey
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        window.ekagraAiSettings = data.settings;
        if (modalInput) modalInput.value = '';
        window.closeModal('aiKeyModal');

        // Reload settings UI from backend
        await loadAiSettingsIntoSettingsPage({ preserveFeedback: true });

        if (feedback) {
          feedback.innerHTML = `✅ <strong>Key saved:</strong> Gemini API key encrypted (AES-256-GCM) and connected.`;
          feedback.className = 'inline-ai-notice ai-notice-success';
          feedback.style.display = 'block';
        }
        showToast('Gemini API key encrypted and saved.', 'success');
      } else {
        // Keep modal open and preserve entered input
        if (errorMsg) {
          errorMsg.textContent = `❌ ${data.message || 'Failed to save API key.'}`;
          errorMsg.className = 'inline-ai-notice ai-notice-error';
          errorMsg.style.display = 'block';
        }
        modalInput?.focus();
      }
    } catch (err) {
      // Keep modal open and preserve entered input
      if (errorMsg) {
        errorMsg.textContent = '❌ Network error saving API key. Please check your connection.';
        errorMsg.className = 'inline-ai-notice ai-notice-error';
        errorMsg.style.display = 'block';
      }
    }
  });
};

// Remove personal key from settings
window.removePersonalApiKeyFromSettings = async function () {
  const btn = document.querySelector('[onclick="removePersonalApiKeyFromSettings()"]');
  return withActionLock('removeAiKey', btn, 'Removing...', async () => {
    const feedback = document.getElementById('aiSettingsFeedbackMsg');
    try {
      const res = await fetch('/api/tasks/ai-settings/key', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        window.ekagraAiSettings = data.settings;
        await loadAiSettingsIntoSettingsPage({ preserveFeedback: true });
        if (feedback) {
          feedback.innerHTML = 'ℹ️ <strong>Key removed:</strong> Your personal Gemini API key has been securely removed.';
          feedback.className = 'inline-ai-notice ai-notice-info';
          feedback.style.display = 'block';
        }
        showToast('Gemini API key removed.', 'info');
      }
    } catch (err) {
      console.error('[EKAGRA AI] Failed to remove key:', err);
    }
  });
};

// Test connection endpoint caller
window.testAiProviderConnection = async function () {
  const testBtn = document.getElementById('testAiConnectionBtn');
  const feedback = document.getElementById('aiSettingsFeedbackMsg');

  if (feedback) feedback.style.display = 'none';

  return withActionLock('testAiConnection', testBtn, 'Testing connection...', async () => {
    try {
      const res = await fetch('/api/tasks/ai-settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();

      if (!feedback) return;

      if (data.success && data.status === 'SUCCESS') {
        feedback.className = 'inline-ai-notice ai-notice-success';
        feedback.innerHTML = `✅ <strong>Connected:</strong> ${data.message || 'Connection verified! Gemini is connected and responding.'}`;
        feedback.style.display = 'block';
        showToast('AI connection verified successfully.', 'success');
      } else if (data.status === 'QUOTA_EXCEEDED') {
        feedback.className = 'inline-ai-notice ai-notice-error';
        const quotaMsg = data.message || 'Your Gemini API quota is currently unavailable. Check your Google AI Studio usage and rate limits, or try again later.';
        feedback.innerHTML = `⚠️ <strong>Quota Unavailable:</strong> ${quotaMsg} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; color: inherit; font-weight: 600; margin-left: 4px;">Check Google AI Studio ↗</a>`;
        feedback.style.display = 'block';
      } else if (data.status === 'UNSUPPORTED_KEY_TYPE') {
        feedback.className = 'inline-ai-notice ai-notice-error';
        feedback.innerHTML = `❌ <strong>Unsupported Key Type:</strong> ${escapeHtml(data.message || 'Standard Gemini API key required.')} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; color: inherit; font-weight: 600; margin-left: 4px;">Get Standard Key ↗</a>`;
        feedback.style.display = 'block';
      } else if (data.status === 'PERMISSION_DENIED') {
        feedback.className = 'inline-ai-notice ai-notice-error';
        feedback.innerHTML = `🚫 <strong>Access Denied:</strong> ${escapeHtml(data.message || 'Google Gemini project has been denied access.')} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; color: inherit; font-weight: 600; margin-left: 4px;">Review Project ↗</a>`;
        feedback.style.display = 'block';
      } else if (data.status === 'INVALID_KEY') {
        feedback.className = 'inline-ai-notice ai-notice-error';
        feedback.innerHTML = `❌ <strong>Invalid Key:</strong> ${data.message || 'Invalid or unauthorized Gemini API key. Please check your key from Google AI Studio and update it.'} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; color: inherit; font-weight: 600; margin-left: 4px;">Get Key ↗</a>`;
        feedback.style.display = 'block';
      } else if (data.status === 'TEMPORARILY_UNAVAILABLE') {
        feedback.className = 'inline-ai-notice ai-notice-warning';
        feedback.innerHTML = `⏳ <strong>High Demand:</strong> ${data.message || 'The Gemini provider is experiencing high demand and is temporarily unavailable. Please try again later.'}`;
        feedback.style.display = 'block';
      } else if (data.status === 'TIMEOUT') {
        feedback.className = 'inline-ai-notice ai-notice-warning';
        feedback.innerHTML = `⏱️ <strong>Timeout:</strong> ${data.message || 'Connection test timed out. Please verify your connection or try again later.'}`;
        feedback.style.display = 'block';
      } else if (data.status === 'NOT_CONFIGURED') {
        feedback.className = 'inline-ai-notice ai-notice-warning';
        feedback.innerHTML = `⚠️ <strong>Not Configured:</strong> No Gemini API key has been added yet. Click <strong>Add API Key</strong> to connect your key.`;
        feedback.style.display = 'block';
      } else {
        feedback.className = 'inline-ai-notice ai-notice-error';
        feedback.innerHTML = `❌ <strong>Error:</strong> ${data.message || 'Provider connection test failed.'}`;
        feedback.style.display = 'block';
      }
    } catch (err) {
      if (feedback) {
        feedback.className = 'inline-ai-notice ai-notice-error';
        feedback.innerHTML = `❌ <strong>Network Error:</strong> Failed to connect to server: ${err.message}`;
        feedback.style.display = 'block';
      }
    }
  });
};

// Toggle API key password/text visibility
window.toggleApiKeyVisibility = function (inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
};

// Provider Selection Modal Handling
window.openAiProviderModal = async function (onConfiguredCallback) {
  pendingEstimateResumeCallback = onConfiguredCallback || null;
  const settings = window.ekagraAiSettings || await fetchAiSettings();

  const defaultBadge = document.getElementById('aiModalDefaultBadge');
  const defaultDesc = document.getElementById('aiModalDefaultDesc');
  const keyInputSection = document.getElementById('aiModalKeyInputSection');
  const notice = document.getElementById('aiModalNotice');

  if (notice) notice.style.display = 'none';

  if (settings && settings.defaultAvailable) {
    if (defaultBadge) {
      defaultBadge.textContent = '🟢 Available';
      defaultBadge.className = 'ai-badge-sm available';
    }
    if (defaultDesc) {
      defaultDesc.textContent = `Uses server default AI (${settings.defaultProvider || 'Gemini'}). Server usage limits apply.`;
    }
  } else {
    if (defaultBadge) {
      defaultBadge.textContent = '⚪ Not Configured';
      defaultBadge.className = 'ai-badge-sm';
    }
    if (defaultDesc) {
      defaultDesc.textContent = 'EKAGRA default AI is not currently enabled on this server. You can provide your own Gemini key below.';
    }
  }

  // Pre-select choice
  const initialMode = settings && settings.mode === 'user_key' ? 'user_key' : (settings && settings.defaultAvailable ? 'default' : 'user_key');
  selectAiModalChoice(initialMode);

  window.openModal('aiProviderSelectModal');
};

window.selectAiModalChoice = function (mode) {
  const defaultChoice = document.getElementById('aiModalChoiceDefault');
  const userKeyChoice = document.getElementById('aiModalChoiceUserKey');
  const radioDefault = document.getElementById('aiModalRadioDefault');
  const radioUserKey = document.getElementById('aiModalRadioUserKey');
  const keySection = document.getElementById('aiModalKeyInputSection');

  if (mode === 'default') {
    if (radioDefault) radioDefault.checked = true;
    if (defaultChoice) defaultChoice.classList.add('selected');
    if (userKeyChoice) userKeyChoice.classList.remove('selected');
    if (keySection) keySection.style.display = 'none';
  } else {
    if (radioUserKey) radioUserKey.checked = true;
    if (userKeyChoice) userKeyChoice.classList.add('selected');
    if (defaultChoice) defaultChoice.classList.remove('selected');
    if (keySection) keySection.style.display = 'block';
  }
};

window.confirmAiModalChoice = async function () {
  const radioUserKey = document.getElementById('aiModalRadioUserKey');
  const isUserKey = radioUserKey && radioUserKey.checked;
  const keyInput = document.getElementById('aiModalApiKeyInput');
  const notice = document.getElementById('aiModalNotice');
  const confirmBtn = document.getElementById('aiModalConfirmBtn');

  if (notice) notice.style.display = 'none';

  if (isUserKey) {
    const keyVal = (keyInput?.value || '').trim();
    const existingHasKey = window.ekagraAiSettings?.hasKey;

    if (!keyVal && !existingHasKey) {
      if (notice) {
        notice.textContent = '⚠️ Please enter a Google Gemini API key to use personal key mode.';
        notice.style.display = 'block';
      }
      keyInput?.focus();
      return;
    }

    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving...';
    }

    try {
      const res = await fetch('/api/tasks/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'user_key',
          provider: 'gemini',
          apiKey: keyVal || undefined
        })
      });
      const data = await res.json();
      if (!data.success) {
        if (notice) {
          notice.textContent = `❌ ${data.message || 'Failed to save settings.'}`;
          notice.style.display = 'block';
        }
        return;
      }
      window.ekagraAiSettings = data.settings;
      window.closeModal('aiProviderSelectModal');
      if (typeof pendingEstimateResumeCallback === 'function') {
        const cb = pendingEstimateResumeCallback;
        pendingEstimateResumeCallback = null;
        cb();
      }
    } catch (e) {
      if (notice) {
        notice.textContent = '❌ Network error saving AI settings.';
        notice.style.display = 'block';
      }
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Save & Proceed to Estimate';
      }
    }
  } else {
    // Default mode
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving...';
    }

    try {
      const res = await fetch('/api/tasks/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'default' })
      });
      const data = await res.json();
      if (!data.success) {
        if (notice) {
          notice.textContent = `❌ ${data.message || 'Failed to save settings.'}`;
          notice.style.display = 'block';
        }
        return;
      }
      window.ekagraAiSettings = data.settings;
      window.closeModal('aiProviderSelectModal');
      if (typeof pendingEstimateResumeCallback === 'function') {
        const cb = pendingEstimateResumeCallback;
        pendingEstimateResumeCallback = null;
        cb();
      }
    } catch (e) {
      if (notice) {
        notice.textContent = '❌ Network error saving AI settings.';
        notice.style.display = 'block';
      }
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Save & Proceed to Estimate';
      }
    }
  }
};

// Primary AI Estimate Handler
window.goToAiSettings = function () {
  if (typeof closeModal === 'function') {
    closeModal('newTaskModal');
    closeModal('editTaskModal');
    closeModal('aiProviderSelectModal');
    closeModal('aiKeyModal');
  }
  if (typeof switchView === 'function') {
    switchView('settings');
  }
  setTimeout(() => {
    const card = document.getElementById('aiSettingsCard');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlight-pulse');
      setTimeout(() => card.classList.remove('highlight-pulse'), 2000);
    }
  }, 100);
};

window.focusManualDurationInput = function (actionBtn) {
  const form = actionBtn?.closest('form') || actionBtn?.closest('.inline-task-create-box') || actionBtn?.closest('.modal-frosted-card') || document;
  const durationInput = form.querySelector('.inline-task-duration-input') || document.getElementById('editTaskDuration') || document.getElementById('wizardTaskDuration');
  if (durationInput) {
    durationInput.focus();
    if (durationInput.select) durationInput.select();
  }
};

window.handleAiEstimateClick = async function (btn, noticeSelector, inputSelector) {
  if (!btn) return;

  const form = btn.closest('form') || btn.closest('.inline-task-create-box') || btn.closest('.modal-frosted-card');
  const titleInput = form?.querySelector('.inline-task-title-input') || (noticeSelector ? document.querySelector('#newTaskTitle, #editTaskTitle') : null) || document.getElementById('newTaskTitle') || document.getElementById('editTaskTitle') || document.getElementById('wizardTaskTitle');
  const descInput = form?.querySelector('.inline-task-desc-input') || (noticeSelector ? document.querySelector('#newTaskDesc, #editTaskDesc') : null) || document.getElementById('newTaskDesc') || document.getElementById('editTaskDesc');
  const prioSelect = form?.querySelector('.inline-task-prio-select') || (noticeSelector ? document.querySelector('#newTaskPriority, #editTaskPriority') : null) || document.getElementById('newTaskPriority') || document.getElementById('editTaskPriority');
  const durationInput = inputSelector ? document.querySelector(inputSelector) : (form?.querySelector('.inline-task-duration-input') || document.getElementById('newTaskDuration'));
  const notice = noticeSelector ? document.querySelector(noticeSelector) : (form?.querySelector('.inline-ai-notice') || document.getElementById('newTaskAiNotice'));
  const clarifyBox = form?.querySelector('.inline-ai-clarification-box') || (noticeSelector ? document.querySelector('#newTaskAiClarification, #editTaskAiClarification') : null) || document.getElementById('newTaskAiClarification') || document.getElementById('editTaskAiClarification');

  const title = (titleInput?.value || '').trim();

  // 1. Validate title presence
  if (!title) {
    if (notice) {
      notice.innerHTML = '⚠️ Please enter a task title first to estimate duration.';
      notice.style.display = 'block';
    }
    titleInput?.focus();
    return;
  }

  // Derive unique action lock key for this button
  if (!btn._actionLockKey) {
    btn._actionLockKey = 'ai-estimate-' + (btn.id || (form?.id ? form.id : Math.random().toString(36).substring(2, 9)));
  }
  const lockKey = btn._actionLockKey;

  return withActionLock(lockKey, btn, 'Estimating...', async () => {
    // 2. Check provider configuration state
    let settings = window.ekagraAiSettings;
    if (!settings) {
      try {
        settings = await fetchAiSettings();
      } catch (_) { }
    }

    const hasKey = Boolean(settings && settings.hasKey);
    if (!hasKey) {
      const missingKeyHtml = `
        <div class="ai-missing-key-row" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <span>🔑 Please provide your Gemini API key in Settings → AI Settings to use AI Estimate (or enter duration manually).</span>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn-ai-choice-btn" onclick="goToAiSettings()">Go to AI Settings</button>
            <button type="button" class="btn-ai-choice-btn secondary" onclick="focusManualDurationInput(this)">Enter Manually</button>
          </div>
        </div>
      `;
      if (notice) {
        notice.innerHTML = missingKeyHtml;
        notice.style.display = 'block';
      }
      if (typeof showToast === 'function') {
        showToast('Please provide your Gemini API key in Settings → AI Settings to use AI Estimate (or enter duration manually).', 'info');
      }
      return;
    }

    // 3. Perform estimation request
    await executeEstimationRequest({
      btn,
      form,
      title,
      description: (descInput?.value || '').trim(),
      priority: prioSelect?.value || 'Medium',
      clarificationAnswer: null,
      durationInput,
      notice,
      clarifyBox,
      noticeSelector,
      inputSelector
    });
  }, 'Please wait — estimating duration...');
};

async function executeEstimationRequest({
  btn,
  originalBtnText = '✨ AI Estimate',
  form,
  title,
  description,
  priority,
  clarificationAnswer = null,
  clarificationHistory = [],
  durationInput,
  notice,
  clarifyBox,
  noticeSelector,
  inputSelector
}) {
  btn._isEstimating = true;
  btn.disabled = true;
  btn.innerHTML = '⏳ Estimating...';

  const clientController = new AbortController();
  const clientTimeoutTimer = setTimeout(() => {
    try { clientController.abort(); } catch (_) { }
  }, 16000); // 16s client safety timeout

  try {
    const res = await fetch('/api/tasks/estimate-duration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        priority,
        clarification_answer: clarificationAnswer,
        clarification_history: clarificationHistory
      }),
      signal: clientController.signal
    });

    clearTimeout(clientTimeoutTimer);
    const data = await res.json().catch(() => ({}));

    // CASE 1: Clarification required
    if (data.needs_clarification) {
      if (notice) notice.style.display = 'none';
      if (clarifyBox) {
        renderClarificationArea({
          clarifyBox,
          question: data.clarifying_question || 'What specific topic, chapter, or deliverable will you be working on?',
          onSubmit: async (answer) => {
            const nextHistory = Array.isArray(clarificationHistory) ? [...clarificationHistory] : [];
            if (clarificationAnswer && !nextHistory.includes(clarificationAnswer)) {
              nextHistory.push(clarificationAnswer);
            }
            await executeEstimationRequest({
              btn,
              originalBtnText,
              form,
              title,
              description,
              priority,
              clarificationAnswer: answer,
              clarificationHistory: nextHistory,
              durationInput,
              notice,
              clarifyBox,
              noticeSelector,
              inputSelector
            });
          },
          onCancel: () => {
            clarifyBox.style.display = 'none';
          }
        });
      }
      return;
    }

    // CASE 2: Successful estimation
    if (data.success && data.estimated_minutes) {
      if (clarifyBox) clarifyBox.style.display = 'none';

      const currentVal = durationInput?.value ? parseInt(durationInput.value, 10) : null;

      // Handle manual duration override protection
      if (currentVal && Number.isFinite(currentVal) && currentVal !== data.estimated_minutes) {
        if (notice) {
          notice.innerHTML = `
            <div class="ai-duration-choice-box">
              <div>💡 <strong>AI recommends ~${data.estimated_minutes} min</strong>${data.range ? ` (${data.range.min}–${data.range.max} min range)` : ''}${data.confidence ? ` • ${data.confidence} confidence` : ''}. <em>${escapeHtml(data.estimate_reason || '')}</em></div>
              <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">
                You currently have <strong>${currentVal} min</strong> entered. How would you like to proceed?
              </div>
              <div class="ai-choice-btn-row">
                <button type="button" class="btn-ai-choice-btn" id="replaceAiDurationBtn">
                  Replace with AI estimate (${data.estimated_minutes} min)
                </button>
                <button type="button" class="btn-ai-choice-btn secondary" id="keepAiDurationBtn">
                  Keep my duration (${currentVal} min)
                </button>
              </div>
            </div>
          `;
          notice.style.display = 'block';

          // Bind choice events
          const replaceBtn = notice.querySelector('#replaceAiDurationBtn');
          const keepBtn = notice.querySelector('#keepAiDurationBtn');

          if (replaceBtn) {
            replaceBtn.onclick = () => {
              if (durationInput) durationInput.value = data.estimated_minutes;
              notice.innerHTML = `✨ <strong>AI estimate applied: ~${data.estimated_minutes} min</strong> — adjust to suit your pace.`;
            };
          }
          if (keepBtn) {
            keepBtn.onclick = () => {
              notice.innerHTML = `⏱️ Kept manual duration of <strong>${currentVal} min</strong>.`;
            };
          }
        }
      } else {
        // Automatically populate if empty or identical
        if (durationInput) {
          durationInput.value = data.estimated_minutes;
        }
        if (notice) {
          const breakdownTip = data.milestone_breakdown_recommended
            ? `<div style="margin-top: 4px; font-weight: 600; color: var(--accent-amber);">📌 Tip: This task is unusually large (>4h). Consider breaking it down into smaller milestones.</div>`
            : '';
          notice.innerHTML = `✨ <strong>AI estimate: ~${data.estimated_minutes} min</strong>${data.range ? ` (${data.range.min}–${data.range.max} min range)` : ''}${data.confidence ? ` • ${data.confidence} confidence` : ''}. <em>${escapeHtml(data.estimate_reason || '')}</em> — adjust to suit your pace.${breakdownTip}`;
          notice.style.display = 'block';
        }
      }
      return;
    }

    // CASE 3: Provider not configured or error
    if (!data.success) {
      if (notice) {
        if (data.code === 'API_KEY_MISSING' || data.code === 'NO_API_KEY' || data.error_code === 'PROVIDER_NOT_CONFIGURED' || data.error_code === 'MISSING_PERSONAL_KEY' || data.error_code === 'DEFAULT_PROVIDER_NOT_CONFIGURED') {
          notice.innerHTML = `
            <div class="ai-missing-key-row" style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
              <span>🔑 Please provide your Gemini API key in Settings → AI Settings to use AI Estimate (or enter duration manually).</span>
              <div style="display: flex; gap: 6px;">
                <button type="button" class="btn-ai-choice-btn" onclick="goToAiSettings()">Go to AI Settings</button>
                <button type="button" class="btn-ai-choice-btn secondary" onclick="focusManualDurationInput(this)">Enter Manually</button>
              </div>
            </div>
          `;
          if (typeof showToast === 'function') {
            showToast('Please provide your Gemini API key in Settings → AI Settings to use AI Estimate (or enter duration manually).', 'info');
          }
        } else if (data.error_code === 'UNSUPPORTED_KEY_TYPE') {
          notice.innerHTML = `
            <span>❌ <strong>Unsupported Key:</strong> ${escapeHtml(data.message)}</span>
            <button type="button" class="btn-ai-choice-btn" style="margin-left: 8px; font-size: 0.74rem;" onclick="openAiProviderModal()">Update Key</button>
            <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 4px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
          `;
        } else if (data.error_code === 'PERMISSION_DENIED' || res.status === 403) {
          notice.innerHTML = `
            <span>🚫 <strong>Access Denied:</strong> ${escapeHtml(data.message || 'Google Gemini API access denied. Please verify your project permissions.')}</span>
            <button type="button" class="btn-ai-choice-btn" style="margin-left: 8px; font-size: 0.74rem;" onclick="openAiProviderModal()">Check Settings</button>
            <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 4px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
          `;
        } else if (data.error_code === 'INVALID_API_KEY' || res.status === 401) {
          notice.innerHTML = `
            <span>🔑 <strong>Invalid Key:</strong> ${escapeHtml(data.message || 'Invalid or unauthorized Gemini API key. Please check your key in Settings.')}</span>
            <button type="button" class="btn-ai-choice-btn" style="margin-left: 8px; font-size: 0.74rem;" onclick="openAiProviderModal()">Update Key</button>
            <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 4px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
          `;
        } else if (data.error_code === 'PROVIDER_QUOTA_EXHAUSTED' || res.status === 429) {
          notice.innerHTML = `
            <span>⏳ <strong>Quota / Rate Limit Reached:</strong> ${escapeHtml(data.message || 'Gemini API quota or rate limit reached. Please check your account limits, or enter duration manually.')}</span>
            <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 8px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
          `;
        } else if (data.error_code === 'PROVIDER_TIMEOUT') {
          notice.innerHTML = `
            <span>⏱️ <strong>Estimation Timed Out:</strong> ${escapeHtml(data.message || 'Duration estimation took too long. Please enter duration manually.')}</span>
            <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 8px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
          `;
        } else if (data.error_code === 'PROVIDER_TEMPORARILY_BUSY' || data.error_code === 'PROVIDER_UNAVAILABLE' || res.status === 503 || res.status === 502 || res.status === 504) {
          notice.innerHTML = `
            <span>⚠️ <strong>Provider Temporarily Unavailable:</strong> ${escapeHtml(data.message || 'The AI provider is temporarily unavailable. Please try again shortly, or enter duration manually.')}</span>
            <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 8px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
          `;
        } else {
          notice.innerHTML = `
            <span>⚠️ ${escapeHtml(data.message || 'AI duration estimation failed. Please enter duration manually.')}</span>
            <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 8px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
          `;
        }
        notice.style.display = 'block';
      }
    }

  } catch (err) {
    clearTimeout(clientTimeoutTimer);
    if (notice) {
      if (err.name === 'AbortError') {
        notice.innerHTML = `
          <span>⏱️ <strong>Estimation Timed Out:</strong> Duration estimation took too long (request timed out). Please enter duration manually.</span>
          <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 8px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
        `;
      } else {
        notice.innerHTML = `
          <span>⚠️ AI duration estimation request failed. Please enter duration manually.</span>
          <button type="button" class="btn-ai-choice-btn secondary" style="margin-left: 8px; font-size: 0.74rem;" onclick="focusManualDurationInput(this)">Enter Duration Manually</button>
        `;
      }
      notice.style.display = 'block';
    }
  } finally {
    clearTimeout(clientTimeoutTimer);
    btn._isEstimating = false;
    btn.innerHTML = originalBtnText || '✨ AI Estimate';
    btn.disabled = false;
  }
}

// Render inline clarification prompt box
function renderClarificationArea({ clarifyBox, question, onSubmit, onCancel }) {
  clarifyBox.innerHTML = `
    <div class="ai-clarify-header">
      <span class="ai-clarify-badge">💡 I need a little more detail to estimate this task</span>
    </div>
    <div class="ai-clarify-question-text">${escapeHtml(question)}</div>
    <div class="ai-clarify-input-row">
      <input type="text" class="modal-input ai-clarify-input" placeholder="e.g. Specific chapter, deliverable, or exercise" autocomplete="off">
      <button type="button" class="btn-primary-emerald" style="padding: 6px 14px; font-size: 0.8rem; border-radius: 8px;">Refine Estimate</button>
      <button type="button" class="btn-secondary-pill" style="padding: 6px 14px; font-size: 0.8rem; border-radius: 8px;">Cancel</button>
    </div>
  `;
  clarifyBox.style.display = 'flex';

  const input = clarifyBox.querySelector('.ai-clarify-input');
  const submitBtn = clarifyBox.querySelector('.btn-primary-emerald');
  const cancelBtn = clarifyBox.querySelector('.btn-secondary-pill');

  input?.focus();

  let isSubmitting = false;

  const handleRefine = async () => {
    if (isSubmitting) return;
    const val = (input?.value || '').trim();
    if (!val) {
      input?.focus();
      return;
    }
    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Refining...';
    }
    if (input) input.disabled = true;

    try {
      await onSubmit(val);
    } finally {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Refine Estimate';
      }
      if (input) input.disabled = false;
    }
  };

  submitBtn?.addEventListener('click', handleRefine);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRefine();
    }
  });

  cancelBtn?.addEventListener('click', onCancel);
}


window.closeModal = function (modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('open');
  if (typeof window.updateGlobalRoutineBanner === 'function') {
    window.updateGlobalRoutineBanner(Store.state);
  }
};

// Developer Console Only Utilities (Restricted from Production UI)
function initDeveloperConsole() {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    window.ekagraDev = {
      async loadSample() {
        const res = await fetch('/api/dashboard/load-sample', { method: 'POST' });
        const json = await res.json();
        if (json.data) Store.setState({ ...json.data, isColdStart: false });
        console.log('[EKAGRA DEV] Loaded sample collage dataset.');
      },
      async reset() {
        await fetch('/api/dashboard/reset', { method: 'POST' });
        Store.setState({
          isColdStart: true,
          goals: [],
          tasks: [],
          routines: [],
          metrics: { completedToday: 0, missedToday: 0, rescheduledToday: 0, streak: 0, focusHours: 0, totalCompletedTasks: 0 },
          insights: [],
          activities: []
        });
        console.log('[EKAGRA DEV] Reset to Day-0 Cold Start.');
      }
    };
  }
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanCategory(cat) {
  if (!cat) return 'Personal';
  if (cat.includes('AI')) return 'AIML';
  if (cat.includes('DSA')) return 'DSA';
  if (cat.includes('Coll')) return 'College';
  if (cat.includes('Trav')) return 'Travel';
  if (cat.includes('Fit') || cat.includes('Gym')) return 'Fitness';
  if (cat.includes('Flex')) return 'Flexible';
  if (cat.includes('Proj')) return 'Projects';
  return 'Personal';
}

function cleanStatus(status) {
  if (!status) return 'on-track';
  const s = status.toLowerCase();
  if (s.includes('track')) return 'on-track';
  if (s.includes('risk')) return 'at-risk';
  if (s.includes('behind')) return 'behind';
  return 'on-track';
}

function getCategoryIcon(cat) {
  if (cat.includes('AI')) return 'ai';
  if (cat.includes('DSA') || cat.includes('Code')) return 'code';
  if (cat.includes('Project')) return 'project';
  return 'book';
}
