const db = require('../db');
const baileysManager = require('./baileys-manager');

/**
 * Clean & normalize proxy input strings.
 * Supports:
 * - http(s)://user:pass@host:port
 * - socks5://user:pass@host:port
 * - host:port:user:pass -> http://user:pass@host:port
 * - host:port -> http://host:port
 */
function normalizeProxyUrl(rawLine) {
  let line = (rawLine || '').trim();
  if (!line || line.startsWith('#') || line.startsWith('//')) return null;

  // Case 1: Standard URL format
  if (/^https?:\/\//i.test(line) || /^socks[45]?:\/\//i.test(line)) {
    return line;
  }

  // Case 2: host:port:user:pass
  const parts = line.split(':');
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return `http://${user}:${pass}@${host}:${port}`;
  }

  // Case 3: host:port
  if (parts.length === 2 && !isNaN(parts[1])) {
    return `http://${parts[0]}:${parts[1]}`;
  }

  // Fallback prefix
  return `http://${line}`;
}

/**
 * Extract a friendly human-readable label and masked URL for display
 */
function getProxyMetadata(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    const hostPort = `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? 443 : 80)}`;
    const masked = proxyUrl.replace(/:[^:@]+@/, ':***@');
    return {
      label: hostPort,
      protocol: parsed.protocol.replace(':', '').toUpperCase(),
      maskedUrl: masked
    };
  } catch (e) {
    return {
      label: proxyUrl.substring(0, 30),
      protocol: 'HTTP',
      maskedUrl: proxyUrl
    };
  }
}

/**
 * Parse bulk text with newlines into clean proxy array
 */
function parseProxies(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const proxies = [];

  for (const raw of lines) {
    const normalized = normalizeProxyUrl(raw);
    if (normalized) {
      proxies.push(normalized);
    }
  }
  return proxies;
}

/**
 * Add proxies in bulk to proxy_pool for a specific company and rebalance that company's profiles
 */
async function addProxiesBulk(companyId, rawText, maxCapacity = 20) {
  if (!companyId) {
    throw new Error('companyId es obligatorio para cargar proxies');
  }

  const parsed = parseProxies(rawText);
  if (parsed.length === 0) {
    throw new Error('No se encontraron URLs o líneas de proxies válidas para cargar');
  }

  let addedCount = 0;
  for (const pUrl of parsed) {
    const meta = getProxyMetadata(pUrl);
    // Check if already exists in this company's pool
    const check = await db.query(
      'SELECT id FROM proxy_pool WHERE company_id = $1 AND proxy_url = $2',
      [companyId, pUrl]
    );
    if (check.rows.length === 0) {
      await db.query(
        'INSERT INTO proxy_pool (company_id, proxy_url, label, max_capacity, is_active) VALUES ($1, $2, $3, $4, TRUE)',
        [companyId, pUrl, meta.label, maxCapacity]
      );
      addedCount++;
    }
  }

  // Automatically rebalance only this company's profiles
  await rebalanceCompanyProfiles(companyId);

  return {
    added: addedCount,
    totalReceived: parsed.length
  };
}

/**
 * Delete a proxy from the company's pool and rebalance that company's profiles
 */
async function removeProxy(companyId, proxyId) {
  if (!companyId) {
    throw new Error('companyId es obligatorio para eliminar un proxy');
  }

  const check = await db.query(
    'SELECT id, label FROM proxy_pool WHERE id = $1 AND company_id = $2',
    [proxyId, companyId]
  );
  if (check.rows.length === 0) {
    throw new Error('Proxy no encontrado en el pool de esta empresa');
  }

  await db.query('DELETE FROM proxy_pool WHERE id = $1 AND company_id = $2', [proxyId, companyId]);
  await rebalanceCompanyProfiles(companyId);

  return { success: true, deletedId: proxyId };
}

