const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const { logAudit } = require('../utils/audit');

// All user management routes require at least admin
router.use(authenticateToken, requireRole('superadmin', 'admin'));

// GET /users - List users of the tenant
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.role === 'superadmin' && req.query.companyId 
      ? req.query.companyId 
      : req.user.companyId;

    const result = await db.query(
      `SELECT u.id, u.email, u.role, u.status, u.created_at, u.whatsapp_limit,
              (SELECT COUNT(*) FROM profiles p WHERE p.assigned_user_id = u.id) as assigned_profiles,
              c.whatsapp_limit as company_whatsapp_limit,
              (SELECT COALESCE(SUM(u2.whatsapp_limit), 0) FROM users u2 WHERE u2.company_id = c.id) as company_total_allocated_quota,
              (SELECT COALESCE(SUM(u3.whatsapp_limit), 0) FROM users u3 WHERE u3.company_id = c.id AND u3.id != u.id) as other_users_quota
       FROM users u
       LEFT JOIN companies c ON u.company_id = c.id
       WHERE u.company_id = $1 AND u.role != 'superadmin' AND u.email NOT ILIKE '%superadmin%'
       ORDER BY u.created_at ASC`,
      [companyId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('[Users GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Strict Email Regex Validation
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// POST /users - Create a new user (checks user_limit, zero-sum whatsapp_limit & strict email)
router.post('/', async (req, res) => {
  const { email, password, role = 'user', whatsapp_limit } = req.body;
  const companyId = req.user.role === 'superadmin' && req.body.companyId 
    ? req.body.companyId 
    : req.user.companyId;

  if (!email || !password) {
    return res.status(400).json({ error: 'El email y la contraseña son obligatorios' });
  }

  const cleanEmail = email.toLowerCase().trim();
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return res.status(400).json({ 
      error: 'Formato de correo electrónico inválido. Debe contener "@" y terminar con un dominio válido (ej: usuario@empresa.com).' 
    });
  }

  // Only superadmin can create or set admin users
  if (role === 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo el Super Administrador puede designar o crear Administradores.' });
  }

  try {
    // 1. Check user_limit and company whatsapp_limit
    const limitRes = await db.query(
      `SELECT c.user_limit, c.whatsapp_limit,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.role = 'user') as current_operators
       FROM companies c WHERE c.id = $1`,
      [companyId]
    );

    if (limitRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const { user_limit, whatsapp_limit: companyWhatsappLimit, current_operators } = limitRes.rows[0];
    if (role === 'user' && parseInt(current_operators, 10) >= parseInt(user_limit, 10)) {
      return res.status(403).json({
        error: `Límite máximo de operadores alcanzado para esta empresa (${user_limit} máx). El SuperAdmin debe ampliar el cupo.`,
        code: 'USER_LIMIT_REACHED'
      });
    }

    // Calculate remaining unallocated quota in the company
    const allocRes = await db.query(
      'SELECT COALESCE(SUM(whatsapp_limit), 0) as total_allocated FROM users WHERE company_id = $1',
      [companyId]
    );
    const totalAllocated = parseInt(allocRes.rows[0].total_allocated, 10);
    const compTotalWA = parseInt(companyWhatsappLimit, 10) || 10;
    const freeQuota = Math.max(0, compTotalWA - totalAllocated);

    let effectiveLimit;
    if (whatsapp_limit !== undefined && whatsapp_limit !== null && whatsapp_limit !== '') {
      effectiveLimit = parseInt(whatsapp_limit, 10);
      if (isNaN(effectiveLimit) || effectiveLimit < 0) {
        return res.status(400).json({ error: 'El cupo de WhatsApp debe ser un número entero mayor o igual a 0.' });
      }
      if (effectiveLimit > freeQuota) {
        return res.status(400).json({
          error: `No hay suficientes cupos disponibles en la empresa. Cupos libres actuales: ${freeQuota} (de ${compTotalWA} totales). Reduce el cupo de otros operadores para asignarle ${effectiveLimit}.`
        });
      }
    } else {
      // Default to min(2, freeQuota). If 0 free, they get 0.
      effectiveLimit = Math.min(2, freeQuota);
    }

    // 2. Check email uniqueness
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Este correo electrónico ya está registrado en el sistema' });
    }

    // 3. Create user
    const passwordHash = await bcrypt.hash(password, 10);
    const insertRes = await db.query(
      `INSERT INTO users (company_id, email, password_hash, role, whatsapp_limit, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id, email, role, status, whatsapp_limit, created_at`,
      [companyId, cleanEmail, passwordHash, role, effectiveLimit]
    );

    await logAudit(req, 'CREATE_USER', { userId: insertRes.rows[0].id, email: cleanEmail, role, whatsappLimit: effectiveLimit, companyId });

    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error('[User POST Error]', err);
    res.status(500).json({ error: 'Error interno al crear el usuario' });
  }
});

// PATCH /users/:id - Activate/deactivate, change role, or update individual WhatsApp limit
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { status, role, email, password, whatsapp_limit } = req.body;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    // Target user existence & safety check
    const targetUser = await db.query('SELECT role, company_id FROM users WHERE id = $1', [id]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (targetUser.rows[0].role === 'superadmin') {
      return res.status(403).json({ error: 'No se puede modificar la cuenta del Super Administrador.' });
    }
    if (companyId && targetUser.rows[0].company_id !== companyId) {
      return res.status(403).json({ error: 'No tienes permiso para modificar usuarios de otra empresa.' });
    }

    if (email !== undefined) {
      const cleanEmail = email.toLowerCase().trim();
      if (!EMAIL_REGEX.test(cleanEmail)) {
        return res.status(400).json({ 
          error: 'Formato de correo electrónico inválido. Debe contener "@" y terminar con un dominio válido.' 
        });
      }
      fields.push(`email = $${idx++}`);
      values.push(cleanEmail);
    }

    if (password !== undefined && password.trim() !== '') {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (status !== undefined) {
      if (!['active', 'disabled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      fields.push(`status = $${idx++}`);
      values.push(status);
    }

    if (role !== undefined && role !== targetUser.rows[0].role) {
      if (req.user.role !== 'superadmin') {
        return res.status(403).json({ error: 'Solo el Super Administrador puede modificar roles de usuario.' });
      }
      if (!['admin', 'user'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      fields.push(`role = $${idx++}`);
      values.push(role);
    }

    if (whatsapp_limit !== undefined && whatsapp_limit !== null && whatsapp_limit !== '') {
      const parsedLimit = parseInt(whatsapp_limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 0) {
        return res.status(400).json({ error: 'El cupo de WhatsApp debe ser un número entero mayor o igual a 0.' });
      }

      // Fetch company whatsapp_limit AND sum of quotas of other users in this company
      const compRes = await db.query(
        `SELECT c.whatsapp_limit as comp_limit,
                COALESCE(SUM(u.whatsapp_limit), 0) as other_quotas
         FROM companies c
         LEFT JOIN users u ON u.company_id = c.id AND u.id != $1
         WHERE c.id = $2
         GROUP BY c.whatsapp_limit`,
        [id, targetUser.rows[0].company_id]
      );
      const compLimit = compRes.rows.length > 0 ? (parseInt(compRes.rows[0].comp_limit, 10) || 10) : 10;
      const otherQuotas = compRes.rows.length > 0 ? (parseInt(compRes.rows[0].other_quotas, 10) || 0) : 0;
      const maxAvailableForUser = Math.max(0, compLimit - otherQuotas);

      // Floor check: cannot lower below accounts already created by this user
      const assignedRes = await db.query(
        'SELECT COUNT(*) FROM profiles WHERE assigned_user_id = $1',
        [id]
      );
      const currentAssigned = parseInt(assignedRes.rows[0].count, 10);
      if (parsedLimit < currentAssigned) {
        return res.status(400).json({
          error: `El cupo no puede ser menor a las cuentas que ya tiene creadas (${currentAssigned}). Para reducir el cupo primero debes eliminar o desvincular cuentas de este operador.`
        });
      }

      // Ceiling check: cannot exceed remaining available unallocated quota
      if (parsedLimit > maxAvailableForUser) {
        return res.status(400).json({
          error: `No puedes asignar ${parsedLimit} cupos. El máximo disponible para este operador es ${maxAvailableForUser}, ya que los demás operadores tienen asignados ${otherQuotas} de los ${compLimit} cupos totales de la empresa. Libera cupos de otros operadores para aumentarlo.`
        });
      }

      fields.push(`whatsapp_limit = $${idx++}`);
      values.push(parsedLimit);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    let query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx++}`;
    values.push(id);

    if (companyId) {
      query += ` AND company_id = $${idx++}`;
      values.push(companyId);
    }

    query += ' RETURNING id, email, role, status, whatsapp_limit';

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or unauthorized' });
    }

    await logAudit(req, 'UPDATE_USER', { userId: id, status, role, email, whatsapp_limit });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[User PATCH Error]', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// POST /users/:id/reset-defaults - Reset individual user/operator/admin settings
router.post('/:id/reset-defaults', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    // 1. Verify user exists
    let checkQuery = 'SELECT id, email, role FROM users WHERE id = $1';
    const checkVals = [id];
    if (companyId) {
      checkQuery += ' AND company_id = $2';
      checkVals.push(companyId);
    }
    const userRes = await db.query(checkQuery, checkVals);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // 2. Reset user's profiles to default delays, daily limits, disconnected status
    await db.query(
      `UPDATE profiles SET 
        delay_min = 115, 
        delay_max = 145, 
        batch_size = 15, 
        batch_pause_min = 25, 
        batch_pause_max = 30, 
        daily_limit = 200, 
        status = 'disconnected'
       WHERE assigned_user_id = $1`,
      [id]
    );

    // 3. Ensure user status is active
    await db.query("UPDATE users SET status = 'active' WHERE id = $1", [id]);

    await logAudit(req, 'RESET_USER_DEFAULTS', { userId: id, email: userRes.rows[0].email });

    res.json({ message: 'Configuraciones de base reestablecidas exitosamente para el usuario', userId: id });
  } catch (err) {
    console.error('[User Reset Error]', err);
    res.status(500).json({ error: 'Error al reiniciar configuraciones del usuario' });
  }
});

// DELETE /users/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

  try {
    let query = 'DELETE FROM users WHERE id = $1';
    const values = [id];

    if (companyId) {
      query += ' AND company_id = $2';
      values.push(companyId);
    }
    query += ' RETURNING id, email';

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or unauthorized' });
    }

    await logAudit(req, 'DELETE_USER', { userId: id, email: result.rows[0].email });

    res.json({ message: 'User deleted successfully', id });
  } catch (err) {
    console.error('[User DELETE Error]', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
