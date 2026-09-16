const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');

router.use(authenticateToken, requireRole('superadmin', 'admin'));

// GET /audit-logs - List audit events
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.role === 'superadmin' && req.query.companyId
      ? req.query.companyId
      : req.user.companyId;

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const action = req.query.action || null;

    let query = `
      SELECT a.*, c.name as company_name
      FROM audit_logs a
      LEFT JOIN companies c ON a.company_id = c.id
      LEFT JOIN users u ON a.user_id = u.id
    `;
    const conditions = [];
    const params = [];
    let idx = 1;

    // SuperAdmin account and actions are strictly invisible to all company admins
    if (req.user.role !== 'superadmin') {
      conditions.push(`u.role IN ('admin', 'user')`);
      conditions.push(`u.company_id = $${idx++}`);
      params.push(req.user.companyId);
      conditions.push(`a.company_id = $${idx++}`);
      params.push(req.user.companyId);
      conditions.push(`a.user_email NOT ILIKE '%superadmin%'`);
    } else {
      if (companyId) {
        conditions.push(`a.company_id = $${idx++}`);
        params.push(companyId);
      }
    }
    if (action) {
      conditions.push(`a.action = $${idx++}`);
      params.push(action);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY a.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Audit Logs GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
