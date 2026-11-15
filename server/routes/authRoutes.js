const express = require('express');
const router = express.Router();
const config = require('../config');
const { authService } = require('../services/authService');
const { requireAuth, assertUserIsolation } = require('../middleware/auth');

const isSecure = config.nodeEnv === 'production' || Boolean(process.env.VERCEL);

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isSecure,
  sameSite: 'lax',
  maxAge: config.cookieMaxAge,
  path: '/',
};

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body || {};
    const result = await authService.signup({ name, email, password, confirmPassword });

    // Set secure HTTP-only cookie
    res.cookie('ekagra_token', result.token, COOKIE_OPTIONS);

    return res.status(201).json({
      message: 'Account created successfully.',
      user: result.user,
      token: result.token,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const result = await authService.login({ email, password });

    // Set secure HTTP-only cookie
    res.cookie('ekagra_token', result.token, COOKIE_OPTIONS);

    return res.status(200).json({
      message: 'Signed in successfully.',
      user: result.user,
      token: result.token,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('ekagra_token', {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
  });
  return res.status(200).json({ message: 'Signed out successfully.' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  return res.status(200).json({
    user: req.user,
  });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    const result = await authService.forgotPassword({ email });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body || {};
    const result = await authService.resetPassword({ token, newPassword, confirmPassword });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// GET /api/auth/state (User Isolation & Sovereign Empty State verification)
router.get('/state', requireAuth, async (req, res) => {
  const state = await authService.getUserAppState(req.user.id);
  return res.status(200).json(state);
});

// Protected demonstration of user isolation guard
router.get('/test-isolation/:targetUserId', requireAuth, (req, res) => {
  try {
    const { targetUserId } = req.params;
    // Strict isolation enforcement
    assertUserIsolation(req, targetUserId);
    return res.status(200).json({
      message: 'Access granted to own sovereign data.',
      userId: req.user.id,
    });
  } catch (err) {
    return res.status(err.status || 403).json({
      error: err.message,
    });
  }
});

module.exports = router;
