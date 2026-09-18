const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const baileysManager = require('../services/baileys-manager');
const botEngine = require('../services/server-bot-engine');
const proxyPoolManager = require('../services/proxy-pool-manager');

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

    // Merge live Baileys session status into returned profiles
    const rows = result.rows.map(p => {
      const liveSession = baileysManager.getSession(p.id);
      const botState = botEngine.getBotState(p.id);
      return {
        ...p,
        live_status: liveSession.status || p.status,
        qr: liveSession.qr || null,
        phone_number: liveSession.phoneNumber || p.phone_number || '',
        bot_state: botState
      };
    });

    res.json(rows);
  } catch (err) {
    console.error('[Profiles GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

// POST /profiles - Create profile (Admin or SuperAdmin)
router.post('/', async (req, res) => {
  const { name, message = '', assigned_user_id, category } = req.body;
  const companyId = req.user.companyId;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'El nombre de la cuenta es obligatorio' });
  }

  const cleanCategory = (category && category.trim()) ? category.trim() : 'Movistar';

  const compId = req.user.role === 'superadmin' && req.body.companyId ? req.body.companyId : companyId;

  let effectiveAssignedUserId = assigned_user_id;
  if (req.user.role === 'user') {
    effectiveAssignedUserId = req.user.id;
  }

  try {
    // 1. Check Company-wide WhatsApp account limit and anti-ban defaults
    const compRes = await db.query(
      'SELECT whatsapp_limit, user_limit, max_profiles_per_operator, delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit FROM companies WHERE id = $1',
      [compId]
    );
    if (compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    const compData = compRes.rows[0];
    const maxCompanyWhatsApp = compData.whatsapp_limit || 10;
    const defaultPerOperator = 2;

    const countRes = await db.query('SELECT COUNT(*) FROM profiles WHERE company_id = $1', [compId]);
    const currentCompanyCount = parseInt(countRes.rows[0].count, 10);

    if (currentCompanyCount >= maxCompanyWhatsApp) {
      return res.status(403).json({
        error: `Has alcanzado el límite total de cuentas de WhatsApp contratadas para esta empresa (${maxCompanyWhatsApp} máx). Amplía el límite de la empresa para crear más cuentas.`,
        max: maxCompanyWhatsApp,
        code: 'COMPANY_WHATSAPP_LIMIT_REACHED'
      });
    }

    // 2. Validate assigned user belongs to this company and verify individual operator limit
    if (effectiveAssignedUserId) {
      const userCheck = await db.query(
        'SELECT id, email, role, whatsapp_limit FROM users WHERE id = $1 AND company_id = $2',
        [effectiveAssignedUserId, compId]
      );
      if (userCheck.rows.length === 0) {
        return res.status(400).json({ error: 'El operador asignado no pertenece a esta empresa' });
      }

      const userObj = userCheck.rows[0];
      const operatorLimit = userObj.whatsapp_limit !== null && userObj.whatsapp_limit !== undefined
        ? parseInt(userObj.whatsapp_limit, 10)
        : defaultPerOperator;

      const opCountRes = await db.query(
        'SELECT COUNT(*) FROM profiles WHERE assigned_user_id = $1',
        [effectiveAssignedUserId]
      );
      const currentOperatorCount = parseInt(opCountRes.rows[0].count, 10);

      if (currentOperatorCount >= operatorLimit) {
        const who = req.user.role === 'user' ? 'tu' : `este operador (${userObj.email})`;
        return res.status(403).json({
          error: `Se ha alcanzado el límite máximo de cuentas de WhatsApp asignado a ${who} (${operatorLimit} máx permitidas). Asigna más cupo a este operador para continuar.`,
          max: operatorLimit,
          code: 'OPERATOR_WHATSAPP_LIMIT_REACHED'
        });
      }
    }

    // Defaults for delays and anti-ban inherited from Company
    const delayMin = compData.delay_min || 115;
    const delayMax = compData.delay_max || 145;
    const batchSize = compData.batch_size || 15;
    const batchPauseMin = compData.batch_pause_min || 25;
    const batchPauseMax = compData.batch_pause_max || 30;
    const dailyLimit = compData.daily_limit || 200;

    const result = await db.query(
      `INSERT INTO profiles (
        company_id, assigned_user_id, name, message, category,
        delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit,
        status, is_active_bot, sent_today, last_sent_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'disconnected', FALSE, 0, CURRENT_DATE)
      RETURNING *`,
      [compId, effectiveAssignedUserId || null, name.trim(), message, cleanCategory, delayMin, delayMax, batchSize, batchPauseMin, batchPauseMax, dailyLimit]
    );

    // Auto-assign proxy slot from pool in groups of 20 (or VPS fallback) for this company
    proxyPoolManager.rebalanceCompanyProfiles(compId).catch(e => console.error('[Profile Auto-Assign Error]:', e.message));

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Profile POST Error]', err);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// GET /profiles/:id - Get profile by ID with live status
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

    if (req.user.role === 'user') {
      query += ` AND assigned_user_id = $${values.length + 1}`;
      values.push(req.user.id);
    }

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const liveSession = baileysManager.getSession(id);
    const profile = {
      ...result.rows[0],
      live_status: liveSession.status || result.rows[0].status,
      qr: liveSession.qr || null,
      phone_number: liveSession.phoneNumber || result.rows[0].phone_number || '',
      bot_state: botEngine.getBotState(id)
    };

    res.json(profile);
  } catch (err) {
    console.error('[Profile GET ID Error]', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PATCH /profiles/:id/config - Update configuration
// OPERATOR: Can ONLY edit 'name' and 'message'.
// ADMIN: Can edit 'name', 'message', and 'assigned_user_id'.
// SUPERADMIN: Can edit everything (delays, warmup, batches, schedule).
router.patch('/:id/config', async (req, res) => {
  const { id } = req.params;
  const {
    name, message, assigned_user_id, category,
    delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit,
    work_schedule_enabled, work_schedule_start, work_schedule_end, work_schedule_days,
    warmup_enabled, warmup_day, warmup_daily_increment, warmup_max_limit,
    proxy_url
  } = req.body;

  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    // Both Operator and Admin can edit name, message & category (product class)
    if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name.trim()); }
    if (message !== undefined) { fields.push(`message = $${idx++}`); values.push(message); }
    if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category.trim()); }

    // Admin or SuperAdmin can reassign operator
    if (assigned_user_id !== undefined && req.user.role !== 'user') {
      if (assigned_user_id) {
        const targetOp = await db.query(
          `SELECT u.id, u.email, u.whatsapp_limit, c.max_profiles_per_operator
           FROM users u
           JOIN companies c ON u.company_id = c.id
           WHERE u.id = $1`,
          [assigned_user_id]
        );
        if (targetOp.rows.length === 0) {
          return res.status(400).json({ error: 'Operador no encontrado' });
        }
        const opObj = targetOp.rows[0];
        const opLimit = opObj.whatsapp_limit !== null && opObj.whatsapp_limit !== undefined
          ? parseInt(opObj.whatsapp_limit, 10)
          : 2;

        const currentOpProfiles = await db.query(
          'SELECT COUNT(*) FROM profiles WHERE assigned_user_id = $1 AND id != $2',
          [assigned_user_id, id]
        );
        if (parseInt(currentOpProfiles.rows[0].count, 10) >= opLimit && req.user.role !== 'superadmin') {
          return res.status(403).json({
            error: `El operador ${opObj.email} ya alcanzó su límite asignado (${opLimit} cuentas de WhatsApp máx).`
          });
        }
      }
      fields.push(`assigned_user_id = $${idx++}`);
      values.push(assigned_user_id || null);
    }

    // Delays, Anti-ban, and Proxies can ONLY be modified by SuperAdmin
    if (req.user.role === 'superadmin') {
      if (delay_min !== undefined) { fields.push(`delay_min = $${idx++}`); values.push(parseInt(delay_min, 10)); }
      if (delay_max !== undefined) { fields.push(`delay_max = $${idx++}`); values.push(parseInt(delay_max, 10)); }
      if (batch_size !== undefined) { fields.push(`batch_size = $${idx++}`); values.push(parseInt(batch_size, 10)); }
      if (batch_pause_min !== undefined) { fields.push(`batch_pause_min = $${idx++}`); values.push(parseInt(batch_pause_min, 10)); }
      if (batch_pause_max !== undefined) { fields.push(`batch_pause_max = $${idx++}`); values.push(parseInt(batch_pause_max, 10)); }
      if (daily_limit !== undefined) { fields.push(`daily_limit = $${idx++}`); values.push(parseInt(daily_limit, 10)); }

      if (work_schedule_enabled !== undefined) { fields.push(`work_schedule_enabled = $${idx++}`); values.push(Boolean(work_schedule_enabled)); }
      if (work_schedule_start !== undefined) { fields.push(`work_schedule_start = $${idx++}`); values.push(work_schedule_start); }
      if (work_schedule_end !== undefined) { fields.push(`work_schedule_end = $${idx++}`); values.push(work_schedule_end); }
      if (work_schedule_days !== undefined) { fields.push(`work_schedule_days = $${idx++}`); values.push(work_schedule_days); }

      if (warmup_enabled !== undefined) { fields.push(`warmup_enabled = $${idx++}`); values.push(Boolean(warmup_enabled)); }
      if (warmup_day !== undefined) { fields.push(`warmup_day = $${idx++}`); values.push(parseInt(warmup_day, 10)); }
      if (warmup_daily_increment !== undefined) { fields.push(`warmup_daily_increment = $${idx++}`); values.push(parseInt(warmup_daily_increment, 10)); }
      if (warmup_max_limit !== undefined) { fields.push(`warmup_max_limit = $${idx++}`); values.push(parseInt(warmup_max_limit, 10)); }

      if (proxy_url !== undefined) {
        fields.push(`proxy_url = $${idx++}`);
        values.push(proxy_url ? proxy_url.trim() : null);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update or insufficient permissions' });
    }

    let query = `UPDATE profiles SET ${fields.join(', ')} WHERE id = $${idx++}`;
    values.push(id);

    if (companyId) {
      query += ` AND company_id = $${idx++}`;
      values.push(companyId);
    }

    if (req.user.role === 'user') {
      query += ` AND assigned_user_id = $${idx++}`;
      values.push(req.user.id);
    }

    query += ' RETURNING *';

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found or unauthorized' });
    }

    // If SuperAdmin updated proxy_url and WhatsApp session is running, restart session with new proxy
    if (proxy_url !== undefined && baileysManager.getSession(id).status !== 'disconnected') {
      console.log(`[API] Proxy changed for active session ${id}. Reconnecting with updated proxy...`);
      baileysManager.disconnectSession(id).then(() => baileysManager.initSession(id)).catch(e => {
        console.error(`[API] Error reconnecting with new proxy:`, e.message);
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Profile PATCH Error]', err);
    res.status(500).json({ error: 'Failed to update profile config' });
  }
});

