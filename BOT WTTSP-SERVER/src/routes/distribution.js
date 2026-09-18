const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const { logAudit } = require('../utils/audit');

router.use(authenticateToken);
// Only Admins and SuperAdmins can access number distribution
router.use(requireRole('admin', 'superadmin'));

/**
 * Helper to clean and validate a list of raw numbers
 */
function cleanNumbers(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return [];
  const lines = rawInput.split(/[\r\n,;]+/);
  const seen = new Set();
  const valid = [];

  for (let line of lines) {
    let cleaned = line.trim().replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);

    // Basic validity check: must have at least 8 digits
    if (cleaned.length >= 8 && !seen.has(cleaned)) {
      seen.add(cleaned);
      valid.push(cleaned);
    }
  }

  return valid;
}

// POST /distribution/preview - Preview parsed numbers and calculate equal distribution
router.post('/preview', async (req, res) => {
  const { numbersRaw } = req.body;
  const companyId = req.user.role === 'superadmin' && req.body.companyId ? req.body.companyId : req.user.companyId;

  if (!numbersRaw) {
    return res.status(400).json({ error: 'Debes proporcionar una lista de números telefónicos' });
  }

  try {
    const rawList = cleanNumbers(numbersRaw);
    if (rawList.length === 0) {
      return res.status(400).json({ error: 'No se encontraron números válidos en el texto o archivo' });
    }

    // Filter against blacklist
    const blRes = await db.query('SELECT phone_number FROM blacklist WHERE company_id = $1', [companyId]);
    const blacklistedSet = new Set(blRes.rows.map(r => r.phone_number.replace(/[^\d]/g, '')));

    const cleanList = rawList.filter(num => !blacklistedSet.has(num));
    const blacklistedCount = rawList.length - cleanList.length;

    // Get all connected or existing profiles for this company
    const profRes = await db.query(`
      SELECT p.id, p.name, p.status, p.is_active_bot, u.email as operator_email
      FROM profiles p
      LEFT JOIN users u ON p.assigned_user_id = u.id
      WHERE p.company_id = $1
      ORDER BY p.created_at ASC
    `, [companyId]);

    const activeBots = profRes.rows.filter(p => p.status === 'connected' || p.is_active_bot);
    const candidateBots = activeBots.length > 0 ? activeBots : profRes.rows;

    const botCount = candidateBots.length;
    let distribution = [];

    if (botCount > 0) {
      const perBot = Math.floor(cleanList.length / botCount);
      let remainder = cleanList.length % botCount;

      distribution = candidateBots.map((bot, index) => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder--;
        return {
          profileId: bot.id,
          name: bot.name,
          operatorEmail: bot.operator_email || 'Sin asignar',
          status: bot.status,
          assignedCount: perBot + extra
        };
      });
    }

    res.json({
      totalInput: rawList.length,
      totalClean: cleanList.length,
      blacklistedExcluded: blacklistedCount,
      candidateBotsCount: botCount,
      hasActiveBots: activeBots.length > 0,
      distribution
    });
  } catch (err) {
    console.error('[Distribution Preview Error]', err);
    res.status(500).json({ error: 'Error al procesar la lista de números' });
  }
});

// POST /distribution/execute - Distribute numbers equally into phone_queue
router.post('/execute', async (req, res) => {
  const { numbersRaw, targetProfileIds } = req.body;
  const companyId = req.user.role === 'superadmin' && req.body.companyId ? req.body.companyId : req.user.companyId;

  if (!numbersRaw) {
    return res.status(400).json({ error: 'Debes proporcionar una lista de números' });
  }

  try {
    const rawList = cleanNumbers(numbersRaw);
    if (rawList.length === 0) {
      return res.status(400).json({ error: 'No se encontraron números válidos' });
    }

    // Filter blacklist
    const blRes = await db.query('SELECT phone_number FROM blacklist WHERE company_id = $1', [companyId]);
    const blacklistedSet = new Set(blRes.rows.map(r => r.phone_number.replace(/[^\d]/g, '')));
    const cleanList = rawList.filter(num => !blacklistedSet.has(num));

    if (cleanList.length === 0) {
      return res.status(400).json({ error: 'Todos los números ingresados se encuentran en la lista negra' });
    }

    // Fetch target profiles
    let profilesQuery = `SELECT id, name FROM profiles WHERE company_id = $1`;
    const qParams = [companyId];

    if (Array.isArray(targetProfileIds) && targetProfileIds.length > 0) {
      profilesQuery += ` AND id = ANY($2)`;
      qParams.push(targetProfileIds);
    }

    const profRes = await db.query(profilesQuery, qParams);
    if (profRes.rows.length === 0) {
      return res.status(400).json({ error: 'No se encontraron bots para repartir los números' });
    }

    const bots = profRes.rows;
    const botCount = bots.length;

    // Distribute numbers in round-robin fashion
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      let insertedCount = 0;
      for (let i = 0; i < cleanList.length; i++) {
        const targetBot = bots[i % botCount];
        const phone = cleanList[i];

        await client.query(
          "INSERT INTO phone_queue (profile_id, phone_number, status) VALUES ($1, $2, 'pending')",
          [targetBot.id, phone]
        );
        insertedCount++;
      }

      await client.query('COMMIT');

      await logAudit(req, 'NUMBERS_DISTRIBUTED', {
        companyId,
        totalNumbers: insertedCount,
        botCount,
        bots: bots.map(b => b.name)
      });

      res.json({
        success: true,
        message: `Se distribuyeron exitosamente ${insertedCount} números entre ${botCount} bots de WhatsApp.`,
        distributedCount: insertedCount,
        botsCount: botCount
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Distribution Execute Error]', err);
    res.status(500).json({ error: 'Error al distribuir números en las colas' });
  }
});

module.exports = router;
