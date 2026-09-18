const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const db = require('../db');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Map of active Baileys sessions: profileId -> { socket, state, saveCreds, qr, status, phoneNumber }
const sessions = new Map();

// Base directory for persistent WhatsApp sessions
const SESSIONS_DIR = path.join(__dirname, '..', '..', 'sessions_data');
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Callback listeners for real-time WebSocket broadcast
const listeners = {
  qr: new Set(),      // fn(profileId, qrDataUrl)
  status: new Set(),  // fn(profileId, status, details)
};

/**
 * Register listener for QR events
 */
function onQR(callback) {
  listeners.qr.add(callback);
  return () => listeners.qr.delete(callback);
}

/**
 * Register listener for Status events
 */
function onStatus(callback) {
  listeners.status.add(callback);
  return () => listeners.status.delete(callback);
}

function emitQR(profileId, qrDataUrl) {
  for (const fn of listeners.qr) {
    try { fn(profileId, qrDataUrl); } catch (e) { console.error('[BaileysManager] QR listener error:', e); }
  }
}

function emitStatus(profileId, status, details = {}) {
  for (const fn of listeners.status) {
    try { fn(profileId, status, details); } catch (e) { console.error('[BaileysManager] Status listener error:', e); }
  }
}

/**
 * Get profile session directory path
 */
function getSessionDir(profileId) {
  return path.join(SESSIONS_DIR, `session_${profileId}`);
}

/**
 * Initialize a Baileys WhatsApp session for a profile
 */