// POST /profiles/:id/connect - Trigger Baileys WhatsApp Connection & QR generation
router.post('/:id/connect', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let query = 'SELECT id, name FROM profiles WHERE id = $1';
    const values = [id];
    if (companyId) {
      query += ' AND company_id = $2';
      values.push(companyId);
    }
    if (req.user.role === 'user') {
      query += ` AND assigned_user_id = $${values.length + 1}`;
      values.push(req.user.id);
    }

    const check = await db.query(query, values);
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found or unauthorized' });
    }

    console.log(`[API] Initiating WhatsApp connection for profile '${check.rows[0].name}' (${id})`);
    const sessionResult = await baileysManager.initSession(id);
    res.json(sessionResult);
  } catch (err) {
    console.error('[Profile Connect Error]', err);
    res.status(500).json({ error: err.message || 'Error initializing WhatsApp' });
  }
});

// POST /profiles/:id/disconnect - Disconnect WhatsApp
router.post('/:id/disconnect', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let checkQuery = 'SELECT id, name FROM profiles WHERE id = $1';
    const checkValues = [id];
    if (companyId) {
      checkQuery += ` AND company_id = $${checkValues.length + 1}`;
      checkValues.push(companyId);
    }
    if (req.user.role === 'user') {
      checkQuery += ` AND assigned_user_id = $${checkValues.length + 1}`;
      checkValues.push(req.user.id);
    }
    const checkResult = await db.query(checkQuery, checkValues);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Perfil no encontrado o no autorizado' });
    }

    await baileysManager.disconnectSession(id);
    await botEngine.stopBot(id);
    res.json({ success: true, message: 'WhatsApp desconectado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /profiles/:id/unlink - Unlink WhatsApp and delete session
router.post('/:id/unlink', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let checkQuery = 'SELECT id, name FROM profiles WHERE id = $1';
    const checkValues = [id];
    if (companyId) {
      checkQuery += ` AND company_id = $${checkValues.length + 1}`;
      checkValues.push(companyId);
    }
    if (req.user.role === 'user') {
      checkQuery += ` AND assigned_user_id = $${checkValues.length + 1}`;
      checkValues.push(req.user.id);
    }
    const checkResult = await db.query(checkQuery, checkValues);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Perfil no encontrado o no autorizado' });
    }

    await botEngine.stopBot(id);
    await baileysManager.unlinkSession(id);
    res.json({ success: true, message: 'Cuenta desvinculada exitosamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /profiles/:id/toggle-bot - Turn Bot ON or OFF
router.post('/:id/toggle-bot', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'start' or 'stop'
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let checkQuery = 'SELECT id, name FROM profiles WHERE id = $1';
    const checkValues = [id];
    if (companyId) {
      checkQuery += ` AND company_id = $${checkValues.length + 1}`;
      checkValues.push(companyId);
    }
    if (req.user.role === 'user') {
      checkQuery += ` AND assigned_user_id = $${checkValues.length + 1}`;
      checkValues.push(req.user.id);
    }
    const checkResult = await db.query(checkQuery, checkValues);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Perfil no encontrado o no autorizado' });
    }

    if (action === 'start') {
      const liveSession = baileysManager.getSession(id);
      if (liveSession.status !== 'connected') {
        return res.status(400).json({ error: 'No se puede encender el bot: la cuenta de WhatsApp no está conectada. Escanea el código QR primero.' });
      }
      const result = await botEngine.startBot(id);
      res.json(result);
    } else {
      const result = await botEngine.stopBot(id);
      res.json(result);
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /profiles/:id - Delete profile
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let checkQuery = 'SELECT id, name FROM profiles WHERE id = $1';
    const checkValues = [id];

    if (companyId) {
      checkQuery += ` AND company_id = $${checkValues.length + 1}`;
      checkValues.push(companyId);
    }

    if (req.user.role === 'user') {
      checkQuery += ` AND assigned_user_id = $${checkValues.length + 1}`;
      checkValues.push(req.user.id);
    }

    const checkResult = await db.query(checkQuery, checkValues);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found or unauthorized' });
    }

    // Stop bot & unlink session first (only after verifying authorization)
    await botEngine.stopBot(id);
    await baileysManager.unlinkSession(id);

    const profCheck = await db.query('SELECT company_id FROM profiles WHERE id = $1', [id]);
    const profCompId = profCheck.rows[0]?.company_id;

    await db.query('DELETE FROM profiles WHERE id = $1', [id]);

    // Auto-rebalance proxies across remaining accounts of this company
    if (profCompId) {
      proxyPoolManager.rebalanceCompanyProfiles(profCompId).catch(e => console.error('[Profile Rebalance Error]:', e.message));
    }

    res.json({ message: 'Profile deleted successfully', id });
  } catch (err) {
    console.error('[Profile DELETE Error]', err);
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

module.exports = router;
