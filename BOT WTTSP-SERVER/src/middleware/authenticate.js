const jwt = require('jsonwebtoken');
const db = require('../db');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify user & company status in DB (Kill switch logic)
    const userRes = await db.query(
      `SELECT u.id, u.email, u.role, u.status as user_status, 
              c.id as company_id, c.status as company_status
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.id = $1`,
      [decoded.userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User no longer exists' });
    }

    const user = userRes.rows[0];

    if (user.role !== 'superadmin' && user.company_status === 'suspended') {
      return res.status(403).json({ error: 'Company suspended', reason: 'company_disabled' });
    }

    if (user.user_status === 'disabled') {
      return res.status(403).json({ error: 'User disabled', reason: 'user_disabled' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id || null
    };

    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    next();
  };
}

module.exports = { authenticateToken, requireRole };
