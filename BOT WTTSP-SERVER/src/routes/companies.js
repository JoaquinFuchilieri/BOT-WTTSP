const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const { logAudit } = require('../utils/audit');

// Multer storage setup for support tickets (.png and .pdf ONLY)
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `ticket-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.pdf'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos con extensión .png o .pdf'));
    }
  }
});

// Base auth
router.use(authenticateToken);

// GET /companies - List all companies with usage stats (SuperAdmin only)
router.get('/', requireRole('superadmin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.id, c.name, c.status, c.user_limit, c.whatsapp_limit, c.max_profiles_per_operator, c.created_at,
             p.name as plan_name,
             (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.role = 'user') as user_count,
             (SELECT COUNT(*) FROM profiles pr WHERE pr.company_id = c.id) as profile_count,
             (SELECT COUNT(*) FROM sent_log s JOIN profiles pr ON s.profile_id = pr.id WHERE pr.company_id = c.id AND s.result = 'sent') as total_sent
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[Companies GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// GET /companies/:id/details - Full breakdown of a company (Users, Profiles, Stats)
router.get('/:id/details', requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    const compRes = await db.query(
      `SELECT c.*, p.name as plan_name FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
      [id]
    );
    if (compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const usersRes = await db.query(
      `SELECT id, email, role, status, created_at FROM users WHERE company_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    const profilesRes = await db.query(
      `SELECT id, name, status, sent_today, daily_limit FROM profiles WHERE company_id = $1 ORDER BY created_at ASC`,
      [id]
    );

    const statsRes = await db.query(
      `SELECT 
         (SELECT COUNT(*) FROM sent_log s JOIN profiles pr ON s.profile_id = pr.id WHERE pr.company_id = $1 AND s.result = 'sent') as total_sent,
         (SELECT COUNT(*) FROM phone_queue q JOIN profiles pr ON q.profile_id = pr.id WHERE pr.company_id = $1 AND q.status = 'pending') as total_pending,
         (SELECT COUNT(*) FROM phone_queue q JOIN profiles pr ON q.profile_id = pr.id WHERE pr.company_id = $1 AND q.status = 'error') as total_error`,
      [id]
    );

    res.json({
      company: compRes.rows[0],
      users: usersRes.rows,
      profiles: profilesRes.rows,
      stats: statsRes.rows[0]
    });
  } catch (err) {
    console.error('[Company Details Error]', err);
    res.status(500).json({ error: 'Failed to fetch company details' });
  }
});

// POST /companies - Create company + initial admin user
router.post('/', requireRole('superadmin'), async (req, res) => {
  const { name, adminEmail, adminPassword, planId, userLimit, whatsappLimit, maxProfilesPerOperator } = req.body;

  if (!name || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'name, adminEmail, and adminPassword are required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Check if email is already taken
    const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail.toLowerCase().trim()]);
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Insert company
    const companyRes = await client.query(
      'INSERT INTO companies (name, plan_id, user_limit, whatsapp_limit, max_profiles_per_operator, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name.trim(), planId || null, userLimit || 5, whatsappLimit || 10, maxProfilesPerOperator || 2, 'active']
    );
    const company = companyRes.rows[0];

    // Hash password & insert admin user
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    const userRes = await client.query(
      'INSERT INTO users (company_id, email, password_hash, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, status',
      [company.id, adminEmail.toLowerCase().trim(), passwordHash, 'admin', 'active']
    );

    await client.query('COMMIT');
    res.status(201).json({
      company,
      admin: userRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Company Create Error]', err);
    res.status(500).json({ error: 'Failed to create company' });
  } finally {
    client.release();
  }
});

// PATCH /companies/:id - Update company status, user_limit, whatsapp_limit, max_profiles_per_operator, plan
router.patch('/:id', requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { name, status, userLimit, whatsappLimit, maxProfilesPerOperator, planId } = req.body;

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(name.trim());
    }
    if (status !== undefined) {
      if (!['active', 'suspended'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be active or suspended' });
      }
      fields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (userLimit !== undefined) {
      const parsedUserLimit = parseInt(userLimit, 10);
      if (isNaN(parsedUserLimit) || parsedUserLimit < 1) {
        return res.status(400).json({ error: 'El límite de operadores debe ser un número entero mayor a 0' });
      }
      const userCountRes = await db.query('SELECT COUNT(*) as count FROM users WHERE company_id = $1 AND role = \'user\'', [id]);
      const currentUsers = parseInt(userCountRes.rows[0].count, 10);
      if (parsedUserLimit < currentUsers) {
        return res.status(400).json({
          error: `No puedes reducir el límite a ${parsedUserLimit} operadores porque la empresa ya tiene ${currentUsers} operadores creados. Debes eliminar operadores primero.`
        });
      }
      fields.push(`user_limit = $${idx++}`);
      values.push(parsedUserLimit);
    }
    if (whatsappLimit !== undefined) {
      const parsedWaLimit = parseInt(whatsappLimit, 10);
      if (isNaN(parsedWaLimit) || parsedWaLimit < 1) {
        return res.status(400).json({ error: 'El total de WhatsApps habilitados debe ser un número entero mayor a 0' });
      }

      // Check active profiles created
      const countRes = await db.query('SELECT COUNT(*) as count FROM profiles WHERE company_id = $1', [id]);
      const currentCreated = parseInt(countRes.rows[0].count, 10);
      if (parsedWaLimit < currentCreated) {
        return res.status(400).json({
          error: `No puedes reducir el límite de la empresa a ${parsedWaLimit} porque ya hay ${currentCreated} cuentas de WhatsApp creadas activas en la empresa. Primero deben eliminar cuentas.`
        });
      }

      // Check allocated operator quotas
      const allocRes = await db.query('SELECT COALESCE(SUM(whatsapp_limit), 0) as total_alloc FROM users WHERE company_id = $1', [id]);
      const currentAlloc = parseInt(allocRes.rows[0].total_alloc, 10);
      if (parsedWaLimit < currentAlloc) {
        return res.status(400).json({
          error: `No puedes reducir el límite a ${parsedWaLimit} porque los operadores tienen asignados un total de ${currentAlloc} cupos. Primero reduce los cupos asignados a los operadores.`
        });
      }

      fields.push(`whatsapp_limit = $${idx++}`);
      values.push(parsedWaLimit);
    }
    if (planId !== undefined) {
      fields.push(`plan_id = $${idx++}`);
      values.push(planId);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await db.query(
      `UPDATE companies SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    await logAudit(req, 'UPDATE_COMPANY', { companyId: id, name, status, userLimit, maxProfilesPerOperator });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Company Patch Error]', err);
    res.status(500).json({ error: 'Failed to update company' });
  }
});

