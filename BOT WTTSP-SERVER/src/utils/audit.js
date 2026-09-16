const db = require('../db');

async function logAudit(req, action, details = {}) {
  try {
    const isSuperAdmin = req.user && req.user.role === 'superadmin';
    const userId = req.user ? req.user.id : null;
    // SuperAdmin actions are global and never tied to a tenant company's audit log
    const companyId = isSuperAdmin 
      ? null 
      : (req.user && req.user.companyId ? req.user.companyId : (details.companyId || null));
    const userEmail = req.user ? req.user.email : (details.email || 'Sistema');
    
    // IP extraction
    const forwarded = req.headers ? req.headers['x-forwarded-for'] : null;
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : (req.socket ? req.socket.remoteAddress : '');

    await db.query(
      'INSERT INTO audit_logs (user_id, company_id, user_email, action, details, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, companyId, userEmail, action, JSON.stringify(details), ipAddress]
    );
  } catch (err) {
    console.error('[Audit Log Error]', err.message);
  }
}

module.exports = { logAudit };
