const { verifyToken, authService } = require('../services/authService');

async function requireAuth(req, res, next) {
  try {
    let token = null;

    // 1. Check HTTP-only cookie
    if (req.cookies && req.cookies.ekagra_token) {
      token = req.cookies.ekagra_token;
    } 
    // 2. Check Authorization header
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    }

    const user = await authService.getMe(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User account not found.' });
    }

    // Attach strictly validated user to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed.' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    let token = null;
    if (req.cookies && req.cookies.ekagra_token) {
      token = req.cookies.ekagra_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      const decoded = verifyToken(token);
      if (decoded && decoded.userId) {
        const user = await authService.getMe(decoded.userId);
        if (user) {
          req.user = user;
          req.userId = user.id;
        }
      }
    }
  } catch (err) {
    // Ignore and proceed unauthenticated
  }
  next();
}

/**
 * Strict User Isolation Guard:
 * Asserts that any attempted operation is strictly owned by the authenticated user.
 * NEVER trust an incoming query, parameter, or body user_id.
 */
function assertUserIsolation(req, attemptedOwnerId) {
  if (!req.user || !req.user.id) {
    throw new Error('Unauthenticated user cannot access user-scoped records.');
  }

  if (attemptedOwnerId && Number(attemptedOwnerId) !== Number(req.user.id)) {
    const error = new Error('Forbidden: User isolation violation. You cannot access another user’s sovereign data.');
    error.status = 403;
    throw error;
  }

  return req.user.id;
}

module.exports = {
  requireAuth,
  optionalAuth,
  assertUserIsolation,
};