/**
 * Auto-Assignment Algorithm Scoped strictly to ONE Company:
 * - Fetches active proxies belonging exclusively to companyId
 * - Fetches profiles belonging exclusively to companyId
 * - Assigns up to 20 profiles per proxy within this company
 * - Remaining overflow profiles receive proxy_id = NULL and proxy_url = NULL (Direct VPS)
 * - Reconnects Baileys sessions for this company if proxy changed
 */
async function rebalanceCompanyProfiles(companyId) {
  if (!companyId) return { totalProfiles: 0, updatedProfiles: 0, activeProxiesCount: 0 };

  const proxiesRes = await db.query(
    'SELECT id, proxy_url, label, max_capacity FROM proxy_pool WHERE company_id = $1 AND is_active = TRUE ORDER BY created_at ASC',
    [companyId]
  );
  const proxies = proxiesRes.rows;

  const profilesRes = await db.query(
    'SELECT id, name, proxy_id, proxy_url FROM profiles WHERE company_id = $1 ORDER BY created_at ASC',
    [companyId]
  );
  const profiles = profilesRes.rows;

  const updates = [];

  let proxyIdx = 0;
  let countInCurrentProxy = 0;

  for (let i = 0; i < profiles.length; i++) {
    const prof = profiles[i];
    let targetProxyId = null;
    let targetProxyUrl = null;

    if (proxyIdx < proxies.length) {
      const currentProxy = proxies[proxyIdx];
      targetProxyId = currentProxy.id;
      targetProxyUrl = currentProxy.proxy_url;

      countInCurrentProxy++;
      if (countInCurrentProxy >= (currentProxy.max_capacity || 20)) {
        proxyIdx++;
        countInCurrentProxy = 0;
      }
    }

    // Check if changed
    const hasChanged = prof.proxy_id !== targetProxyId || prof.proxy_url !== targetProxyUrl;
    if (hasChanged) {
      updates.push({
        profileId: prof.id,
        name: prof.name,
        newProxyId: targetProxyId,
        newProxyUrl: targetProxyUrl,
        oldProxyUrl: prof.proxy_url
      });
    }
  }

  // Apply updates to DB
  for (const u of updates) {
    await db.query(
      'UPDATE profiles SET proxy_id = $1, proxy_url = $2 WHERE id = $3 AND company_id = $4',
      [u.newProxyId, u.newProxyUrl, u.profileId, companyId]
    );

    // If session is active and proxy changed, reconnect with the new IP
    if (baileysManager && typeof baileysManager.getSession === 'function') {
      const sess = baileysManager.getSession(u.profileId);
      if (sess && sess.status !== 'disconnected') {
        console.log(`[ProxyPool] Profile '${u.name}' (Empresa: ${companyId}) assigned new proxy. Reconnecting session...`);
        baileysManager.disconnectSession(u.profileId)
          .then(() => baileysManager.initSession(u.profileId))
          .catch(e => console.error(`[ProxyPool] Reconnect error for ${u.profileId}:`, e.message));
      }
    }
  }

  return {
    totalProfiles: profiles.length,
    updatedProfiles: updates.length,
    activeProxiesCount: proxies.length
  };
}

/**
 * Backwards-compatible / Global rebalancer: iterates each company and balances internally
 */
async function rebalanceAllProfiles() {
  const companiesRes = await db.query('SELECT id FROM companies');
  let totalProfiles = 0;
  let updatedProfiles = 0;
  let totalActiveProxies = 0;

  for (const comp of companiesRes.rows) {
    const res = await rebalanceCompanyProfiles(comp.id);
    totalProfiles += res.totalProfiles;
    updatedProfiles += res.updatedProfiles;
    totalActiveProxies += res.activeProxiesCount;
  }

  return {
    totalProfiles,
    updatedProfiles,
    activeProxiesCount: totalActiveProxies
  };
}

/**
 * Get summary stats and list of pool proxies for a specific company
 */
