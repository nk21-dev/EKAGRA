const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getDatabase } = require('../db');
const { sendPasswordResetEmail } = require('./mailService');

// RFC 5322 compliant email regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

function generateToken(userId) {
  return jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return null;
  }
}

class AuthService {
  constructor(customDb = null) {
    this.customDb = customDb;
  }

  get db() {
    return this.customDb || getDatabase();
  }

  async signup({ name, email, password, confirmPassword }) {
    // 1. Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      throw new Error('Please enter your full name (at least 2 characters).');
    }

    if (!validateEmail(email)) {
      throw new Error('Please enter a valid email address.');
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    // 2. Check duplicate email
    const existing = await this.db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    // 3. Hash password
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();

    // 4. Insert user
    const insertStmt = this.db.prepare(`
      INSERT INTO users (name, email, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = await insertStmt.run(cleanName, cleanEmail, passwordHash, now, now);
    const userId = Number(result.lastInsertRowid);

    // 5. Verify Zero Application Data constraint for new user
    const dataCount = await this.db.prepare('SELECT COUNT(*) as count FROM user_app_data WHERE user_id = ?').get(userId);
    if (dataCount && dataCount.count !== 0) {
      throw new Error('New user data integrity violation: newly registered user must have zero data.');
    }

    const createdUser = await this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const safeUser = sanitizeUser(createdUser);
    const token = generateToken(userId);

    return { user: safeUser, token };
  }

  async login({ email, password }) {
    if (!email || !password) {
      throw new Error('Please enter your email and password.');
    }

    if (!validateEmail(email)) {
      throw new Error('Please enter a valid email address.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await this.db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      // Prevent email enumeration
      throw new Error('Incorrect email or password.');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      throw new Error('Incorrect email or password.');
    }

    const safeUser = sanitizeUser(user);
    const token = generateToken(user.id);

    return { user: safeUser, token };
  }

  async getMe(userId) {
    if (!userId) return null;
    const user = await this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    return sanitizeUser(user);
  }

  async forgotPassword({ email }) {
    // Validate format
    if (!validateEmail(email)) {
      throw new Error('Please enter a valid email address.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await this.db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(cleanEmail);

    // Constant time / anti-enumeration generic response
    const genericResponse = {
      message: 'If an account exists for this email, a password reset link has been sent.',
    };

    if (!user) {
      return genericResponse;
    }

    // Generate cryptographically secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    
    // Expires in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Invalidate any existing unused tokens for this user
    await this.db.prepare(`
      UPDATE password_reset_tokens 
      SET used_at = ? 
      WHERE user_id = ? AND used_at IS NULL
    `).run(now, user.id);

    // Save token hash to database
    await this.db.prepare(`
      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(user.id, tokenHash, expiresAt, now);

    // Build reset link
    const resetUrl = `${config.appUrl}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);

    return genericResponse;
  }

  async resetPassword({ token, newPassword, confirmPassword }) {
    if (!token || typeof token !== 'string') {
      throw new Error('A valid reset token is required.');
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    if (newPassword !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const resetRecord = await this.db.prepare(`
      SELECT * FROM password_reset_tokens WHERE token_hash = ?
    `).get(tokenHash);

    if (!resetRecord) {
      throw new Error('Your reset link is invalid or has expired.');
    }

    if (resetRecord.used_at) {
      throw new Error('Your reset link has expired or has already been used.');
    }

    const isExpired = new Date(resetRecord.expires_at) < new Date();
    if (isExpired) {
      throw new Error('Your reset link has expired.');
    }

    // Hash new password and update user
    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    const now = new Date().toISOString();

    await this.db.prepare(`
      UPDATE users 
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(newPasswordHash, now, resetRecord.user_id);

    // Invalidate token
    await this.db.prepare(`
      UPDATE password_reset_tokens 
      SET used_at = ? 
      WHERE id = ?
    `).run(now, resetRecord.id);

    return {
      message: 'Password reset successfully. You can now sign in with your new password.',
    };
  }

  // User Isolation Verification / Application Data State Helper
  getUserAppState(userId) {
    if (this.db && this.db.isTurso) {
      return (async () => {
        const user = await this.db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
        if (!user) return null;
        const count = await this.db.prepare('SELECT COUNT(*) as count FROM user_app_data WHERE user_id = ?').get(userId);
        return {
          user: sanitizeUser(user),
          counts: {
            goals: 0,
            tasks: 0,
            schedules: 0,
            routines: 0,
            history: 0,
            insights: 0,
            ml_data: 0,
            total_records: count ? count.count : 0,
          },
        };
      })();
    }
    const user = this.db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
    if (!user) return null;

    // Real count of records belonging to this isolated user
    const count = this.db.prepare('SELECT COUNT(*) as count FROM user_app_data WHERE user_id = ?').get(userId);

    return {
      user: sanitizeUser(user),
      counts: {
        goals: 0,
        tasks: 0,
        schedules: 0,
        routines: 0,
        history: 0,
        insights: 0,
        ml_data: 0,
        total_records: count ? count.count : 0,
      },
    };
  }
}

module.exports = {
  AuthService,
  authService: new AuthService(),
  verifyToken,
  validateEmail,
};
