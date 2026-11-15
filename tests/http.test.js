/**
 * EKAGRA Phase 1 — End-to-End HTTP & Routing Test Suite
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

// Setup test database
const httpTestDbPath = path.resolve(__dirname, '../data/test_http_ekagra.sqlite');
if (fs.existsSync(httpTestDbPath)) {
  fs.unlinkSync(httpTestDbPath);
}
process.env.DB_PATH = './data/test_http_ekagra.sqlite';

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

test('EKAGRA Phase 1 HTTP & Endpoint Suite', async (t) => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });

  t.after(() => {
    server.close();
  });

  let userCookie = null;
  let userToken = null;

  await t.test('1. HTTP Signup: POST /api/auth/signup sets HTTP-only cookie and returns user profile without password_hash', async () => {
    const res = await makeRequest('POST', '/api/auth/signup', {}, {
      name: 'Jordan Lee',
      email: 'jordan@ekagra.ai',
      password: 'SecurePassword123!',
      confirmPassword: 'SecurePassword123!',
    });

    assert.equal(res.status, 201);
    assert.equal(res.json.user.name, 'Jordan Lee');
    assert.equal(res.json.user.email, 'jordan@ekagra.ai');
    assert.equal(res.json.user.password_hash, undefined);
    assert.ok(res.json.token);

    // Verify Set-Cookie header
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, 'Must set cookie');
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieStr.includes('ekagra_token='), 'Must contain ekagra_token');
    assert.ok(cookieStr.includes('HttpOnly'), 'Cookie must be HttpOnly');

    userCookie = cookieStr.split(';')[0];
    userToken = res.json.token;
  });

  await t.test('2. HTTP Protected /me: GET /api/auth/me works with cookie & Bearer token', async () => {
    // Via cookie
    const resCookie = await makeRequest('GET', '/api/auth/me', { Cookie: userCookie });
    assert.equal(resCookie.status, 200);
    assert.equal(resCookie.json.user.email, 'jordan@ekagra.ai');

    // Via Bearer header
    const resHeader = await makeRequest('GET', '/api/auth/me', {
      Authorization: `Bearer ${userToken}`,
    });
    assert.equal(resHeader.status, 200);
    assert.equal(resHeader.json.user.name, 'Jordan Lee');

    // Unauthenticated
    const resUnauth = await makeRequest('GET', '/api/auth/me');
    assert.equal(resUnauth.status, 401);
  });

  await t.test('3. HTTP Protected Route Redirection: /dashboard redirects unauthenticated users to /login', async () => {
    const res = await makeRequest('GET', '/dashboard');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
  });

  await t.test('4. HTTP Authenticated Route Redirection: /login redirects authenticated users to /dashboard', async () => {
    const res = await makeRequest('GET', '/login', { Cookie: userCookie });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard');
  });

  await t.test('5. HTTP User Isolation: Rejects access when trying to query another user ID', async () => {
    // Jordan is user 1. Attempting to query user 999 yields 403
    const res = await makeRequest('GET', '/api/auth/test-isolation/999', { Cookie: userCookie });
    assert.equal(res.status, 403);
    assert.ok(res.json.error.includes('User isolation violation'));

    // Querying own ID yields 200
    const resOwn = await makeRequest('GET', '/api/auth/test-isolation/1', { Cookie: userCookie });
    assert.equal(resOwn.status, 200);
  });

  await t.test('6. HTTP Logout: POST /api/auth/logout clears cookie and revokes session', async () => {
    const res = await makeRequest('POST', '/api/auth/logout', { Cookie: userCookie });
    assert.equal(res.status, 200);

    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie);
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(cookieStr.includes('ekagra_token=;') || cookieStr.includes('Max-Age=0') || cookieStr.includes('Expires='));
  });

});
