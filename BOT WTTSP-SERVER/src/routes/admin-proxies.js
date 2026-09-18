const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authenticate');
const proxyPoolManager = require('../services/proxy-pool-manager');

// Middleware: Strictly enforce Admin or SuperAdmin access
function requireAdminOrSuperAdmin(req, res, next) {
  if (!req.user || !['superadmin', 'admin'].includes(req.user.role)) {
    return res.status(403).json({
      error: 'Acceso Denegado: La administración de proxies es exclusiva para Administradores y SuperAdmin'
    });
  }
  next();
}

function resolveCompanyId(req) {
  if (req.user && req.user.role === 'superadmin') {
    return req.query?.companyId || req.body?.companyId || null;
  }
  return req.user?.companyId || null;
}

router.use(authenticateToken);
router.use(requireAdminOrSuperAdmin);

// GET /admin/proxies - Retrieve pool summary, proxies list, and WhatsApp assignment status for a company
router.get('/', async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: 'Debe especificar el ID de la empresa (companyId)' });
  }

  try {
    const pool = await proxyPoolManager.getPoolSummary(companyId);
    const assignments = await proxyPoolManager.getProfilesAssignmentList(companyId);
    res.json({
      companyId: pool.companyId,
      companyName: pool.companyName,
      stats: pool.stats,
      proxies: pool.proxies,
      assignments
    });
  } catch (err) {
    console.error('[Admin Proxies GET Error]', err);
    res.status(500).json({ error: 'Error al obtener el pool de proxies: ' + err.message });
  }
});

// POST /admin/proxies/bulk - Bulk add proxies from text and auto-assign in groups of 20 for this company
router.post('/bulk', async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: 'Debe especificar el ID de la empresa (companyId)' });
  }

  const { text, maxCapacity } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Debe ingresar al menos una URL o línea de proxy' });
  }

  const capacity = parseInt(maxCapacity, 10) || 20;

  try {
    const result = await proxyPoolManager.addProxiesBulk(companyId, text, capacity);
    const pool = await proxyPoolManager.getPoolSummary(companyId);
    const assignments = await proxyPoolManager.getProfilesAssignmentList(companyId);

    res.json({
      success: true,
      message: `Se cargaron ${result.added} proxy(s) correctamente y se asignaron a las cuentas de ${pool.companyName}.`,
      result,
      companyId: pool.companyId,
      companyName: pool.companyName,
      stats: pool.stats,
      proxies: pool.proxies,
      assignments
    });
  } catch (err) {
    console.error('[Admin Proxies Bulk Error]', err);
    res.status(400).json({ error: err.message || 'Error al procesar el lote de proxies' });
  }
});

// DELETE /admin/proxies/:id - Delete proxy and rebalance remaining profiles of this company
router.delete('/:id', async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: 'Debe especificar el ID de la empresa (companyId)' });
  }

  const { id } = req.params;
  try {
    await proxyPoolManager.removeProxy(companyId, id);
    const pool = await proxyPoolManager.getPoolSummary(companyId);
    const assignments = await proxyPoolManager.getProfilesAssignmentList(companyId);

    res.json({
      success: true,
      message: 'Proxy eliminado del pool de la empresa y cuentas reasignadas automáticamente.',
      companyId: pool.companyId,
      companyName: pool.companyName,
      stats: pool.stats,
      proxies: pool.proxies,
      assignments
    });
  } catch (err) {
    console.error('[Admin Proxies Delete Error]', err);
    res.status(400).json({ error: err.message || 'Error al eliminar el proxy' });
  }
});

// POST /admin/proxies/rebalance - Force rebalance across profiles of this company
router.post('/rebalance', async (req, res) => {
  const companyId = resolveCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: 'Debe especificar el ID de la empresa (companyId)' });
  }

  try {
    const result = await proxyPoolManager.rebalanceCompanyProfiles(companyId);
    const pool = await proxyPoolManager.getPoolSummary(companyId);
    const assignments = await proxyPoolManager.getProfilesAssignmentList(companyId);

    res.json({
      success: true,
      message: `Asignación de proxies de ${pool.companyName} rebalanceada con éxito.`,
      result,
      companyId: pool.companyId,
      companyName: pool.companyName,
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
