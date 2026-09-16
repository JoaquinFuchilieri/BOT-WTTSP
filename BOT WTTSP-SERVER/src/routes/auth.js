const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticateToken } = require('../middleware/authenticate');
const { loginRateLimiter, recordFailedLogin, recordSuccessfulLogin } = require('../middleware/rate-limiter');

// POST /auth/login - Protected with brute-force rate limiter
router.post('/login', loginRateLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRes = await db.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.status as user_status,
              c.id as company_id, c.name as company_name, c.status as company_status,
              c.user_limit, c.max_profiles_per_operator
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      await recordFailedLogin(req, email);
      return res.status(401).json({ error: 'Credenciales inválidas. Verificá tu correo y contraseña.' });
    }

    const user = userRes.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      await recordFailedLogin(req, email);
      return res.status(401).json({ error: 'Credenciales inválidas. Verificá tu correo y contraseña.' });
    }

    // Reset failed counter upon successful authentication
    recordSuccessfulLogin(req, email);

    if (user.role !== 'superadmin' && user.company_status === 'suspended') {
      return res.status(403).json({ error: 'Esta empresa fue SUSPENDIDA. Comunícate con soporte', reason: 'company_disabled' });
    }

    if (user.user_status === 'disabled') {
      return res.status(403).json({ error: 'Tu cuenta de usuario ha sido desactivada por el administrador', reason: 'user_disabled' });
    }

    // Restriction: SuperAdmin only operates from the Web Dashboard
    if (req.body.clientType === 'desktop' && user.role === 'superadmin') {
      return res.status(403).json({
        error: 'El SuperAdmin no gestiona WhatsApps locales. Accedé desde el Panel Web centralizado.'
      });
    }

    const accessToken = jwt.sign(
      { userId: user.id, companyId: user.company_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '20m' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        companyName: user.company_name,
        userLimit: user.user_limit || 5,
        maxProfilesPerOperator: user.max_profiles_per_operator || 3
      }
    });
  } catch (err) {
    console.error('[Login Error]', err);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const userRes = await db.query(
      `SELECT u.id, u.role, u.status as user_status, c.id as company_id, c.status as company_status
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userRes.rows[0];

    if (user.company_status === 'suspended') {
      return res.status(403).json({ error: 'Esta empresa fue SUSPENDIDA. Comunícate con soporte', reason: 'company_disabled' });
    }

    if (user.user_status === 'disabled') {
      return res.status(403).json({ error: 'Tu cuenta de usuario ha sido desactivada por el administrador', reason: 'user_disabled' });
    }

    const newAccessToken = jwt.sign(
      { userId: user.id, companyId: user.company_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '20m' }
    );

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
});

// GET /auth/me - Return enriched user details
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userRes = await db.query(
      `SELECT u.id, u.email, u.role, u.status as user_status,
              c.id as company_id, c.name as company_name, c.status as company_status,
              c.user_limit, c.max_profiles_per_operator
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const u = userRes.rows[0];
    return res.json({
      user: {
        id: u.id,
        email: u.email,
        role: u.role,
        companyId: u.company_id,
        companyName: u.company_name,
        userLimit: u.user_limit || 5,
        maxProfilesPerOperator: u.max_profiles_per_operator || 3
      }
    });
  } catch (err) {
    console.error('[Auth /me Error]', err);
    return res.status(500).json({ error: 'Error al obtener sesión de usuario' });
  }
});

module.exports = router;
