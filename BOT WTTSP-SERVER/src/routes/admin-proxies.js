const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authenticate');
const proxyPoolManager = require('../services/proxy-pool-manager');

// Middleware: Strictly enforce SuperAdmin access
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({
      error: 'Acceso Denegado: La administración del Pool de Proxies es exclusiva para el SuperAdmin'
    });
  }
  next();
}

router.use(authenticateToken);
router.use(requireSuperAdmin);

// GET /admin/proxies - Retrieve pool summary, proxies list, and WhatsApp assignment status
router.get('/', async (req, res) => {
  try {
    const pool = await proxyPoolManager.getPoolSummary();
    const assignments = await proxyPoolManager.getProfilesAssignmentList();
    res.json({
      stats: pool.stats,
      proxies: pool.proxies,
      assignments
    });
  } catch (err) {
    console.error('[Admin Proxies GET Error]', err);
    res.status(500).json({ error: 'Error al obtener el pool de proxies: ' + err.message });
  }
});

// POST /admin/proxies/bulk - Bulk add proxies from text and auto-assign in groups of 20
router.post('/bulk', async (req, res) => {
  const { text, maxCapacity } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Debe ingresar al menos una URL o línea de proxy' });
  }

  const capacity = parseInt(maxCapacity, 10) || 20;

  try {
    const result = await proxyPoolManager.addProxiesBulk(text, capacity);
    const pool = await proxyPoolManager.getPoolSummary();
    const assignments = await proxyPoolManager.getProfilesAssignmentList();

    res.json({
      success: true,
      message: `Se cargaron ${result.added} proxy(s) correctamente y se rebalancearon las cuentas.`,
      result,
      stats: pool.stats,
      proxies: pool.proxies,
      assignments
    });
  } catch (err) {
    console.error('[Admin Proxies Bulk Error]', err);
    res.status(400).json({ error: err.message || 'Error al procesar el lote de proxies' });
  }
});

// DELETE /admin/proxies/:id - Delete proxy and rebalance remaining profiles
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await proxyPoolManager.removeProxy(id);
    const pool = await proxyPoolManager.getPoolSummary();
    const assignments = await proxyPoolManager.getProfilesAssignmentList();

    res.json({
      success: true,
      message: 'Proxy eliminado del pool y cuentas reasignadas automáticamente.',
      stats: pool.stats,
      proxies: pool.proxies,
      assignments
    });
  } catch (err) {
    console.error('[Admin Proxies Delete Error]', err);
    res.status(400).json({ error: err.message || 'Error al eliminar el proxy' });
  }
});

// POST /admin/proxies/rebalance - Force rebalance across all profiles
router.post('/rebalance', async (req, res) => {
  try {
    const result = await proxyPoolManager.rebalanceAllProfiles();
    const pool = await proxyPoolManager.getPoolSummary();
    const assignments = await proxyPoolManager.getProfilesAssignmentList();

    res.json({
      success: true,
      message: 'Asignación de proxies rebalanceada con éxito.',
      result,
      stats: pool.stats,
      proxies: pool.proxies,
      assignments
    });
  } catch (err) {
    console.error('[Admin Proxies Rebalance Error]', err);
    res.status(500).json({ error: err.message || 'Error al rebalancear los proxies' });
  }
});

module.exports = router;
