const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { authenticateToken } = require('../middleware/authenticate');

router.use(authenticateToken);

// Middleware to verify that the caller owns or has permission to manage this profile's queue
async function authorizeProfileAccess(req, res, next) {
  const { id: profileId } = req.params;
  if (!profileId) return next();

  try {
    const profRes = await db.query('SELECT company_id, assigned_user_id FROM profiles WHERE id = $1', [profileId]);
    if (profRes.rows.length === 0) {
      return res.status(404).json({ error: 'Perfil no encontrado' });
    }

    const profile = profRes.rows[0];

    // SuperAdmin has global access
    if (req.user.role === 'superadmin') {
      req.profile = profile;
      return next();
    }

    // Tenant isolation: Company must match
    if (profile.company_id !== req.user.companyId) {
      return res.status(403).json({ error: 'Acceso no autorizado al perfil' });
    }

    // Operator isolation: Role 'user' can only access their assigned profile
    if (req.user.role === 'user' && profile.assigned_user_id !== req.user.id) {
      return res.status(403).json({ error: 'Solo puedes gestionar la cola de tu propio WhatsApp asignado' });
    }

    req.profile = profile;
    next();
  } catch (err) {
    console.error('[Queue Auth Error]', err);
    res.status(500).json({ error: 'Error al autorizar acceso al perfil' });
  }
}

router.use(authorizeProfileAccess);

function cleanPhoneNumber(num) {
  if (!num || typeof num !== 'string') return null;
  let cleaned = num.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  if (cleaned.length < 7) return null;
  return cleaned;
}

// POST /profiles/:id/queue/import - Import list of phone numbers
router.post('/import', async (req, res) => {
  const { id: profileId } = req.params;
  const { numbers } = req.body;

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'numbers array is required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Get company_id for this profile to check against blacklist
    const profRes = await client.query('SELECT company_id FROM profiles WHERE id = $1', [profileId]);
    const companyId = profRes.rows[0]?.company_id;

    let blacklistSet = new Set();
    if (companyId) {
      const blRes = await client.query('SELECT phone_number FROM blacklist WHERE company_id = $1', [companyId]);
      blacklistSet = new Set(blRes.rows.map(r => r.phone_number.replace(/[^0-9]/g, '')));
    }

    // Get current pending numbers to deduplicate against current queue
    const currentPending = await client.query(
      "SELECT phone_number FROM phone_queue WHERE profile_id = $1 AND status = 'pending'",
      [profileId]
    );
    const pendingSet = new Set(currentPending.rows.map(r => r.phone_number));

    let imported = 0;
    let skippedBlacklist = 0;
    for (const num of numbers) {
      const cleaned = cleanPhoneNumber(num);
      if (!cleaned) continue;
      if (blacklistSet.has(cleaned)) {
        skippedBlacklist++;
        continue;
      }
      if (pendingSet.has(cleaned)) continue;

      await client.query(
        "INSERT INTO phone_queue (profile_id, phone_number, status) VALUES ($1, $2, 'pending')",
        [profileId, cleaned]
      );
      pendingSet.add(cleaned);
      imported++;
    }

    await client.query('COMMIT');
    res.json({ imported, totalSubmitted: numbers.length, skippedBlacklist });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Queue Import Error]', err);
    res.status(500).json({ error: 'Failed to import numbers' });
  } finally {
    client.release();
  }
});

