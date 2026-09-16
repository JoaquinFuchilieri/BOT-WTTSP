const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');

router.use(authenticateToken);

// GET /stats/profiles/:id - Stats for a profile
router.get('/profiles/:id', async (req, res) => {
  const { id: profileId } = req.params;

  try {
    // Reset sent_today to 0 if day rolled over
    await db.query(`
      UPDATE profiles 
      SET sent_today = 0, last_sent_date = CURRENT_DATE 
      WHERE id = $1 AND (last_sent_date IS NULL OR last_sent_date < CURRENT_DATE)
    `, [profileId]);

    const profileRes = await db.query(
      'SELECT id, name, status, sent_today, daily_limit, last_sent_date FROM profiles WHERE id = $1',
      [profileId]
    );

    if (profileRes.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = profileRes.rows[0];

    const countsRes = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'sending') as sending,
         COUNT(*) FILTER (WHERE status = 'error') as error,
         COUNT(*) FILTER (WHERE status = 'sent') as sent
       FROM phone_queue
       WHERE profile_id = $1`,
      [profileId]
    );

    const counts = countsRes.rows[0];

    res.json({
      profileId: profile.id,
      name: profile.name,
      status: profile.status,
      sentToday: parseInt(profile.sent_today, 10),
      dailyLimit: parseInt(profile.daily_limit, 10),
      pending: parseInt(counts.pending, 10),
      sending: parseInt(counts.sending, 10),
      error: parseInt(counts.error, 10),
      sentInQueue: parseInt(counts.sent, 10)
    });
  } catch (err) {
    console.error('[Stats Profile Error]', err);
    res.status(500).json({ error: 'Failed to fetch profile stats' });
  }
});

// GET /stats/company - Company dashboard metrics
router.get('/company', requireRole('superadmin', 'admin'), async (req, res) => {
  const companyId = req.user.role === 'superadmin' && req.query.companyId
    ? req.query.companyId
    : req.user.companyId;

  try {
    const summaryRes = await db.query(
      `SELECT
         COUNT(DISTINCT p.id) as total_profiles,
         COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'connected') as connected_profiles,
         COALESCE(SUM(p.sent_today), 0) as total_sent_today,
         (SELECT COUNT(*) FROM sent_log s JOIN profiles pr ON s.profile_id = pr.id WHERE pr.company_id = $1 AND s.result = 'sent') as total_all_time_sent,
         (SELECT COUNT(*) FROM phone_queue q JOIN profiles pr ON q.profile_id = pr.id WHERE pr.company_id = $1 AND q.status = 'pending') as total_pending,
         (SELECT COUNT(*) FROM phone_queue q JOIN profiles pr ON q.profile_id = pr.id WHERE pr.company_id = $1 AND q.status = 'error') as total_errors
       FROM profiles p
       WHERE p.company_id = $1`,
      [companyId]
    );

    const data = summaryRes.rows[0];
    res.json({
      totalProfiles: parseInt(data.total_profiles, 10),
      connectedProfiles: parseInt(data.connected_profiles || 0, 10),
      totalSentToday: parseInt(data.total_sent_today, 10),
      totalAllTimeSent: parseInt(data.total_all_time_sent, 10),
      totalPending: parseInt(data.total_pending, 10),
      totalErrors: parseInt(data.total_errors, 10)
    });
  } catch (err) {
    console.error('[Stats Company Error]', err);
    res.status(500).json({ error: 'Failed to fetch company stats' });
  }
});

// POST /stats/progress - Agent reports heartbeat & progress
router.post('/progress', async (req, res) => {
  const { profileId, status, sentToday } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'profileId is required' });
  }

  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (status) {
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (sentToday !== undefined) {
      updates.push(`sent_today = $${idx++}`);
      values.push(parseInt(sentToday, 10));
    }

    if (updates.length > 0) {
      values.push(profileId);
      await db.query(
        `UPDATE profiles SET ${updates.join(', ')} WHERE id = $${idx}`,
        values
      );
    }

    res.json({ acknowledged: true });
  } catch (err) {
    console.error('[Stats Progress Error]', err);
    res.status(500).json({ error: 'Failed to acknowledge progress' });
  }
});

// GET /stats/operators-comparison - Multi-operator performance comparison
router.get('/operators-comparison', requireRole('superadmin', 'admin'), async (req, res) => {
  const companyId = req.user.role === 'superadmin' && req.query.companyId
    ? req.query.companyId
    : req.user.companyId;

  try {
    const result = await db.query(
      `SELECT
         u.id as operator_id,
         u.email as operator_email,
         u.role,
         u.status,
         COUNT(DISTINCT p.id) as profiles_count,
         COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'connected') as connected_profiles_count,
         COALESCE(SUM(p.sent_today), 0) as sent_today,
         COALESCE((
           SELECT COUNT(*) FROM sent_log s 
           JOIN profiles pr ON s.profile_id = pr.id 
           WHERE pr.assigned_user_id = u.id AND s.result = 'sent'
         ), 0) as total_sent,
         COALESCE((
           SELECT COUNT(*) FROM sent_log s 
           JOIN profiles pr ON s.profile_id = pr.id 
           WHERE pr.assigned_user_id = u.id AND s.result = 'error'
         ), 0) as total_errors,
         COALESCE((
           SELECT COUNT(*) FROM phone_queue q 
           JOIN profiles pr ON q.profile_id = pr.id 
           WHERE pr.assigned_user_id = u.id AND q.status = 'pending'
         ), 0) as total_pending,
         (
           SELECT MAX(s.sent_at) FROM sent_log s 
           JOIN profiles pr ON s.profile_id = pr.id 
           WHERE pr.assigned_user_id = u.id
         ) as last_activity
       FROM users u
       LEFT JOIN profiles p ON p.assigned_user_id = u.id
       WHERE u.company_id = $1 AND u.role IN ('user', 'admin') AND u.role != 'superadmin' AND u.email NOT ILIKE '%superadmin%'
       GROUP BY u.id, u.email, u.role, u.status
       ORDER BY (CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END), sent_today DESC, total_sent DESC`,
      [companyId]
    );

    const operators = result.rows.map(row => {
      const sent = parseInt(row.total_sent, 10);
      const errors = parseInt(row.total_errors, 10);
      const totalDispatched = sent + errors;
      const deliverabilityRate = totalDispatched > 0
        ? Math.round((sent / totalDispatched) * 100)
        : 100;

      return {
        operatorId: row.operator_id,
        operatorEmail: row.operator_email,
        role: row.role,
        status: row.status,
        profilesCount: parseInt(row.profiles_count, 10),
        connectedProfilesCount: parseInt(row.connected_profiles_count, 10),
        sentToday: parseInt(row.sent_today, 10),
        totalSent: sent,
        totalErrors: errors,
        totalPending: parseInt(row.total_pending, 10),
        deliverabilityRate: deliverabilityRate,
        lastActivity: row.last_activity
      };
    });

    res.json(operators);
  } catch (err) {
    console.error('[Stats Operators Comparison Error]', err);
    res.status(500).json({ error: 'Failed to fetch operators comparison' });
  }
});

// GET /stats/reports - Sent log history for reports & CSV export
router.get('/reports', requireRole('superadmin', 'admin'), async (req, res) => {
  const companyId = req.user.role === 'superadmin' && req.query.companyId
    ? req.query.companyId
    : req.user.companyId;
  const { profileId, operatorId, startDate, endDate, result: resultFilter, limit = 1000 } = req.query;

  try {
    let query = `
      SELECT s.id, s.phone_number, s.result, s.error_message, s.sent_at,
             p.id as profile_id, p.name as profile_name,
             u.id as operator_id, u.email as operator_email
      FROM sent_log s
      JOIN profiles p ON s.profile_id = p.id
      LEFT JOIN users u ON p.assigned_user_id = u.id
      WHERE p.company_id = $1 AND (u.role IS NULL OR (u.role != 'superadmin' AND u.email NOT ILIKE '%superadmin%'))
    `;
    const values = [companyId];
    let idx = 2;

    if (profileId) {
      query += ` AND s.profile_id = $${idx++}`;
      values.push(profileId);
    }

    if (operatorId) {
      query += ` AND p.assigned_user_id = $${idx++}`;
      values.push(operatorId);
    }

    if (resultFilter && (resultFilter === 'sent' || resultFilter === 'error')) {
      query += ` AND s.result = $${idx++}`;
      values.push(resultFilter);
    }

    if (startDate) {
      query += ` AND s.sent_at >= $${idx++}::timestamp`;
      values.push(`${startDate} 00:00:00`);
    }

    if (endDate) {
      query += ` AND s.sent_at <= $${idx++}::timestamp`;
      values.push(`${endDate} 23:59:59`);
    }

    query += ` ORDER BY s.sent_at DESC LIMIT $${idx}`;
    values.push(Math.min(parseInt(limit, 10) || 1000, 5000));

    const result = await db.query(query, values);

    // Summary counts for this filter
    const totalCount = result.rows.length;
    const sentCount = result.rows.filter(r => r.result === 'sent').length;
    const errorCount = result.rows.filter(r => r.result === 'error').length;
    const deliverabilityRate = totalCount > 0 ? Math.round((sentCount / totalCount) * 100) : 100;

    res.json({
      summary: {
        total: totalCount,
        sent: sentCount,
        errors: errorCount,
        deliverabilityRate
      },
      rows: result.rows
    });
  } catch (err) {
    console.error('[Stats Reports Error]', err);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

module.exports = router;
