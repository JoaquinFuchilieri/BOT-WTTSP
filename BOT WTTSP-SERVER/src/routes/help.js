const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const { logAudit } = require('../utils/audit');
const { DEFAULT_HELP_TITLE, DEFAULT_HELP_CONTENT, filterManualForDesktop } = require('../utils/default-help-manual');

// Ensure table exists and has default content
async function ensureHelpTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS help_manual (
        id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
        title VARCHAR(200) NOT NULL DEFAULT 'Manual Integral de Uso y Operación',
        content TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    const check = await db.query("SELECT id FROM help_manual WHERE id = 'default' LIMIT 1");
    if (check.rows.length === 0) {
      await db.query(
        "INSERT INTO help_manual (id, title, content) VALUES ('default', $1, $2)",
        [DEFAULT_HELP_TITLE, DEFAULT_HELP_CONTENT]
      );
      console.log('[Help] Default manual seeded into database.');
    }
  } catch (err) {
    console.error('[Help Init Error]', err);
  }
}

// Initialize table on module load
ensureHelpTable();

// All routes require authentication
router.use(authenticateToken);

// GET /help - Get system manual (SuperAdmin, Admin, Operator)
// If ?target=desktop or header X-Client: desktop, strips Section 3 (Panel Web SaaS)
router.get('/', async (req, res) => {
  try {
    await ensureHelpTable();

    const result = await db.query(
      `SELECT h.id, h.title, h.content, h.updated_at, u.email as updated_by_email
       FROM help_manual h
       LEFT JOIN users u ON h.updated_by = u.id
       WHERE h.id = 'default'
       LIMIT 1`
    );

    const isDesktop = req.query.target === 'desktop' || req.headers['x-client'] === 'desktop';

    if (result.rows.length === 0) {
      return res.json({
        id: 'default',
        title: DEFAULT_HELP_TITLE,
        content: isDesktop ? filterManualForDesktop(DEFAULT_HELP_CONTENT) : DEFAULT_HELP_CONTENT,
        updated_at: new Date().toISOString(),
        updated_by_email: 'SuperAdmin'
      });
    }

    const row = { ...result.rows[0] };
    if (isDesktop) {
      row.content = filterManualForDesktop(row.content);
    }
    res.json(row);
  } catch (err) {
    console.error('[Help GET Error]', err);
    res.status(500).json({ error: 'Error al obtener el manual de ayuda' });
  }
});

// PUT /help - Update system manual (SuperAdmin only)
router.put('/', requireRole('superadmin'), async (req, res) => {
  const { title, content } = req.body;

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: 'El contenido del manual no puede estar vacío.' });
  }

  const finalTitle = (title && typeof title === 'string' && title.trim().length > 0)
    ? title.trim()
    : DEFAULT_HELP_TITLE;

  try {
    await ensureHelpTable();

    const result = await db.query(
      `UPDATE help_manual 
       SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3
       WHERE id = 'default'
       RETURNING id, title, content, updated_at`,
      [finalTitle, content.trim(), req.user.id]
    );

    await logAudit(req, 'UPDATE_HELP_MANUAL', { title: finalTitle, contentLength: content.length });

    res.json({
      message: 'Manual de ayuda actualizado correctamente',
      manual: result.rows[0]
    });
  } catch (err) {
    console.error('[Help PUT Error]', err);
    res.status(500).json({ error: 'Error al guardar los cambios del manual' });
  }
});

// POST /help/reset - Reset to factory manual (SuperAdmin only)
router.post('/reset', requireRole('superadmin'), async (req, res) => {
  try {
    await ensureHelpTable();

    const result = await db.query(
      `UPDATE help_manual 
       SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3
       WHERE id = 'default'
       RETURNING id, title, content, updated_at`,
      [DEFAULT_HELP_TITLE, DEFAULT_HELP_CONTENT, req.user.id]
    );

    await logAudit(req, 'RESET_HELP_MANUAL', { title: DEFAULT_HELP_TITLE });

    res.json({
      message: 'Manual de ayuda restablecido al texto de fábrica',
      manual: result.rows[0]
    });
  } catch (err) {
    console.error('[Help RESET Error]', err);
    res.status(500).json({ error: 'Error al restablecer el manual' });
  }
});

module.exports = router;