// GET /profiles/:id/queue - Get queue items
router.get('/', async (req, res) => {
  const { id: profileId } = req.params;
  try {
    const result = await db.query(
      `SELECT id, phone_number, status, created_at
       FROM phone_queue
       WHERE profile_id = $1
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'sending' THEN 1 WHEN 'error' THEN 2 ELSE 3 END, created_at ASC, id ASC
       LIMIT 200`,
      [profileId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Queue GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// GET /profiles/:id/queue/peek - Look at next pending number without modifying status
router.get('/peek', async (req, res) => {
  const { id: profileId } = req.params;
  try {
    const result = await db.query(
      `SELECT id, phone_number
       FROM phone_queue
       WHERE profile_id = $1 AND status = 'pending'
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [profileId]
    );
    res.json({ item: result.rows[0] || null });
  } catch (err) {
    console.error('[Queue Peek Error]', err);
    res.status(500).json({ error: 'Failed to peek next number' });
  }
});

// GET /profiles/:id/queue/next - Atomic fetch next pending number using FOR UPDATE SKIP LOCKED
router.get('/next', async (req, res) => {
  const { id: profileId } = req.params;
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    // 1. Check if profile is paused by Early Warning System
    const profRes = await client.query(
      'SELECT is_paused_early_warning, early_warning_reason, company_id FROM profiles WHERE id = $1',
      [profileId]
    );
    if (profRes.rows.length > 0 && profRes.rows[0].is_paused_early_warning) {
      await client.query('COMMIT');
      return res.status(403).json({
        item: null,
        pausedEarlyWarning: true,
        error: 'PROFILE_PAUSED_EARLY_WARNING',
        reason: profRes.rows[0].early_warning_reason || 'Cola pausada automáticamente por alta tasa de fallos detectada.'
      });
    }

    const companyId = profRes.rows[0]?.company_id;

    // Loop until we find a non-blacklisted item or queue is exhausted
    let validItem = null;
    while (true) {
      const selectRes = await client.query(
        `SELECT id, phone_number
         FROM phone_queue
         WHERE profile_id = $1 AND status = 'pending'
         ORDER BY created_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [profileId]
      );

      if (selectRes.rows.length === 0) {
        break;
      }

      const candidate = selectRes.rows[0];

      // Check if candidate is in blacklist for this company
      if (companyId) {
        const cleanCandidate = candidate.phone_number.replace(/[^0-9]/g, '');
        const blCheck = await client.query(
          "SELECT 1 FROM blacklist WHERE company_id = $1 AND REPLACE(phone_number, '+', '') = $2",
          [companyId, cleanCandidate]
        );
        if (blCheck.rows.length > 0) {
          // Auto-mark as error so it won't block queue
          await client.query(
            "UPDATE phone_queue SET status = 'error' WHERE id = $1",
            [candidate.id]
          );
          await client.query(
            "INSERT INTO sent_log (profile_id, phone_number, result, error_message) VALUES ($1, $2, 'error', $3)",
            [profileId, candidate.phone_number, 'Omitido: presente en Lista de Exclusión (Blacklist)']
          );
          continue;
        }
      }

      // Valid candidate
      await client.query(
        "UPDATE phone_queue SET status = 'sending' WHERE id = $1",
        [candidate.id]
      );
      validItem = candidate;
      break;
    }

    await client.query('COMMIT');
    res.json({ item: validItem });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Queue Next Error]', err);
    res.status(500).json({ error: 'Failed to get next number' });
  } finally {
    client.release();
  }
});

// POST /profiles/:id/queue/:qid/sent - Mark number as sent
router.post('/:qid/sent', async (req, res) => {
  const { id: profileId, qid } = req.params;
  const { phoneNumber } = req.body;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Update queue item
    await client.query("UPDATE phone_queue SET status = 'sent' WHERE id = $1", [qid]);

    // Insert into sent_log
    await client.query(
      "INSERT INTO sent_log (profile_id, phone_number, result) VALUES ($1, $2, 'sent')",
      [profileId, phoneNumber || '']
    );

    // Increment sent_today in profile
    await client.query(
      "UPDATE profiles SET sent_today = sent_today + 1, last_sent_date = CURRENT_DATE WHERE id = $1",
      [profileId]
    );

    await client.query('COMMIT');
    res.json({ success: true, queueId: qid });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Queue Sent Error]', err);
    res.status(500).json({ error: 'Failed to mark as sent' });
  } finally {
    client.release();
  }
});

// POST /profiles/:id/queue/:qid/error - Mark number as error
router.post('/:qid/error', async (req, res) => {
  const { id: profileId, qid } = req.params;
  const { phoneNumber, errorMessage = '' } = req.body;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Update queue item
    await client.query("UPDATE phone_queue SET status = 'error' WHERE id = $1", [qid]);

    // Insert into sent_log
    await client.query(
      "INSERT INTO sent_log (profile_id, phone_number, result, error_message) VALUES ($1, $2, 'error', $3)",
      [profileId, phoneNumber || '', errorMessage]
    );

    // Early Warning Monitor: inspect last 30 logs for this profile
    const recentRes = await client.query(
      `SELECT result FROM sent_log WHERE profile_id = $1 ORDER BY sent_at DESC LIMIT 30`,
      [profileId]
    );
    const logs = recentRes.rows;
    let autoPaused = false;
    let failRate = 0;

    if (logs.length >= 10) {
      const errors = logs.filter(r => r.result === 'error').length;
      failRate = Math.round((errors / logs.length) * 100);
      if (failRate > 15) {
        const reasonMsg = `Alta tasa de fallos detectada: ${failRate}% (${errors} errores en los últimos ${logs.length} envíos). Se pausó la cola para prevenir sanciones.`;
        await client.query(
          'UPDATE profiles SET is_paused_early_warning = true, early_warning_reason = $1 WHERE id = $2',
          [reasonMsg, profileId]
        );
        autoPaused = true;
      }
    }

    await client.query('COMMIT');

    if (autoPaused) {
      const { logAudit } = require('../utils/audit');
      await logAudit(req, 'EARLY_WARNING_AUTO_PAUSE', {
        profileId,
        failRate: `${failRate}%`,
        sampleSize: logs.length
      });
    }

    res.json({ success: true, queueId: qid, earlyWarningPaused: autoPaused, failRate });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Queue Error Mark Error]', err);
    res.status(500).json({ error: 'Failed to mark error' });
  } finally {
    client.release();
  }
});