async function getPoolSummary(companyId) {
  if (!companyId) {
    throw new Error('companyId es obligatorio para obtener el pool de proxies');
  }

  const proxiesRes = await db.query(
    `SELECT p.id, p.company_id, p.proxy_url, p.label, p.max_capacity, p.is_active, p.created_at,
            COUNT(pr.id)::int as assigned_count
     FROM proxy_pool p
     LEFT JOIN profiles pr ON pr.proxy_id = p.id
     WHERE p.company_id = $1
     GROUP BY p.id
     ORDER BY p.created_at ASC`,
    [companyId]
  );

  const totalProfilesRes = await db.query('SELECT COUNT(*)::int as total FROM profiles WHERE company_id = $1', [companyId]);
  const directVpsRes = await db.query('SELECT COUNT(*)::int as direct FROM profiles WHERE company_id = $1 AND proxy_id IS NULL', [companyId]);

  const totalProfiles = totalProfilesRes.rows[0]?.total || 0;
  const directVpsCount = directVpsRes.rows[0]?.direct || 0;
  const assignedToProxies = totalProfiles - directVpsCount;

  const proxies = proxiesRes.rows.map(p => {
    const meta = getProxyMetadata(p.proxy_url);
    return {
      id: p.id,
      companyId: p.company_id,
      label: p.label || meta.label,
      protocol: meta.protocol,
      maskedUrl: meta.maskedUrl,
      max_capacity: p.max_capacity || 20,
      assigned_count: p.assigned_count || 0,
      is_active: p.is_active,
      created_at: p.created_at
    };
  });

  const totalCapacity = proxies.reduce((acc, p) => acc + p.max_capacity, 0);

  // Get company name
  const compRes = await db.query('SELECT name FROM companies WHERE id = $1', [companyId]);
  const companyName = compRes.rows[0]?.name || 'Empresa';

  return {
    companyId,
    companyName,
    stats: {
      totalProxies: proxies.length,
      totalCapacity,
      totalProfiles,
      assignedToProxies,
      directVpsCount
    },
    proxies
  };
}

/**
 * Get detailed table of WhatsApp accounts for a specific company and their assigned proxy / IP
 */
async function getProfilesAssignmentList(companyId) {
  if (!companyId) {
    throw new Error('companyId es obligatorio para obtener la asignación de proxies');
  }

  const res = await db.query(`
    SELECT p.id, p.name, p.status, p.phone_number, p.sent_today, p.daily_limit,
           p.proxy_id, p.proxy_url,
           u.email as operator_email,
           c.name as company_name,
           pp.label as proxy_label
    FROM profiles p
    LEFT JOIN users u ON p.assigned_user_id = u.id
    LEFT JOIN companies c ON p.company_id = c.id
    LEFT JOIN proxy_pool pp ON p.proxy_id = pp.id
    WHERE p.company_id = $1
    ORDER BY pp.created_at ASC NULLS LAST, p.created_at ASC
  `, [companyId]);

  return res.rows.map(r => {
    let assignedDisplay = 'Conexión Directa VPS';
    let isDirect = true;
    if (r.proxy_url) {
      const meta = getProxyMetadata(r.proxy_url);
      assignedDisplay = `Proxy (${r.proxy_label || meta.label})`;
      isDirect = false;
    }

    return {
      id: r.id,
      name: r.name,
      status: r.status,
      phoneNumber: r.phone_number,
      sentToday: r.sent_today || 0,
      dailyLimit: r.daily_limit || 200,
      operatorEmail: r.operator_email || 'Sin asignar',
      companyName: r.company_name || 'Sin empresa',
      assignedDisplay,
      isDirect,
      proxyId: r.proxy_id
    };
  });
}

module.exports = {
  normalizeProxyUrl,
  parseProxies,
  addProxiesBulk,
  removeProxy,
  rebalanceCompanyProfiles,
  rebalanceAllProfiles,
  getPoolSummary,
  getProfilesAssignmentList
};
