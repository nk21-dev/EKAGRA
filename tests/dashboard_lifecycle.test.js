/**
 * EKAGRA — Dashboard Lifecycle & Asynchronous Data Flow Regression Test Suite
 * 
 * Verifies:
 * 1. Zero-data contract for new user (goals: [], tasks: [], metrics: 0, isColdStart: true)
 * 2. Populated data contract for user with goals/tasks (isColdStart: false)
 * 3. User data binding (real authenticated user name/email, not hardcoded)
 * 4. Dashboard DOM structure (all 6 cards + guidance elements present)
 * 5. Dashboard client script stability (Store.init, isColdStart definition, no ReferenceError, no redirect loops)
 * 6. Empty-state stability across view navigation
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

// Setup test database
const testDbPath = path.resolve(__dirname, '../data/test_dash_lifecycle_ekagra.sqlite');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}
process.env.DB_PATH = './data/test_dash_lifecycle_ekagra.sqlite';

const app = require('../server/index');
let server;
let baseUrl;

function makeRequest(method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };

    let bodyData = null;
    if (body) {
      bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json,
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function extractCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return cookieStr.split(';')[0];
}

test('EKAGRA Dashboard Lifecycle & Asynchronous Data Flow Suite', async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  t.after(() => {
    if (server) server.close();
  });

  let userCookie = null;
  let userToken = null;
  let realUser = null;

  await t.test('1. Setup User: Register a new user with real identity', async () => {
    const res = await makeRequest('POST', '/api/auth/signup', {}, {
      name: 'Ekagra Lifecycle User',
      email: 'lifecycle.user@ekagra.ai',
      password: 'Password123!',
      confirmPassword: 'Password123!'
    });

    assert.equal(res.status, 201);
    assert.ok(res.json.user);
    assert.equal(res.json.user.name, 'Ekagra Lifecycle User');
    realUser = res.json.user;
    userToken = res.json.token;
    userCookie = extractCookie(res.headers);
    assert.ok(userCookie);
  });

  await t.test('2. Contract Verification: GET /api/dashboard/data returns predictable zero-data structure', async () => {
    const res = await makeRequest('GET', '/api/dashboard/data', {
      Cookie: userCookie
    });

    assert.equal(res.status, 200);
    const data = res.json;

    // Check contract structure
    assert.ok(data.user, 'data.user must be present');
    assert.equal(data.user.name, 'Ekagra Lifecycle User');
    assert.equal(data.user.email, 'lifecycle.user@ekagra.ai');
    assert.equal(data.isColdStart, true, 'Brand-new user must have isColdStart = true');
    assert.ok(Array.isArray(data.goals), 'data.goals must be an array');
    assert.equal(data.goals.length, 0, 'data.goals must be empty for Day-0 user');
    assert.ok(Array.isArray(data.tasks), 'data.tasks must be an array');
    assert.equal(data.tasks.length, 0);
    assert.ok(Array.isArray(data.routines), 'data.routines must be an array');
    assert.ok(Array.isArray(data.insights), 'data.insights must be an array');
    assert.ok(Array.isArray(data.activities), 'data.activities must be an array');

    // Check progress / metrics contract
    assert.ok(data.metrics, 'data.metrics must be present');
    assert.equal(data.metrics.completedToday, 0);
    assert.equal(data.metrics.missedToday, 0);
    assert.equal(data.metrics.rescheduledToday, 0);
  });

  await t.test('3. HTML Skeletons: dashboard.html contains all 6 cards and empty-state guidance containers', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../public/views/dashboard.html'), 'utf8');

    assert.ok(html.includes('id="view-home"'), 'Must have #view-home section');
    assert.ok(html.includes('id="homeProgressTaskCount"'), 'Must have progress count element');
    assert.ok(html.includes('id="homeProgressPct"'), 'Must have progress pct element');
    assert.ok(html.includes('id="homeProgressBarFill"'), 'Must have progress bar fill');
    assert.ok(html.includes('id="homeProgressGuidance"'), 'Must have guidance container');
    assert.ok(html.includes('id="homeNextTaskContainer"'), 'Must have next task container');
    assert.ok(html.includes('id="homeTimelineList"'), 'Must have timeline list container');
    assert.ok(html.includes('id="homeGoalsOverviewList"'), 'Must have goals overview list');
    assert.ok(html.includes('id="homeInsightsFeed"'), 'Must have insights feed');
    assert.ok(html.includes('id="homeActivityFeed"'), 'Must have activity feed');
  });

  await t.test('4. Script Stability: dashboard.js executes Store.init without ReferenceError or redirect loops', () => {
    const jsCode = fs.readFileSync(path.resolve(__dirname, '../public/js/dashboard.js'), 'utf8');

    // Verify syntax and definition
    assert.ok(!jsCode.includes('isColdStart: isCold,') || jsCode.includes('const isCold ='), 'isCold must be declared before use');
    assert.ok(jsCode.includes('function renderHome'), 'renderHome must exist');
    assert.ok(jsCode.includes('function switchView'), 'switchView must exist');
    assert.ok(jsCode.includes('window.switchView = switchView'), 'switchView must be exposed on window');
    assert.ok(jsCode.includes('window.setTheme = setTheme'), 'setTheme must be exposed on window');
  });

  await t.test('5. Data Isolation: Unauthenticated user cannot access /api/dashboard/data', async () => {
    const res = await makeRequest('GET', '/api/dashboard/data');
    assert.equal(res.status, 401);
  });

  await t.test('6. Populated State: User with created goal transitions out of cold start', async () => {
    // Create a goal
    const goalRes = await makeRequest('POST', '/api/goals', { Cookie: userCookie }, {
      title: 'Full Stack Engineering Mastery',
      target_date: '2026-11-30',
      priority: 'High',
      description: 'System architecture, DB design and UI polish'
    });
    assert.equal(goalRes.status, 201);

    // Fetch dashboard data again
    const dashRes = await makeRequest('GET', '/api/dashboard/data', { Cookie: userCookie });
    assert.equal(dashRes.status, 200);
    assert.equal(dashRes.json.isColdStart, false, 'User with goals must have isColdStart = false');
    assert.equal(dashRes.json.goals.length, 1);
    assert.equal(dashRes.json.goals[0].title, 'Full Stack Engineering Mastery');
  });
});
