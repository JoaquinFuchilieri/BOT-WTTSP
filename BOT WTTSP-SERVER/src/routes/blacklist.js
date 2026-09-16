const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/authenticate');
const { logAudit } = require('../utils/audit');

router.use(authenticateToken, requireRole('superadmin', 'admin'));

// GET /blacklist - List blacklisted numbers
router.get('/', async (req, res) => {
  try {
    const companyId = req.user.role === 'superadmin' && req.query.companyId
      ? req.query.companyId
      : req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const result = await db.query(
      'SELECT id, phone_number, reason, created_at FROM blacklist WHERE company_id = $1 ORDER BY created_at DESC',
      [companyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Blacklist GET Error]', err);
    res.status(500).json({ error: 'Failed to fetch blacklist' });
  }
});

// POST /blacklist - Add number or batch of numbers
router.post('/', async (req, res) => {
  try {
    const companyId = req.user.role === 'superadmin' && req.body.companyId
      ? req.body.companyId
      : req.user.companyId;

    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required' });
    }

    const { phoneNumber, phoneNumbers, reason = 'Solicitud del cliente' } = req.body;
    let list = [];

    if (Array.isArray(phoneNumbers)) {
      list = phoneNumbers;
    } else if (phoneNumber) {
      list = [phoneNumber];
    }

    // Clean numbers to digits only for reliable matching
    list = list
      .map(n => String(n).trim().replace(/[^0-9]/g, ''))
      .filter(n => n.length >= 6);

    if (list.length === 0) {
      return res.status(400).json({ error: 'No se enviaron números válidos' });
    }

    let inserted = 0;
    for (const num of list) {
      try {
        await db.query(
          `INSERT INTO blacklist (company_id, phone_number, reason)
           VALUES ($1, $2, $3)
           ON CONFLICT (company_id, phone_number) DO UPDATE SET reason = EXCLUDED.reason`,
          [companyId, num, reason]
        );
        inserted++;
      } catch (e) {
        console.warn('[Blacklist Insert Single Warning]', e.message);
      }
    }

    await logAudit(req, 'ADD_TO_BLACKLIST', { companyId, count: inserted, reason });
    res.status(201).json({ message: `${inserted} número(s) agregados a la lista de exclusión`, count: inserted });
  } catch (err) {
    console.error('[Blacklist POST Error]', err);
    res.status(500).json({ error: 'Failed to add to blacklist' });
  }
});

// DELETE /blacklist/:id - Remove number
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user.role === 'superadmin' ? null : req.user.companyId;

    let query = 'DELETE FROM blacklist WHERE id = $1';
    const params = [id];
    if (companyId) {
      query += ' AND company_id = $2';
      params.push(companyId);
    }
    query += ' RETURNING phone_number, company_id';

    const result = await db.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Número no encontrado en lista de exclusión' });
    }

    await logAudit(req, 'REMOVE_FROM_BLACKLIST', { 
      companyId: result.rows[0].company_id, 
      phoneNumber: result.rows[0].phone_number 
    });

    res.json({ message: 'Número eliminado de la lista de exclusión' });
  } catch (err) {
    console.error('[Blacklist DELETE Error]', err);
    res.status(500).json({ error: 'Failed to delete from blacklist' });
  }
});

module.exports = router;