// POST /profiles/:id/early-warning/resume - Resume queue paused by Early Warning System
router.post('/early-warning/resume', async (req, res) => {
  const { id: profileId } = req.params;
  try {
    await db.query(
      'UPDATE profiles SET is_paused_early_warning = false, early_warning_reason = NULL WHERE id = $1',
      [profileId]
    );
    const { logAudit } = require('../utils/audit');
    await logAudit(req, 'EARLY_WARNING_RESUME', { profileId });
    res.json({ success: true, message: 'Alerta temprana reseteada y cola reanudada con éxito.' });
  } catch (err) {
    console.error('[Queue Early Warning Resume Error]', err);
    res.status(500).json({ error: 'Failed to resume early warning queue' });
  }
});

// POST /profiles/:id/queue/retry-errors - Reset all errors to pending
router.post('/retry-errors', async (req, res) => {
  const { id: profileId } = req.params;
  try {
    const result = await db.query(
      "UPDATE phone_queue SET status = 'pending' WHERE profile_id = $1 AND status = 'error'",
      [profileId]
    );
    res.json({ retried: result.rowCount });
  } catch (err) {
    console.error('[Queue Retry Errors Error]', err);
    res.status(500).json({ error: 'Failed to retry errors' });
  }
});

// POST /profiles/:id/queue/reset-sending - Reset any numbers stuck in 'sending' to 'pending'
router.post('/reset-sending', async (req, res) => {
  const { id: profileId } = req.params;
  try {
    const result = await db.query(
      "UPDATE phone_queue SET status = 'pending' WHERE profile_id = $1 AND status = 'sending'",
      [profileId]
    );
    res.json({ reset: result.rowCount });
  } catch (err) {
    console.error('[Queue Reset Sending Error]', err);
    res.status(500).json({ error: 'Failed to reset sending queue' });
  }
});

// DELETE /profiles/:id/queue - Clear queue
router.delete('/', async (req, res) => {
  const { id: profileId } = req.params;
  const { status = 'pending' } = req.query; // default only clear pending

  try {
    let query = 'DELETE FROM phone_queue WHERE profile_id = $1';
    const values = [profileId];

    if (status !== 'all') {
      query += " AND status = 'pending'";
    }

    const result = await db.query(query, values);
    res.json({ deleted: result.rowCount });
  } catch (err) {
    console.error('[Queue Clear Error]', err);
    res.status(500).json({ error: 'Failed to clear queue' });
  }
});

module.exports = router;
