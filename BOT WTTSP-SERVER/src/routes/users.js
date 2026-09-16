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
      `SELECT u.id, u.email, u.role, u.status, u.created_at,
              (SELECT COUNT(*) FROM profiles p WHERE p.assigned_user_id = u.id) as assigned_profiles
       FROM users u
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

// POST /users - Create a new user (checks user_limit & strict email)
router.post('/', async (req, res) => {
  const { email, password, role = 'user' } = req.body;
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

  // Company admin can ONLY create operators (role = 'user')
  if (req.user.role === 'admin' && role !== 'user') {
    return res.status(403).json({ error: 'Solo el Super Administrador puede designar o crear Administradores.' });
  }

  try {
    // 1. Check user_limit of company (only counting operators)
    const limitRes = await db.query(
      `SELECT c.user_limit, (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.role = 'user') as current_operators
       FROM companies c WHERE c.id = $1`,
      [companyId]
    );

    if (limitRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    const { user_limit, current_operators } = limitRes.rows[0];
    if (role === 'user' && parseInt(current_operators, 10) >= parseInt(user_limit, 10)) {
      return res.status(403).json({
        error: `Límite máximo de operadores alcanzado para esta empresa (${user_limit} máx). El SuperAdmin debe ampliar el cupo.`,
        code: 'USER_LIMIT_REACHED'
      });
    }

    // 2. Check email uniqueness
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Este correo electrónico ya está registrado en el sistema' });
    }

    // 3. Create user
    const passwordHash = await bcrypt.hash(password, 10);
    const insertRes = await db.query(
      `INSERT INTO users (company_id, email, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'active')
       RETURNING id, email, role, status, created_at`,
      [companyId, cleanEmail, passwordHash, role]
    );

    await logAudit(req, 'CREATE_USER', { userId: insertRes.rows[0].id, email: cleanEmail, role, companyId });

    res.status(201).json(insertRes.rows[0]);
  } catch (err) {
    console.error('[User POST Error]', err);
    res.status(500).json({ error: 'Error interno al crear el usuario' });
  }
});

// PATCH /users/:id - Activate/deactivate or change role
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
    const { status, role, email, password } = req.body;
    const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

    try {
      const fields = [];
      const values = [];
      let idx = 1;

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

      if (role !== undefined) {
        if (req.user.role !== 'superadmin') {
          return res.status(403).json({ error: 'Solo el Super Administrador puede modificar roles de usuario.' });
        }
        if (!['admin', 'user'].includes(role)) {
          return res.status(400).json({ error: 'Invalid role' });
        }
        fields.push(`role = $${idx++}`);
        values.push(role);
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

    query += ' RETURNING id, email, role, status';

    const result = await db.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or unauthorized' });
    }

    await logAudit(req, 'UPDATE_USER', { userId: id, status, role, email });

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
