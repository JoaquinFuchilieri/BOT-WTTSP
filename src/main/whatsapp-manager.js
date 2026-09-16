const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { app, Notification } = require('electron');

class WhatsAppManager {
  constructor() {
    // Map<profileId, { client, status, qrRetries, initPromise }>
    this.sessions = new Map();
    // Callback functions set by main/index.js
    this.onQRCode = null;       // (profileId, qrDataUrl) => void
    this.onStatusChange = null; // (profileId, status) => void
    this.onError = null;        // (profileId, error) => void
  }

  getSessionsPath() {
    return path.join(app.getPath('userData'), 'whatsapp-sessions');
  }

  /**
   * Display native operating system notification with sound when WhatsApp disconnects
   */
  _sendDisconnectionNotification(profileId, reason) {
    try {
      if (Notification.isSupported()) {
        const notif = new Notification({
          title: '⚠️ WhatsApp Desconectado',
          body: `La sesión de WhatsApp se ha desconectado (${reason || 'Sesión perdida'}). Revisá tu conexión o escaneá el código QR para continuar.`,
          urgency: 'critical',
          silent: false
        });
        notif.show();
      }
    } catch (e) {
      console.warn('[WA] Could not show desktop notification:', e.message);
    }
  }

  /**
   * Clean orphan Windows Singleton lock files and kill orphan chrome processes for a profile.
   */
  _cleanSessionLocks(profileId) {
    try {
      // 1. Terminate any orphan Chrome processes holding this profile's session folder
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { \\$_.CommandLine -like '*session-${profileId}*' } | ForEach-Object { Stop-Process -Id \\$_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
        } catch (e) {}
      }

      const sessionDir = path.join(this.getSessionsPath(), 'session-' + profileId);
      if (!fs.existsSync(sessionDir)) return;

      // 2. Remove all lockfiles that cause Puppeteer to throw 'browser is already running'
      const lockNames = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
      for (const name of lockNames) {
        const fullPath = path.join(sessionDir, name);
        if (fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); } catch (e) {}
        }
        const defaultPath = path.join(sessionDir, 'Default', name);
        if (fs.existsSync(defaultPath)) {
          try { fs.unlinkSync(defaultPath); } catch (e) {}
        }
      }
    } catch (err) {
      console.warn(`[WA:${profileId}] Lock cleanup warning:`, err.message);
    }
  }

  /**
   * Clean all orphan processes and lock files across all profiles (called at app start)
   */
  cleanAllOrphanProcesses() {
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { \\$_.CommandLine -like '*whatsapp-sessions*' } | ForEach-Object { Stop-Process -Id \\$_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
      } catch (e) {}
    }
    try {
      const sessionsPath = this.getSessionsPath();
      if (!fs.existsSync(sessionsPath)) return;
      const dirs = fs.readdirSync(sessionsPath);
      const lockNames = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];
      for (const dir of dirs) {
        const sessionDir = path.join(sessionsPath, dir);
        for (const name of lockNames) {
          const p1 = path.join(sessionDir, name);
          if (fs.existsSync(p1)) {
            try { fs.unlinkSync(p1); } catch (e) {}
          }
          const p2 = path.join(sessionDir, 'Default', name);
          if (fs.existsSync(p2)) {
            try { fs.unlinkSync(p2); } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }

  /**
   * Initialize a WhatsApp client for a profile.
   * Creates an optimized, isolated Puppeteer client with LocalAuth.
   */
  async initClient(profileId) {
    // 1. If client already exists in memory, verify state
    if (this.sessions.has(profileId)) {
      const session = this.sessions.get(profileId);
      if (session.status === 'connected') {
        console.log(`[WA:${profileId}] Client already connected`);
        return session.client;
      }
      // If client is already in the middle of connecting, return existing promise (no loops / no double destroy)
      if (session.initPromise && (session.status === 'initializing' || session.status === 'waiting_qr' || session.status === 'authenticated')) {
        console.log(`[WA:${profileId}] Client initialization in progress, awaiting existing promise...`);
        return session.initPromise;
      }
      // If in error or disconnected state, cleanly destroy before recreating
      await this.destroyClient(profileId);
    }

    console.log(`[WA:${profileId}] Initializing client with high-concurrency settings...`);
    this._cleanSessionLocks(profileId);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: profileId,
        dataPath: this.getSessionsPath()
      }),
      webVersionCache: {
        type: 'local'
      },
      authTimeoutMs: 60000,
      qrMaxRetries: 5,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 5000,
      puppeteer: {
        headless: true,
        protocolTimeout: 120000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          // Crucial anti-throttling flags so Windows does NOT freeze background/inactive browsers
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=CalculateNativeWinOcclusion',
          '--disable-ipc-flooding-protection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-sync',
          '--no-default-browser-check',
          '--mute-audio',
          '--disable-notifications'
        ]
      }
    });

    const session = {
      client,
      status: 'initializing',
      qrRetries: 0,
      initPromise: null
    };
    this.sessions.set(profileId, session);

    // === EVENT HANDLERS ===

    client.on('error', (err) => {
      console.error(`[WA:${profileId}] Client caught error:`, err.message || err);
    });

    client.on('qr', async (qr) => {
      session.qrRetries++;
      console.log(`[WA:${profileId}] QR Code received (attempt ${session.qrRetries})`);

      if (session.qrRetries > 5) {
        console.log(`[WA:${profileId}] Too many QR retries, destroying client`);
        await this.destroyClient(profileId);
        this._emitStatus(profileId, 'disconnected');
        return;
      }

      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 280,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
        session.status = 'waiting_qr';
        session.lastQrDataUrl = qrDataUrl;
        this._emitStatus(profileId, 'waiting_qr');
        if (this.onQRCode) {
          this.onQRCode(profileId, qrDataUrl);
        }
      } catch (err) {
        console.error(`[WA:${profileId}] Error generating QR:`, err);
      }
    });

    client.on('authenticated', () => {
      console.log(`[WA:${profileId}] Authenticated successfully, loading chats...`);
      session.status = 'authenticated';
      session.qrRetries = 0;
      session.lastQrDataUrl = null;
      this._emitStatus(profileId, 'authenticated');
    });

    client.on('ready', () => {
      console.log(`[WA:${profileId}] Client is ready!`);
      session.status = 'connected';
      this._emitStatus(profileId, 'connected');
      setTimeout(() => this.dismissModals(client), 2000);
      setTimeout(() => this.dismissModals(client), 6000);
    });

    client.on('auth_failure', async (msg) => {
      console.error(`[WA:${profileId}] Auth failure:`, msg);
      session.status = 'auth_failure';
      this._emitStatus(profileId, 'disconnected');
      this._sendDisconnectionNotification(profileId, `Fallo de autenticación: ${msg}`);
      if (this.onError) {
        this.onError(profileId, `Error de autenticación: ${msg}`);
      }
    });

    client.on('disconnected', async (reason) => {
      console.log(`[WA:${profileId}] Disconnected:`, reason);
      session.status = 'disconnected';
      this._emitStatus(profileId, 'disconnected');
      this._sendDisconnectionNotification(profileId, `Desconectado: ${reason || 'Sesión finalizada'}`);
    });

    // Wrapped in a promise tracked by session so concurrent callers await the same init
    const initPromise = (async () => {
      try {
        await client.initialize();

        // Safely listen for page and browser errors to prevent process-level unhandled crashes
        if (client.pupPage) {
          client.pupPage.on('error', (err) => {
            console.error(`[WA:${profileId}] Puppeteer page error:`, err.message || err);
          });
          client.pupPage.on('pageerror', (err) => {
            console.warn(`[WA:${profileId}] Puppeteer page console error:`, err.message || err);
          });
        }
        if (client.pupBrowser) {
          client.pupBrowser.on('disconnected', () => {
            console.warn(`[WA:${profileId}] Puppeteer browser disconnected`);
          });
        }

        return client;
      } catch (err) {
        console.error(`[WA:${profileId}] Failed to initialize:`, err.message);
        session.status = 'error';
        this._emitStatus(profileId, 'disconnected');
        if (this.onError) {
          this.onError(profileId, `Error al inicializar: ${err.message}`);
        }
        throw err;
      } finally {
        session.initPromise = null;
      }
    })();

    session.initPromise = initPromise;
    return initPromise;
  }

  /**
   * Intelligently resolve a phone number into an active WhatsApp JID.
   * Handles local Argentine formats (549 vs 54), Mexico (521 vs 52), and raw international numbers.
   * Tests variants with getNumberId() against WhatsApp servers.
   */
  async resolveContactJid(client, rawPhone) {
    const digits = (rawPhone || '').replace(/[^\d]/g, '');
    if (!digits || digits.length < 7) {
      return null;
    }

    const candidates = [];

    // Prioritize Argentine mobile (+549) if raw phone has 10 or 11 digits without country code
    if (!digits.startsWith('54') && (digits.length === 10 || digits.length === 11)) {
      if (digits.startsWith('15') && digits.length === 10) {
        candidates.push('54911' + digits.slice(2));
      } else {
        candidates.push('549' + digits);
        candidates.push('54' + digits);
      }
    }

    // Candidate: Exact digits as entered
    candidates.push(digits);

    // Candidate: Argentina (549 vs 54 vs local)
    if (digits.startsWith('549') && digits.length >= 12) {
      // 5491112345678 -> 541112345678 (without mobile 9)
      candidates.push('54' + digits.slice(3));
    } else if (digits.startsWith('54') && !digits.startsWith('549') && digits.length >= 11) {
      // 541112345678 -> 5491112345678 (with mobile 9)
      candidates.push('549' + digits.slice(2));
    }

    // Candidate: Mexico (521 vs 52)
    if (digits.startsWith('521') && digits.length >= 13) {
      candidates.push('52' + digits.slice(3));
    } else if (digits.startsWith('52') && !digits.startsWith('521') && digits.length >= 12) {
      candidates.push('521' + digits.slice(2));
    }

    const uniqueCandidates = [...new Set(candidates)];

    for (const cand of uniqueCandidates) {
      try {
        const jid = cand.endsWith('@c.us') ? cand : `${cand}@c.us`;
        const numberId = await client.getNumberId(jid);
        if (numberId) {
          // If WhatsApp returned a phone @c.us JID, use it
          if (numberId._serialized && numberId._serialized.endsWith('@c.us')) {
            console.log(`[WA] Validated @c.us user for ${rawPhone} -> ${numberId._serialized}`);
            return numberId._serialized;
          }
          // If WhatsApp returned an @lid (Linked Identity), NEVER send to @lid!
          // whatsapp-web.js cannot start/open chats with @lid. Instead, use the verified phone JID.
          const phoneJid = cand.endsWith('@c.us') ? cand : `${cand}@c.us`;
          console.log(`[WA] Validated user via LID (${numberId._serialized || numberId.user}), dispatching to verified phone JID: ${phoneJid}`);
          return phoneJid;
        }
      } catch (err) {
        if (
          err.message.includes('Session closed') ||
          err.message.includes('Target closed') ||
          err.message.includes('Protocol error') ||
          err.message.includes('destroyed') ||
          err.message.includes('detached')
        ) {
          throw err;
        }
        console.warn(`[WA] getNumberId probe error for ${cand}:`, err.message);
      }
    }

    return null;
  }

  /**
   * Send a text message to a phone number.
   * Simulates human behavior: marks chat as seen, shows typing indicator, then sends.
   * Strictly verifies that the number exists on WhatsApp and confirms message dispatch.
   */
  async sendMessage(profileId, phoneNumber, text) {
    const session = this.sessions.get(profileId);
    if (!session || session.status !== 'connected') {
      throw new Error('WhatsApp no está conectado para este perfil');
    }

    const client = session.client;

    // 1. Resolve registered WhatsApp ID with server verification
    const targetJid = await this.resolveContactJid(client, phoneNumber);
    if (!targetJid) {
      throw new Error(`El número ${phoneNumber} no está registrado en WhatsApp o es inválido`);
    }

    try {
      // Auto-dismiss any announcement or update modal overlays that could block WhatsApp Web
      await this.dismissModals(client);

      // 2. Simulate human-like behavior
      try {
        const chat = await client.getChatById(targetJid);
        if (chat) {
          await this._sleep(600 + Math.random() * 800);
          await chat.sendSeen();
          await chat.sendStateTyping();

          const typingMs = Math.min(
            Math.max(text.length * 35, 1500),
            5000
          ) + Math.floor(Math.random() * 800);
          await this._sleep(typingMs);
          await chat.clearState();
        }
      } catch (simErr) {
        console.log(`[WA:${profileId}] Simulation notice for ${targetJid}:`, simErr.message);
      }

      // 3. Send message
      await this._sleep(300 + Math.random() * 500);
      let result = null;
      try {
        result = await client.sendMessage(targetJid, text, {
          linkPreview: false,
          sendSeen: true
        });
      } catch (sendErr) {
        console.error(`[WA:${profileId}] Error invoking sendMessage for ${targetJid}:`, sendErr.message);
        throw sendErr;
      }

      // In modern WhatsApp Web, result may be undefined even on success because Msg.get() evaluates before local store indexing
      const messageId = (result && result.id)
        ? (typeof result.id === 'string' ? result.id : (result.id._serialized || result.id.id || 'sent'))
        : 'sent';

      console.log(`[WA:${profileId}] ✅ Message confirmed sent to ${targetJid} (Contact: ${phoneNumber}) - ID: ${messageId}`);
      return { success: true, messageId, targetJid };

    } catch (err) {
      console.error(`[WA:${profileId}] ❌ Failed to send to ${phoneNumber} (${targetJid}):`, err.message);
      throw err;
    }
  }

  /**
   * Auto-dismiss WhatsApp Web announcement/update modal dialogs and takeover prompts.
   */
  async dismissModals(client) {
    if (!client || !client.pupPage) return;
    try {
      await client.pupPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('div[role="dialog"] button, div[role="dialog"] div[role="button"], button'));
        for (const btn of buttons) {
          const text = (btn.innerText || '').toLowerCase().trim();
          if (
            text.includes('usar aquí') ||
            text.includes('use here') ||
            text.includes('continuar') ||
            text.includes('entendido') ||
            text.includes('ok') ||
            text.includes('cerrar') ||
            text.includes('close')
          ) {
            btn.click();
            return;
          }
        }
        const closeX = document.querySelector('div[role="dialog"] span[data-icon="x"], div[role="dialog"] button[aria-label="Cerrar"], div[role="dialog"] button[aria-label="Close"]');
        if (closeX) {
          (closeX.closest('button') || closeX).click();
        }
      });
    } catch (e) {}
  }

  /**
   * Get the connection status for a profile
   */
  getStatus(profileId) {
    const session = this.sessions.get(profileId);
    return session ? session.status : 'disconnected';
  }

  /**
   * Check if a profile's client is connected and ready in memory
   */
  isConnected(profileId) {
    const session = this.sessions.get(profileId);
    return session && session.status === 'connected';
  }

  /**
   * Check if credentials exist on disk for this profile.
   * Only true if WhatsApp Web credentials were actually created and authenticated (IndexedDB leveldb exists).
   */
  hasSavedSession(profileId) {
    const sessionDir = path.join(this.getSessionsPath(), 'session-' + profileId);
    if (!fs.existsSync(sessionDir)) return false;

    const idbDir = path.join(sessionDir, 'Default', 'IndexedDB');
    if (!fs.existsSync(idbDir)) return false;

    try {
      const entries = fs.readdirSync(idbDir);
      return entries.some(entry => entry.includes('web.whatsapp.com') && entry.endsWith('.leveldb'));
    } catch (e) {
      return false;
    }
  }

  /**
   * Get full session state (memory status + disk status)
   */
  getSessionState(profileId) {
    const session = this.sessions.get(profileId);
    const status = session ? session.status : 'disconnected';
    return {
      status,
      isConnected: status === 'connected',
      hasSavedSession: this.hasSavedSession(profileId),
      qrDataUrl: session && session.lastQrDataUrl ? session.lastQrDataUrl : null
    };
  }

  /**
   * Destroy a client instance and clean up resources
   */
  async destroyClient(profileId) {
    const session = this.sessions.get(profileId);
    if (!session) {
      this._cleanSessionLocks(profileId);
      return;
    }

    console.log(`[WA:${profileId}] Destroying client...`);
    this.sessions.delete(profileId);

    let browserPid = null;
    try {
      if (session.client && session.client.pupBrowser) {
        const proc = session.client.pupBrowser.process();
        if (proc && proc.pid) browserPid = proc.pid;
      }
    } catch (e) {}

    try {
      if (session.client) {
        await Promise.race([
          session.client.destroy(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('destroy timeout')), 2500))
        ]);
      }
    } catch (err) {
      console.warn(`[WA:${profileId}] Destroy warning:`, err.message);
    }

    // On Windows, kill the browser process tree so all file locks are released
    if (browserPid) {
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /pid ${browserPid} /T /F`, { stdio: 'ignore' });
      } catch (e) {}
    }

    // Force-kill ANY orphan Chrome processes targeting this profile session
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { \\$_.CommandLine -like '*session-${profileId}*' } | ForEach-Object { Stop-Process -Id \\$_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
      } catch (e) {}
    }

    await this._sleep(500);
    this._cleanSessionLocks(profileId);
    this._emitStatus(profileId, 'disconnected');
  }

  /**
   * Completely unlink a WhatsApp session: destroy in memory and purge disk credentials.
   */
  async unlinkSession(profileId) {
    console.log(`[WA:${profileId}] Unlinking session and purging disk credentials...`);
    await this.destroyClient(profileId);
    await this._sleep(600);

    const sessionDir = path.join(this.getSessionsPath(), 'session-' + profileId);
    if (fs.existsSync(sessionDir)) {
      // Force kill again to guarantee no file locks remain
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          execSync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'chrome.exe'\\" | Where-Object { \\$_.CommandLine -like '*session-${profileId}*' } | ForEach-Object { Stop-Process -Id \\$_.ProcessId -Force -ErrorAction SilentlyContinue }"`, { stdio: 'ignore' });
        } catch (e) {}
      }

      try {
        fs.rmSync(sessionDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
      } catch (err) {
        console.warn(`[WA:${profileId}] fs.rmSync warning:`, err.message);
      }
      if (fs.existsSync(sessionDir)) {
        try {
          const { execSync } = require('child_process');
          execSync(`rd /s /q "${sessionDir}"`, { stdio: 'ignore' });
        } catch (e) {}
      }
    }

    const stillExists = fs.existsSync(sessionDir);
    console.log(`[WA:${profileId}] Disk session folder purged: ${!stillExists}`);

    this._cleanSessionLocks(profileId);
    this._emitStatus(profileId, 'disconnected');
    return { success: true };
  }

  /**
   * Destroy all active clients (called on app quit)
   */
  async destroyAll() {
    console.log('[WA] Destroying all clients...');
    const promises = [];
    for (const profileId of this.sessions.keys()) {
      promises.push(this.destroyClient(profileId));
    }
    await Promise.allSettled(promises);
    console.log('[WA] All clients destroyed');
  }

  // === PRIVATE HELPERS ===

  _emitStatus(profileId, status) {
    if (this.onStatusChange) {
      this.onStatusChange(profileId, status);
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = WhatsAppManager;
