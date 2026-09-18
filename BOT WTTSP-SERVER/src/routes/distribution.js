const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const { logAudit } = require('../utils/audit');

router.use(authenticateToken);
// Admins, SuperAdmins, and Operators can access number distribution
router.use(requireRole('user', 'admin', 'superadmin'));

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

    // Basic validity check: must have at least 7 digits
    if (cleaned.length >= 7 && !seen.has(cleaned)) {
      seen.add(cleaned);
      valid.push(cleaned);
    }
  }

  return valid;
}

// POST /distribution/preview - Preview parsed numbers and calculate equal distribution for a product class
router.post('/preview', async (req, res) => {
  const { numbersRaw, category } = req.body;
  const companyId = req.user.role === 'superadmin' && req.body.companyId ? req.body.companyId : req.user.companyId;

  if (!category || !category.trim()) {
    return res.status(400).json({ error: 'Debes seleccionar una clase o producto de campaña obligatorio (Movistar, Claro, DirecTV, etc.)' });
  }

  const cleanCategory = category.trim();

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

    // Get profiles for this company belonging to the selected category/class
    let profQuery = `
      SELECT p.id, p.name, p.status, p.is_active_bot, p.category, u.email as operator_email
      FROM profiles p
      LEFT JOIN users u ON p.assigned_user_id = u.id
      WHERE p.company_id = $1 AND LOWER(p.category) = LOWER($2)
    `;
    const profValues = [companyId, cleanCategory];

    if (req.user.role === 'user') {
      profQuery += ` AND p.assigned_user_id = $3`;
      profValues.push(req.user.id);
    }

    profQuery += ' ORDER BY p.created_at ASC';

    const profRes = await db.query(profQuery, profValues);

    if (profRes.rows.length === 0) {
      const scope = req.user.role === 'user' ? 'en tus cuentas de WhatsApp asignadas' : 'en la empresa';
      return res.status(400).json({
        error: `No hay bots configurados en la clase "${cleanCategory}" ${scope}. Creá o asigná al menos un bot con esta clase para distribuir los números.`,
        code: 'NO_BOTS_IN_CATEGORY'
      });
    }

    const candidateBots = profRes.rows;
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
          category: bot.category || cleanCategory,
          operatorEmail: bot.operator_email || 'Sin asignar',
          status: bot.status,
          assignedCount: perBot + extra
        };
      });
    }

    res.json({
      category: cleanCategory,
      totalInput: rawList.length,
      totalClean: cleanList.length,
      blacklistedExcluded: blacklistedCount,
      candidateBotsCount: botCount,
      hasActiveBots: candidateBots.some(b => b.status === 'connected' || b.is_active_bot),
      distribution
    });
  } catch (err) {
    console.error('[Distribution Preview Error]', err);
    res.status(500).json({ error: 'Error al procesar la lista de números' });
  }
});

// POST /distribution/execute - Distribute numbers equally into phone_queue by category
router.post('/execute', async (req, res) => {
  const { numbersRaw, category, targetProfileIds } = req.body;
  const companyId = req.user.role === 'superadmin' && req.body.companyId ? req.body.companyId : req.user.companyId;

  if (!category || !category.trim()) {
    return res.status(400).json({ error: 'Debes seleccionar una clase o producto de campaña obligatorio (Movistar, Claro, DirecTV, etc.)' });
  }

  const cleanCategory = category.trim();

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

    // Fetch target profiles for this category
    let profilesQuery = `SELECT id, name, category FROM profiles WHERE company_id = $1 AND LOWER(category) = LOWER($2)`;
    const qParams = [companyId, cleanCategory];

    if (req.user.role === 'user') {
      profilesQuery += ` AND assigned_user_id = $${qParams.length + 1}`;
      qParams.push(req.user.id);
    }

    if (Array.isArray(targetProfileIds) && targetProfileIds.length > 0) {
      profilesQuery += ` AND id = ANY($${qParams.length + 1})`;
      qParams.push(targetProfileIds);
    }

    const profRes = await db.query(profilesQuery, qParams);
    if (profRes.rows.length === 0) {
      return res.status(400).json({ error: `No se encontraron bots en la clase "${cleanCategory}" para repartir los números` });
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

        // Deduplicate against pending in target bot
        const dupCheck = await client.query(
          "SELECT 1 FROM phone_queue WHERE profile_id = $1 AND phone_number = $2 AND status = 'pending'",
          [targetBot.id, phone]
        );

        if (dupCheck.rows.length === 0) {
          await client.query(
            "INSERT INTO phone_queue (profile_id, phone_number, status) VALUES ($1, $2, 'pending')",
            [targetBot.id, phone]
          );
          insertedCount++;
        }
      }

      await client.query('COMMIT');

      await logAudit(req, 'NUMBERS_DISTRIBUTED', {
        companyId,
        category: cleanCategory,
        totalNumbers: insertedCount,
        botCount,
        bots: bots.map(b => b.name)
      });

      res.json({
        success: true,
        message: `Se distribuyeron exitosamente ${insertedCount} números entre ${botCount} bots de WhatsApp de la clase "${cleanCategory}".`,
        distributedCount: insertedCount,
        botsCount: botCount,
        category: cleanCategory
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
