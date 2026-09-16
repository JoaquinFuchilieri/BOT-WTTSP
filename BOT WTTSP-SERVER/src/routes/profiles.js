const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');

router.use(authenticateToken);

// GET /profiles - List profiles for the tenant
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.role === 'superadmin' && req.query.companyId 
      ? req.query.companyId 
      : req.user.companyId;

    let query = `
      SELECT p.*, u.email as assigned_user_email,
             (SELECT COUNT(*) FROM phone_queue q WHERE q.profile_id = p.id AND q.status = 'pending') as pending_count,
             (SELECT COUNT(*) FROM phone_queue q WHERE q.profile_id = p.id AND q.status = 'error') as error_count
      FROM profiles p
      LEFT JOIN users u ON p.assigned_user_id = u.id
      WHERE p.company_id = $1
    `;
    const values = [companyId];

    // If operator (role = user), strictly only show their own assigned profiles
    if (req.user.role === 'user') {
      query += ` AND p.assigned_user_id = $2`;
      values.push(req.user.id);
    } else if (req.query.assigned_user_id) {
      query += ` AND p.assigned_user_id = $${values.length + 1}`;
      values.push(req.query.assigned_user_id);
    }

    query += ' ORDER BY p.created_at ASC';

    const result = await db.query(query, values);

    // Reset sent_today if date changed (server-side check)
    const today = new Date().toISOString().split('T')[0];
    for (const p of result.rows) {
      const pDate = p.last_sent_date ? new Date(p.last_sent_date).toISOString().split('T')[0] : '';
      if (pDate !== today) {
        await db.query('UPDATE profiles SET sent_today = 0, last_sent_date = CURRENT_DATE WHERE id = $1', [p.id]);
        p.sent_today = 0;
      }
    }

    res.json(result.rows);
  } catch (err) {
    console.error('[Profiles GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// POST /profiles - Create profile (Admin, SuperAdmin or Operator for self)
router.post('/', async (req, res) => {
  const { name, message = '', delay_min = 115, delay_max = 145, batch_size = 15, batch_pause_min = 25, batch_pause_max = 30, daily_limit = 200, assigned_user_id } = req.body;
  const companyId = req.user.companyId;

  if (!name) {
    return res.status(400).json({ error: 'El nombre de la cuenta es obligatorio' });
  }

  const compId = req.user.role === 'superadmin' && req.body.companyId ? req.body.companyId : companyId;

  let effectiveAssignedUserId = assigned_user_id;
  if (req.user.role === 'user') {
    // Operators can only create profiles assigned to themselves
    effectiveAssignedUserId = req.user.id;
  }

  if (req.user.role !== 'superadmin' && !effectiveAssignedUserId) {
    return res.status(400).json({ error: 'Debe seleccionarse obligatoriamente un operador responsable. No se permiten cuentas sin asignar.' });
  }

  try {
    if (effectiveAssignedUserId) {
      // Verify assigned user belongs to this company
      const userCheck = await db.query('SELECT id, email, role FROM users WHERE id = $1 AND company_id = $2', [effectiveAssignedUserId, compId]);
      if (userCheck.rows.length === 0) {
        return res.status(400).json({ error: 'El usuario asignado no pertenece a esta empresa o no existe' });
      }

      // Check max_profiles_per_operator for this company
      const compRes = await db.query('SELECT max_profiles_per_operator FROM companies WHERE id = $1', [compId]);
      const maxAllowed = compRes.rows.length > 0 ? (compRes.rows[0].max_profiles_per_operator || 3) : 3;

      const countRes = await db.query(
        'SELECT COUNT(*) FROM profiles WHERE assigned_user_id = $1',
        [effectiveAssignedUserId]
      );
      const currentCount = parseInt(countRes.rows[0].count, 10);

      if (currentCount >= maxAllowed) {
        return res.status(403).json({
          error: `Has alcanzado el límite de chats que puedes iniciar. Máximo: ${maxAllowed}`,
          max: maxAllowed,
          code: 'OPERATOR_PROFILE_LIMIT_REACHED'
        });
      }
    }

    const result = await db.query(
      `INSERT INTO profiles (
        company_id, assigned_user_id, name, message, 
        delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit,
        status, sent_today, last_sent_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'disconnected', 0, CURRENT_DATE)
      RETURNING *`,
      [
        compId, effectiveAssignedUserId || null, name.trim(), message,
        parseInt(delay_min, 10), parseInt(delay_max, 10), parseInt(batch_size, 10),
        parseInt(batch_pause_min, 10), parseInt(batch_pause_max, 10), parseInt(daily_limit, 10)
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Profile POST Error]', err);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// GET /profiles/:id - Get profile by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let query = 'SELECT * FROM profiles WHERE id = $1';
    const values = [id];

    if (companyId) {
      query += ' AND company_id = $2';
      values.push(companyId);
    }

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Profile GET ID Error]', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PATCH /profiles/:id/config - Update message, delays, limits, work schedule, warmup
router.patch('/:id/config', async (req, res) => {
  const { id } = req.params;
  const {
    name, message, delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit, assigned_user_id, status,
    work_schedule_enabled, work_schedule_start, work_schedule_end, work_schedule_days,
    warmup_enabled, warmup_day, warmup_daily_increment, warmup_max_limit,
    is_paused_early_warning, early_warning_reason
  } = req.body;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name.trim()); }
    if (message !== undefined) { fields.push(`message = $${idx++}`); values.push(message); }
    if (delay_min !== undefined) { fields.push(`delay_min = $${idx++}`); values.push(parseInt(delay_min, 10)); }
    if (delay_max !== undefined) { fields.push(`delay_max = $${idx++}`); values.push(parseInt(delay_max, 10)); }
    if (batch_size !== undefined) { fields.push(`batch_size = $${idx++}`); values.push(parseInt(batch_size, 10)); }
    if (batch_pause_min !== undefined) { fields.push(`batch_pause_min = $${idx++}`); values.push(parseInt(batch_pause_min, 10)); }
    if (batch_pause_max !== undefined) { fields.push(`batch_pause_max = $${idx++}`); values.push(parseInt(batch_pause_max, 10)); }
    if (daily_limit !== undefined) { fields.push(`daily_limit = $${idx++}`); values.push(parseInt(daily_limit, 10)); }
    if (assigned_user_id !== undefined && req.user.role !== 'user') {
      fields.push(`assigned_user_id = $${idx++}`);
      values.push(assigned_user_id || null);
    }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }

    // Work schedule fields
    if (work_schedule_enabled !== undefined) { fields.push(`work_schedule_enabled = $${idx++}`); values.push(Boolean(work_schedule_enabled)); }
    if (work_schedule_start !== undefined) { fields.push(`work_schedule_start = $${idx++}`); values.push(work_schedule_start); }
    if (work_schedule_end !== undefined) { fields.push(`work_schedule_end = $${idx++}`); values.push(work_schedule_end); }
    if (work_schedule_days !== undefined) { fields.push(`work_schedule_days = $${idx++}`); values.push(work_schedule_days); }

    // Warmup mode fields
    if (warmup_enabled !== undefined) { fields.push(`warmup_enabled = $${idx++}`); values.push(Boolean(warmup_enabled)); }
    if (warmup_day !== undefined) { fields.push(`warmup_day = $${idx++}`); values.push(parseInt(warmup_day, 10)); }
    if (warmup_daily_increment !== undefined) { fields.push(`warmup_daily_increment = $${idx++}`); values.push(parseInt(warmup_daily_increment, 10)); }
    if (warmup_max_limit !== undefined) { fields.push(`warmup_max_limit = $${idx++}`); values.push(parseInt(warmup_max_limit, 10)); }

    // Early warning flags
    if (is_paused_early_warning !== undefined) { fields.push(`is_paused_early_warning = $${idx++}`); values.push(Boolean(is_paused_early_warning)); }
    if (early_warning_reason !== undefined) { fields.push(`early_warning_reason = $${idx++}`); values.push(early_warning_reason); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    let query = `UPDATE profiles SET ${fields.join(', ')} WHERE id = $${idx++}`;
    values.push(id);

    if (companyId) {
      query += ` AND company_id = $${idx++}`;
      values.push(companyId);
    }

    if (req.user.role === 'user') {
      // Operators can strictly only update their own assigned profile
      query += ` AND assigned_user_id = $${idx++}`;
      values.push(req.user.id);
    }

    query += ' RETURNING *';

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found or unauthorized' });
    }

    // Log configuration changes in audit log
    const { logAudit } = require('../utils/audit');
    await logAudit(req, 'PROFILE_CONFIG_UPDATED', {
      profileId: id,
      name: result.rows[0].name,
      updatedFields: Object.keys(req.body)
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Profile PATCH Error]', err);
    res.status(500).json({ error: 'Failed to update profile config' });
  }
});

// DELETE /profiles/:id - Delete profile (SuperAdmin, Admin, or Operator for their own profile)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let query = 'DELETE FROM profiles WHERE id = $1';
    const values = [id];

    if (companyId) {
      query += ` AND company_id = $${values.length + 1}`;
      values.push(companyId);
    }

    if (req.user.role === 'user') {
      // Operators can only delete profiles assigned to themselves
      query += ` AND assigned_user_id = $${values.length + 1}`;
      values.push(req.user.id);
    }
    query += ' RETURNING id';

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found or unauthorized' });
    }

    res.json({ message: 'Profile deleted successfully', id });
  } catch (err) {
    console.error('[Profile DELETE Error]', err);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

module.exports = router;
