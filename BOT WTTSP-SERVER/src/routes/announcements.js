const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const { logAudit } = require('../utils/audit');

// GET /announcements/active - Public / Authenticated active announcements
router.get('/active', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, message, priority, created_at, expires_at
       FROM system_announcements
       WHERE is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 5`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Announcements Active Error]', err);
    res.status(500).json({ error: 'Failed to fetch active announcements' });
  }
});

// GET /announcements/inbox - Authenticated users (Admin, SuperAdmin) can fetch all active announcements for their inbox
router.get('/inbox', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, message, priority, created_at, expires_at
       FROM system_announcements
       WHERE is_active = TRUE AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 30`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Announcements Inbox Error]', err);
    res.status(500).json({ error: 'Failed to fetch inbox announcements' });
  }
});

// Admin/SuperAdmin full listing
router.get('/', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const result = await db.query(
      'SELECT a.*, u.email as author_email FROM system_announcements a LEFT JOIN users u ON a.author_id = u.id ORDER BY a.created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Announcements GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// POST /announcements - SuperAdmin only
router.post('/', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { title, message, priority = 'info', expiresAt } = req.body;
    if (!title || !message) {
      return res.status(400).json({ error: 'Título y mensaje son obligatorios' });
    }

    const cleanTitle = title.trim();
    const cleanMessage = message.trim();

    // Idempotency: Prevent accidental duplicate submissions within 5 seconds
    const existing = await db.query(
      `SELECT * FROM system_announcements
       WHERE author_id = $1 AND title = $2 AND message = $3 AND created_at > NOW() - INTERVAL '5 seconds'
       LIMIT 1`,
      [req.user.id, cleanTitle, cleanMessage]
    );
    if (existing.rows.length > 0) {
      return res.status(200).json(existing.rows[0]);
    }

    const result = await db.query(
      `INSERT INTO system_announcements (author_id, title, message, priority, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, cleanTitle, cleanMessage, priority, expiresAt ? new Date(expiresAt) : null]
    );

    await logAudit(req, 'CREATE_ANNOUNCEMENT', { title, priority });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Announcements POST Error]', err);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// PATCH /announcements/:id - SuperAdmin toggle/edit
router.patch('/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, title, message, priority, expiresAt } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(isActive);
    }
    if (title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(title.trim());
    }
    if (message !== undefined) {
      fields.push(`message = $${idx++}`);
      values.push(message.trim());
    }
    if (priority !== undefined) {
      fields.push(`priority = $${idx++}`);
      values.push(priority);
    }
    if (expiresAt !== undefined) {
      fields.push(`expires_at = $${idx++}`);
      values.push(expiresAt ? new Date(expiresAt) : null);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const query = `UPDATE system_announcements SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    await logAudit(req, 'UPDATE_ANNOUNCEMENT', { id, isActive });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Announcements PATCH Error]', err);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

// DELETE /announcements/:id - SuperAdmin delete
router.delete('/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM system_announcements WHERE id = $1 RETURNING title', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Announcement not found' });
    }

    await logAudit(req, 'DELETE_ANNOUNCEMENT', { id, title: result.rows[0].title });
    res.json({ message: 'Anuncio eliminado exitosamente' });
  } catch (err) {
    console.error('[Announcements DELETE Error]', err);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

// POST /announcements/bulk-delete - SuperAdmin delete multiple announcements
router.post('/bulk-delete', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debes proporcionar una lista de IDs para eliminar' });
    }

    const result = await db.query(
      'DELETE FROM system_announcements WHERE id = ANY($1::uuid[]) RETURNING id, title',
      [ids]
    );

    await logAudit(req, 'BULK_DELETE_ANNOUNCEMENTS', { count: result.rows.length, ids });
    res.json({ message: `${result.rows.length} anuncios eliminados exitosamente`, deletedCount: result.rows.length });
  } catch (err) {
    console.error('[Announcements Bulk DELETE Error]', err);
    res.status(500).json({ error: 'Failed to delete announcements' });
  }
});

module.exports = router;