// GET /companies/:id/antiban - Get company anti-ban defaults
router.get('/:id/antiban', requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    const compRes = await db.query(
      `SELECT id, name, delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit,
              work_schedule_enabled, work_schedule_start, work_schedule_end, work_schedule_days
       FROM companies WHERE id = $1`,
      [id]
    );
    if (compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }
    res.json(compRes.rows[0]);
  } catch (err) {
    console.error('[Company Antiban GET Error]', err);
    res.status(500).json({ error: 'Error al obtener configuración anti-ban' });
  }
});

// PUT /companies/:id/antiban - Update company anti-ban defaults and optionally update all existing profiles
router.put('/:id/antiban', requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const {
    delay_min = 115,
    delay_max = 145,
    batch_size = 15,
    batch_pause_min = 25,
    batch_pause_max = 30,
    daily_limit = 200,
    work_schedule_enabled = false,
    work_schedule_start = '09:00',
    work_schedule_end = '20:00',
    work_schedule_days = '1,2,3,4,5',
    applyToProfiles = false
  } = req.body;

  try {
    const dMin = parseInt(delay_min, 10);
    const dMax = parseInt(delay_max, 10);
    const bSize = parseInt(batch_size, 10);
    const bpMin = parseInt(batch_pause_min, 10);
    const bpMax = parseInt(batch_pause_max, 10);
    const dLimit = parseInt(daily_limit, 10);

    if (isNaN(dMin) || isNaN(dMax) || dMin < 1 || dMax < dMin) {
      return res.status(400).json({ error: 'Rango de demora entre mensajes inválido (el mínimo debe ser <= máximo)' });
    }
    if (isNaN(bSize) || bSize < 1) {
      return res.status(400).json({ error: 'Tamaño de lote inválido' });
    }
    if (isNaN(bpMin) || isNaN(bpMax) || bpMin < 0 || bpMax < bpMin) {
      return res.status(400).json({ error: 'Rango de pausa entre lotes inválido (el mínimo debe ser <= máximo)' });
    }
    if (isNaN(dLimit) || dLimit < 1) {
      return res.status(400).json({ error: 'Límite diario inválido' });
    }

    // Validate work schedule
    const schedEnabled = Boolean(work_schedule_enabled);
    let schedStart = (work_schedule_start || '09:00').trim();
    let schedEnd = (work_schedule_end || '20:00').trim();
    let schedDays = (work_schedule_days || '1,2,3,4,5').trim();

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(schedStart) || !timeRegex.test(schedEnd)) {
      return res.status(400).json({ error: 'El formato de hora de inicio y fin debe ser HH:MM (ej: 09:00 o 20:00)' });
    }

    const compRes = await db.query(
      `UPDATE companies SET 
        delay_min = $1, 
        delay_max = $2, 
        batch_size = $3, 
        batch_pause_min = $4, 
        batch_pause_max = $5, 
        daily_limit = $6,
        work_schedule_enabled = $7,
        work_schedule_start = $8,
        work_schedule_end = $9,
        work_schedule_days = $10
       WHERE id = $11 RETURNING id, name, delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit,
                               work_schedule_enabled, work_schedule_start, work_schedule_end, work_schedule_days`,
      [dMin, dMax, bSize, bpMin, bpMax, dLimit, schedEnabled, schedStart, schedEnd, schedDays, id]
    );

    if (compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    let updatedProfilesCount = 0;
    if (applyToProfiles) {
      const profRes = await db.query(
        `UPDATE profiles SET 
          delay_min = $1, 
          delay_max = $2, 
          batch_size = $3, 
          batch_pause_min = $4, 
          batch_pause_max = $5, 
          daily_limit = $6,
          work_schedule_enabled = $7,
          work_schedule_start = $8,
          work_schedule_end = $9,
          work_schedule_days = $10
         WHERE company_id = $11 RETURNING id`,
        [dMin, dMax, bSize, bpMin, bpMax, dLimit, schedEnabled, schedStart, schedEnd, schedDays, id]
      );
      updatedProfilesCount = profRes.rows.length;
    }

    await logAudit(req, 'UPDATE_COMPANY_ANTIBAN', {
      companyId: id,
      companyName: compRes.rows[0].name,
      delay_min: dMin,
      delay_max: dMax,
      batch_size: bSize,
      batch_pause_min: bpMin,
      batch_pause_max: bpMax,
      daily_limit: dLimit,
      work_schedule_enabled: schedEnabled,
      work_schedule_start: schedStart,
      work_schedule_end: schedEnd,
      work_schedule_days: schedDays,
      applyToProfiles,
      updatedProfilesCount
    });

    res.json({
      message: applyToProfiles 
        ? `Configuración guardada y aplicada a ${updatedProfilesCount} WhatsApps de la empresa`
        : 'Configuración guardada para la empresa',
      company: compRes.rows[0],
      updatedProfilesCount
    });
  } catch (err) {
    console.error('[Company Antiban PUT Error]', err);
    res.status(500).json({ error: 'Error al actualizar configuración anti-ban: ' + err.message });
  }
});