async function initSession(profileId) {
  const existing = sessions.get(profileId);
  if (existing && existing.status === 'connected') {
    return { status: 'connected', phoneNumber: existing.phoneNumber };
  }

  const sessionDir = getSessionDir(profileId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const existingSession = sessions.get(profileId);
  const existingAttempts = existingSession ? (existingSession.reconnectAttempts || 0) : 0;

  const sessionObj = {
    socket: null,
    state,
    saveCreds,
    qr: null,
    status: 'connecting',
    phoneNumber: '',
    reconnectAttempts: existingAttempts
  };
  sessions.set(profileId, sessionObj);

  emitStatus(profileId, 'connecting');

  const logger = pino({ level: 'silent' });

  // Check if profile has a dedicated proxy configured
  let proxyAgent = undefined;
  try {
    const profRes = await db.query('SELECT proxy_url, name FROM profiles WHERE id = $1', [profileId]);
    if (profRes.rows.length > 0 && profRes.rows[0].proxy_url) {
      const pUrl = profRes.rows[0].proxy_url.trim();
      if (pUrl) {
        if (pUrl.startsWith('socks')) {
          proxyAgent = new SocksProxyAgent(pUrl);
        } else {
          proxyAgent = new HttpsProxyAgent(pUrl);
        }
        const masked = pUrl.replace(/:[^:@]+@/, ':***@');
        console.log(`[BaileysManager] Profile '${profRes.rows[0].name}' (${profileId}) connecting via dedicated proxy: ${masked}`);
      }
    }
  } catch (proxyErr) {
    console.warn(`[BaileysManager] Warning checking proxy for profile ${profileId}:`, proxyErr.message);
  }

  const socket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: Browsers.macOS('Desktop'),
    agent: proxyAgent,
    fetchAgent: proxyAgent,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sessionObj.socket = socket;

  // Save credentials on update
  socket.ev.on('creds.update', saveCreds);

  // Connection state updates
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, scale: 6 });
        sessionObj.qr = qrDataUrl;
        sessionObj.status = 'qr';
        emitQR(profileId, qrDataUrl);
        emitStatus(profileId, 'qr', { qr: qrDataUrl });
      } catch (err) {
        console.error(`[BaileysManager] Error generating QR for profile ${profileId}:`, err);
      }
    }

    if (connection === 'open') {
      sessionObj.status = 'connected';
      sessionObj.qr = null;
      sessionObj.reconnectAttempts = 0;

      // Extract phone number from JID (e.g. 5491112345678:12@s.whatsapp.net)
      const rawJid = socket.user?.id || '';
      const phoneNumber = rawJid.split('@')[0].split(':')[0];
      sessionObj.phoneNumber = phoneNumber;

      console.log(`[BaileysManager] Profile ${profileId} CONNECTED. Phone: ${phoneNumber}`);

      // Persist in DB
      try {
        await db.query(
          "UPDATE profiles SET status = 'connected', phone_number = $1 WHERE id = $2",
          [phoneNumber, profileId]
        );
      } catch (dbErr) {
        console.error(`[BaileysManager] Error updating DB status on connect for ${profileId}:`, dbErr);
      }

      emitStatus(profileId, 'connected', { phoneNumber });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[BaileysManager] Profile ${profileId} disconnected. Code: ${statusCode}, shouldReconnect: ${shouldReconnect}`);

      if (statusCode === DisconnectReason.loggedOut) {
        // Logged out permanently: clean up
        sessionObj.status = 'disconnected';
        sessionObj.phoneNumber = '';
        sessionObj.qr = null;
        sessions.delete(profileId);

        // Delete session folder
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (rmErr) {
          console.error(`[BaileysManager] Error cleaning session dir ${sessionDir}:`, rmErr);
        }

        try {
          await db.query(
            "UPDATE profiles SET status = 'disconnected', phone_number = '', is_active_bot = FALSE WHERE id = $1",
            [profileId]
          );
        } catch (dbErr) {
          console.error(`[BaileysManager] DB error updating logout for ${profileId}:`, dbErr);
        }

        emitStatus(profileId, 'disconnected', { reason: 'logged_out' });
      } else {
        // Temporary disconnection (network glitch, socket reset)
        sessionObj.status = 'disconnected';
        emitStatus(profileId, 'disconnected', { reason: 'connection_lost' });

        try {
          await db.query("UPDATE profiles SET status = 'disconnected' WHERE id = $1", [profileId]);
        } catch (dbErr) {
          console.error(`[BaileysManager] DB error on disconnect for ${profileId}:`, dbErr);
        }

        // Auto-reconnect with backoff if attempts < 3
        if (sessionObj.reconnectAttempts < 3) {
          sessionObj.reconnectAttempts++;
          const delay = Math.min(sessionObj.reconnectAttempts * 3000, 10000);
          console.log(`[BaileysManager] Reconnecting profile ${profileId} in ${delay}ms (attempt ${sessionObj.reconnectAttempts})...`);
          setTimeout(() => {
            initSession(profileId).catch(err => {
              console.error(`[BaileysManager] Reconnect error for ${profileId}:`, err.message);
            });
          }, delay);
        } else {
          console.log(`[BaileysManager] Profile ${profileId} reached max reconnect attempts (3). Stopping auto-reconnect.`);
          sessionObj.reconnectAttempts = 0;
        }
      }
    }
  });

  return { status: sessionObj.status, qr: sessionObj.qr, phoneNumber: sessionObj.phoneNumber };
}

/**
 * Format and verify phone number for WhatsApp
 */
async function resolveJid(socket, rawNumber) {
  let cleaned = String(rawNumber).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);

  // Argentina specific normalization:
  // Argentine mobile international format is 549XXXXXXXXXX (13 digits)
  // If user provided 54XXXXXXXXXX (12 digits) or local 11XXXXXXXX / 15XXXXXXXX
  if (cleaned.startsWith('54') && !cleaned.startsWith('549') && cleaned.length === 12) {
    cleaned = '549' + cleaned.slice(2);
  }

  // Check via WhatsApp servers
  try {
    const results = await socket.onWhatsApp(cleaned);
    if (results && results.length > 0 && results[0].exists) {
      return results[0].jid;
    }
  } catch (err) {
    console.warn(`[BaileysManager] onWhatsApp verification failed for ${cleaned}:`, err.message);
  }

  // Fallback to standard JID
  return `${cleaned}@s.whatsapp.net`;
}

/**
 * Send a WhatsApp text message with simulated human typing
 */
async function sendMessage(profileId, rawNumber, text) {
  const session = sessions.get(profileId);
  if (!session || !session.socket || session.status !== 'connected') {
    throw new Error('El WhatsApp no está conectado');
  }

  const socket = session.socket;
  const jid = await resolveJid(socket, rawNumber);

  // Human behavior simulation: typing indicator
  try {
    await socket.sendPresenceUpdate('composing', jid);
    // Dynamic typing delay proportional to message length: 1.5s to 4s
    const typingTime = Math.min(Math.max(text.length * 20, 1500), 4000);
    await new Promise(resolve => setTimeout(resolve, typingTime));
    await socket.sendPresenceUpdate('paused', jid);
  } catch (presenceErr) {
    // Non-fatal, proceed with send
  }

  // Send message
  const result = await socket.sendMessage(jid, { text });
  return {
    success: true,
    messageId: result?.key?.id || '',
    jid,
    timestamp: new Date().toISOString()
  };
}

/**
 * Disconnect a session gracefully without deleting session data
 */
async function disconnectSession(profileId) {
  const session = sessions.get(profileId);
  if (session && session.socket) {
    try {
      session.socket.end(new Error('Manual disconnect requested'));
    } catch (e) {
      // Ignore
    }
  }
  sessions.delete(profileId);

  try {
    await db.query("UPDATE profiles SET status = 'disconnected', is_active_bot = FALSE WHERE id = $1", [profileId]);
  } catch (e) {
    console.error(`[BaileysManager] Error updating DB on disconnect ${profileId}:`, e);
  }

  emitStatus(profileId, 'disconnected', { manual: true });
  return { success: true };
}

/**
 * Unlink and delete session data permanently
 */
async function unlinkSession(profileId) {
  const session = sessions.get(profileId);
  if (session && session.socket) {
    try {
      await session.socket.logout();
    } catch (e) {
      // Ignore
    }
  }
  sessions.delete(profileId);

  const sessionDir = getSessionDir(profileId);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (e) {
    console.error(`[BaileysManager] Error deleting session dir for ${profileId}:`, e);
  }

  try {
    await db.query(
      "UPDATE profiles SET status = 'disconnected', phone_number = '', is_active_bot = FALSE WHERE id = $1",
      [profileId]
    );
  } catch (e) {
    console.error(`[BaileysManager] Error updating DB on unlink ${profileId}:`, e);
  }

  emitStatus(profileId, 'disconnected', { unlinked: true });
  return { success: true };
}

/**
 * Get current session state
 */
function getSession(profileId) {
  const s = sessions.get(profileId);
  if (!s) {
    return { status: 'disconnected', qr: null, phoneNumber: '' };
  }
  return {
    status: s.status,
    qr: s.qr,
    phoneNumber: s.phoneNumber
  };
}

/**
 * Auto-restore any previously connected sessions on server boot
 */
async function autoRestoreSessions() {
  try {
    // Check which session folders exist on disk
    if (!fs.existsSync(SESSIONS_DIR)) return;
    const entries = fs.readdirSync(SESSIONS_DIR);

    console.log(`[BaileysManager] Checking existing sessions on disk (${entries.length} found)...`);

    for (const entry of entries) {
      if (entry.startsWith('session_')) {
        const profileId = entry.replace('session_', '');
        // Verify in DB that profile is still valid
        const res = await db.query("SELECT id, status, name FROM profiles WHERE id = $1", [profileId]);
        if (res.rows.length > 0) {
          console.log(`[BaileysManager] Auto-restoring session for profile '${res.rows[0].name}' (${profileId})...`);
          initSession(profileId).catch(err => {
            console.warn(`[BaileysManager] Failed to auto-restore ${profileId}:`, err.message);
          });
        }
      }
    }
  } catch (err) {
    console.error('[BaileysManager] Auto-restore error:', err);
  }
}

module.exports = {
  initSession,
  sendMessage,
  disconnectSession,
  unlinkSession,
  getSession,
  autoRestoreSessions,
  onQR,
  onStatus,
  sessions
};
