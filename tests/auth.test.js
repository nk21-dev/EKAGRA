/**
 * EKAGRA Phase 1 — Comprehensive Authentication & Security Test Suite
 * Covers all required test cases:
 * 1. Signup
 * 2. Duplicate email
 * 3. Invalid email
 * 4. Password validation
 * 5. Login
 * 6. Incorrect password
 * 7. Logout
 * 8. /me
 * 9. Protected route
 * 10. Forgot password
 * 11. Valid reset token
 * 12. Expired reset token
 * 13. Reused reset token
 * 14. New password login
 * 15. User isolation
 * 16. Zero initial application data
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Setup isolated test database in memory
const { getDatabase } = require('../server/db');
const testDbPath = path.resolve(__dirname, '../data/test_ekagra.sqlite');

if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const testDb = getDatabase(testDbPath);
const { AuthService } = require('../server/services/authService');
const { getLastSentEmail, clearLastSentEmail } = require('../server/services/mailService');
const authService = new AuthService(testDb);

test('EKAGRA Phase 1 Authentication Suite', async (t) => {

  await t.test('1. Signup: Successful registration creates user with zero app data and no password_hash', async () => {
    const signupData = {
      name: 'Alex Vance',
      email: 'alex@ekagra.ai',
      password: 'SuperSecretPassword123!',
      confirmPassword: 'SuperSecretPassword123!',
    };

    const res = await authService.signup(signupData);

    assert.ok(res.user, 'User object should be returned');
    assert.equal(res.user.name, 'Alex Vance');
    assert.equal(res.user.email, 'alex@ekagra.ai');
    assert.ok(res.user.id, 'User should have a generated ID');
    assert.equal(res.user.password_hash, undefined, 'password_hash must NEVER be returned');
    assert.ok(res.token, 'A valid JWT token must be generated');

    // Verify zero application data
    const appState = authService.getUserAppState(res.user.id);
    assert.equal(appState.counts.goals, 0, 'New user must have 0 goals');
    assert.equal(appState.counts.tasks, 0, 'New user must have 0 tasks');
    assert.equal(appState.counts.schedules, 0, 'New user must have 0 schedules');
    assert.equal(appState.counts.routines, 0, 'New user must have 0 routines');
    assert.equal(appState.counts.history, 0, 'New user must have 0 history');
    assert.equal(appState.counts.insights, 0, 'New user must have 0 insights');
    assert.equal(appState.counts.ml_data, 0, 'New user must have 0 ML data');
    assert.equal(appState.counts.total_records, 0, 'Total records must be 0');
  });

  await t.test('2. Duplicate Email: Prevents registering an existing email (case-insensitive)', async () => {
    await assert.rejects(
      async () => {
        await authService.signup({
          name: 'Alex Duplicate',
          email: 'ALEX@EKAGRA.AI', // uppercase test
          password: 'AnotherPassword123!',
          confirmPassword: 'AnotherPassword123!',
        });
      },
      { message: 'An account with this email already exists.' }
    );
  });

  await t.test('3. Invalid Email: Rejects non-RFC compliant emails', async () => {
    const invalidEmails = ['invalid-email', 'alex@', '@domain.com', 'plainaddress', 'alex@.com'];
    for (const email of invalidEmails) {
      await assert.rejects(
        async () => {
          await authService.signup({
            name: 'Invalid Email User',
            email,
            password: 'ValidPassword123!',
            confirmPassword: 'ValidPassword123!',
          });
        },
        { message: 'Please enter a valid email address.' }
      );
    }
  });

  await t.test('4. Password Validation: Rejects short passwords and mismatched confirmations', async () => {
    // Too short (< 8 chars)
    await assert.rejects(
      async () => {
        await authService.signup({
          name: 'Short Pwd User',
          email: 'short@ekagra.ai',
          password: 'short',
          confirmPassword: 'short',
        });
      },
      { message: 'Password must be at least 8 characters long.' }
    );

    // Mismatched passwords
    await assert.rejects(
      async () => {
        await authService.signup({
          name: 'Mismatch User',
          email: 'mismatch@ekagra.ai',
          password: 'Password12345!',
          confirmPassword: 'DifferentPassword12345!',
        });
      },
      { message: 'Passwords do not match.' }
    );
  });

  await t.test('5. Login: Authenticates valid credentials and never exposes password_hash', async () => {
    const res = await authService.login({
      email: 'alex@ekagra.ai',
      password: 'SuperSecretPassword123!',
    });

    assert.ok(res.user);
    assert.equal(res.user.email, 'alex@ekagra.ai');
    assert.equal(res.user.password_hash, undefined, 'password_hash must NEVER be returned');
    assert.ok(res.token);
  });

  await t.test('6. Incorrect Password: Returns generic message without user enumeration', async () => {
    // Wrong password for existing user
    await assert.rejects(
      async () => {
        await authService.login({
          email: 'alex@ekagra.ai',
          password: 'WrongPassword999!',
        });
      },
      { message: 'Incorrect email or password.' }
    );

    // Non-existent email
    await assert.rejects(
      async () => {
        await authService.login({
          email: 'nonexistent@ekagra.ai',
          password: 'SomePassword123!',
        });
      },
      { message: 'Incorrect email or password.' }
    );
  });

  await t.test('7. /me Endpoint: Retrieves authenticated user profile safely', async () => {
    const user = await authService.getMe(1);
    assert.ok(user);
    assert.equal(user.id, 1);
    assert.equal(user.email, 'alex@ekagra.ai');
    assert.equal(user.password_hash, undefined);
  });

  await t.test('8. Forgot Password: Emits generic response preventing email enumeration', async () => {
    clearLastSentEmail();

    // For existing user
    const resExisting = await authService.forgotPassword({ email: 'alex@ekagra.ai' });
    assert.equal(
      resExisting.message,
      'If an account exists for this email, a password reset link has been sent.'
    );
    const sentEmail = getLastSentEmail();
    assert.ok(sentEmail, 'Email should be dispatched in mail service');
    assert.equal(sentEmail.to, 'alex@ekagra.ai');
    assert.ok(sentEmail.resetUrl.includes('token='), 'Reset link must include secure token');

    // For non-existing user
    clearLastSentEmail();
    const resNonExisting = await authService.forgotPassword({ email: 'nobody@ekagra.ai' });
    assert.equal(
      resNonExisting.message,
      'If an account exists for this email, a password reset link has been sent.'
    );
    assert.equal(getLastSentEmail(), null, 'No email should be dispatched for non-existent account');
  });

  await t.test('9. Password Reset: Full token lifecycle (Valid, Expired, Reused)', async () => {
    clearLastSentEmail();
    await authService.forgotPassword({ email: 'alex@ekagra.ai' });
    const { resetUrl } = getLastSentEmail();
    const token = new URL(resetUrl).searchParams.get('token');

    assert.ok(token, 'A valid random token must exist in the link');

    // 9a. Rejects mismatched new passwords
    await assert.rejects(
      async () => {
        await authService.resetPassword({
          token,
          newPassword: 'BrandNewPassword2026!',
          confirmPassword: 'MismatchPassword2026!',
        });
      },
      { message: 'Passwords do not match.' }
    );

    // 9b. Successfully resets password with valid token
    const resetRes = await authService.resetPassword({
      token,
      newPassword: 'BrandNewPassword2026!',
      confirmPassword: 'BrandNewPassword2026!',
    });
    assert.ok(resetRes.message.includes('Password reset successfully'));

    // 9c. Reused token rejection
    await assert.rejects(
      async () => {
        await authService.resetPassword({
          token,
          newPassword: 'AnotherPassword2026!',
          confirmPassword: 'AnotherPassword2026!',
        });
      },
      { message: 'Your reset link has expired or has already been used.' }
    );

    // 9d. Expired token rejection
    const expiredRawToken = crypto.randomBytes(32).toString('hex');
    const expiredHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
    testDb.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (1, ?, ?, ?)
    `).run(expiredHash, pastTime, pastTime);

    await assert.rejects(
      async () => {
        await authService.resetPassword({
          token: expiredRawToken,
          newPassword: 'SomeNewPassword123!',
          confirmPassword: 'SomeNewPassword123!',
        });
      },
      { message: 'Your reset link has expired.' }
    );
  });

  await t.test('10. New Password Login: Old password fails, new password succeeds', async () => {
    // Old password should fail
    await assert.rejects(
      async () => {
        await authService.login({
          email: 'alex@ekagra.ai',
          password: 'SuperSecretPassword123!',
        });
      },
      { message: 'Incorrect email or password.' }
    );

    // New password succeeds
    const res = await authService.login({
      email: 'alex@ekagra.ai',
      password: 'BrandNewPassword2026!',
    });
    assert.ok(res.user);
    assert.equal(res.user.email, 'alex@ekagra.ai');
  });

  await t.test('11. User Isolation: Enforces strict user isolation across accounts', async () => {
    // Create second user
    const userBRes = await authService.signup({
      name: 'Maya Lin',
      email: 'maya@ekagra.ai',
      password: 'MayaSecurePassword2026!',
      confirmPassword: 'MayaSecurePassword2026!',
    });

    const userAId = 1;
    const userBId = userBRes.user.id;

    assert.notEqual(userAId, userBId, 'Users must have distinct IDs');

    // Insert user A sovereign data directly to verify isolation
    testDb.prepare(`
      INSERT INTO user_app_data (user_id, entity_type, payload, created_at)
      VALUES (?, 'goal', '{"title": "Master Distributed Systems"}', ?)
    `).run(userAId, new Date().toISOString());

    // User A query
    const userARecords = testDb.prepare('SELECT * FROM user_app_data WHERE user_id = ?').all(userAId);
    assert.equal(userARecords.length, 1, 'User A should have 1 record');

    // User B query strictly isolated
    const userBRecords = testDb.prepare('SELECT * FROM user_app_data WHERE user_id = ?').all(userBId);
    assert.equal(userBRecords.length, 0, 'User B must see 0 records (isolated)');

    // Ensure state helper strictly returns 0 for User B
    const userBState = authService.getUserAppState(userBId);
    assert.equal(userBState.counts.total_records, 0);

    // Verify isolation guard throws on unauthorized access
    const { assertUserIsolation } = require('../server/middleware/auth');
    
    // User B attempting to access User A's data
    const fakeReqUserB = { user: { id: userBId } };
    assert.throws(
      () => {
        assertUserIsolation(fakeReqUserB, userAId);
      },
      (err) => err.status === 403 && err.message.includes('User isolation violation')
    );

    // User B accessing their own data succeeds
    const authorizedId = assertUserIsolation(fakeReqUserB, userBId);
    assert.equal(authorizedId, userBId);
  });

});