// POST /companies/:id/reset-defaults - Deep purge and reset company to base blank configurations
router.post('/:id/reset-defaults', requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Purge phone queue and sent logs for all profiles of this company
    await db.query(`
      DELETE FROM phone_queue 
      WHERE profile_id IN (SELECT id FROM profiles WHERE company_id = $1)
    `, [id]);

    await db.query(`
      DELETE FROM sent_log 
      WHERE profile_id IN (SELECT id FROM profiles WHERE company_id = $1)
    `, [id]);

    // 2. Disconnect and reset all profiles under this company to base default delays and limits
    await db.query(
      `UPDATE profiles SET
        delay_min = 115,
        delay_max = 145,
        batch_size = 15,
        batch_pause_min = 25,
        batch_pause_max = 30,
        daily_limit = 200,
        sent_today = 0,
        status = 'disconnected'
       WHERE company_id = $1`,
      [id]
    );

    // 3. Reset company limits to standard defaults (5 operators, 3 profiles per operator)
    const compRes = await db.query(
      `UPDATE companies SET 
        user_limit = 5, 
        max_profiles_per_operator = 3, 
        status = 'active'
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (compRes.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    // 4. Set all users to active
    await db.query("UPDATE users SET status = 'active' WHERE company_id = $1", [id]);

    await logAudit(req, 'RESET_COMPANY_DEFAULTS', { companyId: id, companyName: compRes.rows[0].name });

    res.json({
      message: 'Limpieza profunda y configuraciones de base reestablecidas exitosamente para la empresa',
      company: compRes.rows[0]
    });
  } catch (err) {
    console.error('[Company Reset Defaults Error]', err);
    res.status(500).json({ error: 'Error al reiniciar configuraciones de la empresa: ' + err.message });
  }
});

// DELETE /companies/:id - Delete company and CASCADE all related data
router.delete('/:id', requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Cascade delete queue and logs
    await db.query(`
      DELETE FROM phone_queue 
      WHERE profile_id IN (SELECT id FROM profiles WHERE company_id = $1)
    `, [id]);

    await db.query(`
      DELETE FROM sent_log 
      WHERE profile_id IN (SELECT id FROM profiles WHERE company_id = $1)
    `, [id]);

    // 2. Cascade delete tickets and notes
    await db.query('DELETE FROM support_tickets WHERE company_id = $1', [id]);
    await db.query('DELETE FROM company_notes WHERE company_id = $1', [id]);

    // 3. Cascade delete profiles
    await db.query('DELETE FROM profiles WHERE company_id = $1', [id]);

    // 4. Cascade delete users
    await db.query('DELETE FROM users WHERE company_id = $1', [id]);

    // 5. Delete company
    const result = await db.query('DELETE FROM companies WHERE id = $1 RETURNING id, name', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Empresa no encontrada' });
    }

    res.json({ message: 'Empresa y todos sus datos eliminados en cascada correctamente', id });
  } catch (err) {
    console.error('[Company Cascade Delete Error]', err);
    res.status(500).json({ error: 'Error al eliminar la empresa: ' + err.message });
  }
});

// ============ COMPANY NOTES & WRITTEN INCIDENT REPORTS ============

// GET /companies/:id/notes
router.get('/:id/notes', async (req, res) => {
  const { id } = req.params;
  if (req.user.role !== 'superadmin' && req.user.companyId !== id) {
    return res.status(403).json({ error: 'Unauthorized to view these notes' });
  }

  try {
    const result = await db.query(
      'SELECT * FROM company_notes WHERE company_id = $1 ORDER BY created_at DESC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Notes GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// POST /companies/:id/notes
router.post('/:id/notes', async (req, res) => {
  const { id } = req.params;
  const { title, content, category = 'general' } = req.body;

  if (req.user.role !== 'superadmin' && req.user.companyId !== id) {
    return res.status(403).json({ error: 'Unauthorized to post notes for this company' });
  }

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  try {
    const result = await db.query(
      `INSERT INTO company_notes (company_id, author_email, title, content, category)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, req.user.email, title.trim(), content.trim(), category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Notes POST Error]', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// DELETE /companies/:id/notes/:noteId
router.delete('/:id/notes/:noteId', async (req, res) => {
  const { id, noteId } = req.params;
  if (req.user.role !== 'superadmin' && req.user.companyId !== id) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const result = await db.query(
      'DELETE FROM company_notes WHERE id = $1 AND company_id = $2 RETURNING id',
      [noteId, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json({ message: 'Note deleted', id: noteId });
  } catch (err) {
    console.error('[Notes DELETE Error]', err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ============ SUPPORT TICKETS / REPORTES DE ADMINISTRADORES ============

// GET /companies/reports/all - SuperAdmin only: Read-only log of all submitted reports
router.get('/reports/all', requireRole('superadmin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT st.*
      FROM support_tickets st
      ORDER BY st.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[Support Tickets GET All Error]', err);
    res.status(500).json({ error: 'Failed to fetch support tickets' });
  }
});

// POST /companies/:id/tickets - Admin only submits problems with optional .png or .pdf
router.post('/:id/tickets', (req, res, next) => {
  upload.single('attachment')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Error al procesar el archivo adjunto' });
    }
    next();
  });
}, async (req, res) => {
  const { id } = req.params;
  const { title, content } = req.body;

  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Solo administradores pueden enviar reportes de problemas' });
  }

  if (req.user.role === 'admin' && req.user.companyId !== id) {
    return res.status(403).json({ error: 'No autorizado para enviar reportes en otra empresa' });
  }

  if (!title || !content) {
    return res.status(400).json({ error: 'El título y la descripción del problema son obligatorios' });
  }

  try {
    // Get company name
    const compRes = await db.query('SELECT name FROM companies WHERE id = $1', [id]);
    const companyName = compRes.rows.length > 0 ? compRes.rows[0].name : 'Empresa';

    const attachmentPath = req.file ? `/uploads/${req.file.filename}` : null;
    const attachmentName = req.file ? req.file.originalname : null;

    const result = await db.query(
      `INSERT INTO support_tickets 
       (company_id, author_id, author_email, company_name, title, content, attachment_path, attachment_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, req.user.id, req.user.email, companyName, title.trim(), content.trim(), attachmentPath, attachmentName]
    );

    res.status(201).json({
      message: 'Reporte enviado exitosamente al soporte técnico',
      ticket: result.rows[0]
    });
  } catch (err) {
    console.error('[Ticket Create Error]', err);
    res.status(500).json({ error: 'Error al registrar el reporte' });
  }
});

// DELETE /companies/reports/:id - SuperAdmin only: Delete a support ticket / queja
router.delete('/reports/:id', requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM support_tickets WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reporte de soporte no encontrado' });
    }
    res.json({ message: 'Reporte de soporte eliminado exitosamente', id });
  } catch (err) {
    console.error('[Ticket Delete Error]', err);
    res.status(500).json({ error: 'Error al eliminar el reporte de soporte' });
  }
});

module.exports = router;
