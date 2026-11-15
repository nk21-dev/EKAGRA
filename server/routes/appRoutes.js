const path = require('node:path');
const express = require('express');
const router = express.Router();
const { verifyToken, authService } = require('../services/authService');

// Middleware to check if user has a valid authenticated session from cookie
async function checkAuthSession(req) {
  const token = req.cookies && req.cookies.ekagra_token;
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded || !decoded.userId) return null;
  return await authService.getMe(decoded.userId);
}

// GET / - Public landing page
router.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../index.html'));
});

// GET /login - Sign In page (Redirect to /dashboard if already authenticated)
router.get('/login', async (req, res) => {
  const user = await checkAuthSession(req);
  if (user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.resolve(__dirname, '../../public/views/login.html'));
});

// GET /signup - Sign Up page (Redirect to /dashboard if already authenticated)
router.get('/signup', async (req, res) => {
  const user = await checkAuthSession(req);
  if (user) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.resolve(__dirname, '../../public/views/signup.html'));
});

// GET /forgot-password - Forgot Password page
router.get('/forgot-password', async (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../public/views/forgot-password.html'));
});

// GET /reset-password - Reset Password page
router.get('/reset-password', async (req, res) => {
  res.sendFile(path.resolve(__dirname, '../../public/views/reset-password.html'));
});

// GET /dashboard - Protected Minimal Authenticated Placeholder
router.get('/dashboard', async (req, res) => {
  const user = await checkAuthSession(req);
  if (!user) {
    return res.redirect('/login');
  }
  res.sendFile(path.resolve(__dirname, '../../public/views/dashboard.html'));
});

module.exports = router;
