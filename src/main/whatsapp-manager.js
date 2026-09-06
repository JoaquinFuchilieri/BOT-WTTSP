const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const { app } = require('electron');

class WhatsAppManager {
  constructor() {
    // Map<profileId, { client, status, qrRetries }>
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
   * Initialize a WhatsApp client for a profile.
   * Creates a new Puppeteer-backed client with LocalAuth for session persistence.
   */
  async initClient(profileId) {
    // If client already exists, return it
    if (this.sessions.has(profileId)) {
      const session = this.sessions.get(profileId);
      if (session.status === 'connected') {
        console.log(`[WA:${profileId}] Client already connected`);
        return session.client;
      }
      // If exists but not connected, destroy and recreate
      await this.destroyClient(profileId);
    }

    console.log(`[WA:${profileId}] Initializing client...`);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: profileId,
        dataPath: this.getSessionsPath()
      }),
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      },
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions'
        ]
      }
    });

    const session = {
      client,
      status: 'initializing',
      qrRetries: 0
    };
    this.sessions.set(profileId, session);

    // === EVENT HANDLERS ===

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
        // Convert QR string to base64 data URL for the frontend
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 280,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' }
        });
        session.status = 'waiting_qr';
        if (this.onQRCode) {
          this.onQRCode(profileId, qrDataUrl);
        }
      } catch (err) {
        console.error(`[WA:${profileId}] Error generating QR:`, err);
      }
    });

    client.on('authenticated', () => {
      console.log(`[WA:${profileId}] Authenticated successfully`);
      session.status = 'authenticated';
      session.qrRetries = 0;
    });

    client.on('ready', () => {
      console.log(`[WA:${profileId}] Client is ready!`);
      session.status = 'connected';
      this._emitStatus(profileId, 'connected');
    });

    client.on('auth_failure', async (msg) => {
      console.error(`[WA:${profileId}] Auth failure:`, msg);
      session.status = 'auth_failure';
      this._emitStatus(profileId, 'disconnected');
      if (this.onError) {
        this.onError(profileId, `Error de autenticación: ${msg}`);
      }
    });

    client.on('disconnected', async (reason) => {
      console.log(`[WA:${profileId}] Disconnected:`, reason);
      session.status = 'disconnected';
      this._emitStatus(profileId, 'disconnected');
    });

    // Initialize the client (this starts Puppeteer and connects)
    try {
      await client.initialize();
    } catch (err) {
      console.error(`[WA:${profileId}] Failed to initialize:`, err);
      session.status = 'error';
      this._emitStatus(profileId, 'disconnected');
      if (this.onError) {
        this.onError(profileId, `Error al inicializar: ${err.message}`);
      }
    }

    return client;
  }

  /**
   * Send a text message to a phone number.
   * Simulates human behavior: marks chat as seen, shows typing indicator, then sends.
   */
  async sendMessage(profileId, phoneNumber, text) {
    const session = this.sessions.get(profileId);
    if (!session || session.status !== 'connected') {
      throw new Error('WhatsApp no está conectado para este perfil');
    }

    const client = session.client;
    // Format number to WhatsApp JID
    const chatId = `${phoneNumber}@c.us`;

    try {
      // 1. Resolve WhatsApp contact ID
      let targetJid = chatId;
      try {
        const numberId = await client.getNumberId(chatId);
        if (numberId && numberId._serialized) {
          targetJid = numberId._serialized;
        }
      } catch (err) {
        console.warn(`[WA:${profileId}] getNumberId check warning:`, err.message);
      }

      // 2. Simulate human-like behavior
      try {
        const chat = await client.getChatById(targetJid);
        if (chat) {
          // Mark as seen (like opening the chat)
          await this._sleep(800 + Math.random() * 1200);
          await chat.sendSeen();

          // Show typing indicator
          await chat.sendStateTyping();

          // Wait a realistic typing duration based on message length
          const typingMs = Math.min(
            Math.max(text.length * 45, 2000),
            7000
          ) + Math.floor(Math.random() * 1000);
          await this._sleep(typingMs);

          // Clear typing state
          await chat.clearState();
        }
      } catch (simErr) {
        console.log(`[WA:${profileId}] Simulation notice:`, simErr.message);
      }

      // 3. Send the message
      await this._sleep(300 + Math.random() * 700);
      const result = await client.sendMessage(targetJid, text);
      console.log(`[WA:${profileId}] Message sent to ${phoneNumber}`);

      // Safely extract message ID (whatsapp-web.js may return undefined in newer WhatsApp Web versions)
      const messageId = (result && result.id)
        ? (typeof result.id === 'string' ? result.id : (result.id._serialized || result.id.id || 'sent'))
        : 'sent';

      return { success: true, messageId };

    } catch (err) {
      console.error(`[WA:${profileId}] Failed to send to ${phoneNumber}:`, err.message);
      throw err;
    }
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
   * Check if credentials exist on disk for this profile
   */
  hasSavedSession(profileId) {
    const fs = require('fs');
    const sessionDir = path.join(this.getSessionsPath(), 'session-' + profileId);
    return fs.existsSync(sessionDir);
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
      hasSavedSession: this.hasSavedSession(profileId)
    };
  }

  /**
   * Destroy a client instance and clean up resources
   */
  async destroyClient(profileId) {
    const session = this.sessions.get(profileId);
    if (!session) return;

    console.log(`[WA:${profileId}] Destroying client...`);
    try {
      if (session.client) {
        await session.client.destroy();
      }
    } catch (err) {
      console.error(`[WA:${profileId}] Error destroying client:`, err.message);
    }
    this.sessions.delete(profileId);
    this._emitStatus(profileId, 'disconnected');
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
