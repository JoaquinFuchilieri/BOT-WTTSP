const db = require('../db');
const { logAudit } = require('../utils/audit');

// In-memory store for tracking failed login attempts
// Map<key, { count: number, firstAttempt: number, blockedUntil: number | null }>
const attempts = new Map();

// Configuration
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes block duration

// Clean up stale memory entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts.entries()) {
    if (record.blockedUntil && now > record.blockedUntil) {
      attempts.delete(key);
    } else if (!record.blockedUntil && now - record.firstAttempt > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}, 10 * 60 * 1000);

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip ||
    '127.0.0.1'
  );
}

/**
 * Middleware that checks if an IP or email is currently blocked due to repeated failed logins.
 */
function loginRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const email = (req.body?.email || '').toLowerCase().trim();
  const now = Date.now();

  const ipKey = `ip:${ip}`;
  const emailKey = email ? `email:${email}` : null;

  const ipRecord = attempts.get(ipKey);
  const emailRecord = emailKey ? attempts.get(emailKey) : null;

  // Check if IP is blocked
  if (ipRecord && ipRecord.blockedUntil && now < ipRecord.blockedUntil) {
    const remainingSec = Math.ceil((ipRecord.blockedUntil - now) / 1000);
    res.setHeader('Retry-After', remainingSec);
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Por motivos de seguridad, el acceso ha sido bloqueado temporalmente por ${Math.ceil(remainingSec / 60)} minutos.`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: remainingSec
    });
  }

  // Check if target account is blocked
  if (emailRecord && emailRecord.blockedUntil && now < emailRecord.blockedUntil) {
    const remainingSec = Math.ceil((emailRecord.blockedUntil - now) / 1000);
    res.setHeader('Retry-After', remainingSec);
    return res.status(429).json({
      error: `Esta cuenta ha sido bloqueada temporalmente por exceso de intentos fallidos. Intente nuevamente en ${Math.ceil(remainingSec / 60)} minutos.`,
      code: 'ACCOUNT_TEMPORARILY_LOCKED',
      retryAfter: remainingSec
    });
  }

  next();
}

/**
 * Call this when a login attempt fails to increment the counter and trigger a block if exceeded.
 */
async function recordFailedLogin(req, email) {
  const ip = getClientIp(req);
  const cleanEmail = (email || '').toLowerCase().trim();
  const now = Date.now();

  const keys = [`ip:${ip}`];
  if (cleanEmail) keys.push(`email:${cleanEmail}`);

  for (const key of keys) {
    let record = attempts.get(key);
    if (!record || now - record.firstAttempt > WINDOW_MS) {
      record = { count: 1, firstAttempt: now, blockedUntil: null };
    } else {
      record.count += 1;
    }

    if (record.count >= MAX_ATTEMPTS) {
      record.blockedUntil = now + BLOCK_DURATION_MS;
      console.warn(`[Security Alert] Rate limit triggered for ${key}. Blocked for 15 minutes.`);
      
      // Log to audit log table
      try {
        await logAudit(req, 'LOGIN_BRUTE_FORCE_BLOCKED', {
          ip,
          targetEmail: cleanEmail,
          attemptsCount: record.count,
          blockedForMinutes: 15
        });
      } catch (err) {
        console.error('[RateLimiter] Error logging audit event:', err.message);
      }
    }

    attempts.set(key, record);
  }
}

/**
 * Call this upon successful login to reset the counter for this IP and email.
 */
function recordSuccessfulLogin(req, email) {
  const ip = getClientIp(req);
  const cleanEmail = (email || '').toLowerCase().trim();

  attempts.delete(`ip:${ip}`);
  if (cleanEmail) attempts.delete(`email:${cleanEmail}`);
}

module.exports = {
  loginRateLimiter,
  recordFailedLogin,
  recordSuccessfulLogin
};
