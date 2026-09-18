const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const baileysManager = require('../services/baileys-manager');
const botEngine = require('../services/server-bot-engine');

let wss = null;
// Active authenticated client connections: Set<{ ws, userId, role, companyId }>
const clients = new Set();

function initWebSocketServer(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let clientData = {
      ws,
      userId: null,
      role: null,
      companyId: null,
      isAuthenticated: false
    };

    clients.add(clientData);

    // Parse token from query string if present: /ws?token=xyz
    const url = new URL(req.url, 'http://localhost');
    const tokenParam = url.searchParams.get('token');
    if (tokenParam) {
      authenticateClient(clientData, tokenParam);
    }

    ws.on('message', async (messageRaw) => {
      try {
        const msg = JSON.parse(messageRaw.toString());

        if (msg.type === 'auth') {
          authenticateClient(clientData, msg.token);
          return;
        }

        if (!clientData.isAuthenticated) {
          ws.send(JSON.stringify({ type: 'error', message: 'No autenticado' }));
          return;
        }

        // Handle client commands
        if (msg.type === 'wa:connect') {
          const { profileId } = msg;
          if (!profileId) return;
          console.log(`[WebSocket] Client ${clientData.userId} requested WhatsApp connect for ${profileId}`);
          try {
            await baileysManager.initSession(profileId);
          } catch (err) {
            ws.send(JSON.stringify({ type: 'wa:error', profileId, error: err.message }));
          }
        } else if (msg.type === 'wa:disconnect') {
          const { profileId } = msg;
          if (!profileId) return;
          console.log(`[WebSocket] Client ${clientData.userId} requested WhatsApp disconnect for ${profileId}`);
          await baileysManager.disconnectSession(profileId);
        } else if (msg.type === 'wa:unlink') {
          const { profileId } = msg;
          if (!profileId) return;
          console.log(`[WebSocket] Client ${clientData.userId} requested WhatsApp unlink for ${profileId}`);
          await baileysManager.unlinkSession(profileId);
        } else if (msg.type === 'bot:start') {
          const { profileId } = msg;
          if (!profileId) return;
          await botEngine.startBot(profileId);
        } else if (msg.type === 'bot:stop') {
          const { profileId } = msg;
          if (!profileId) return;
          await botEngine.stopBot(profileId);
        }
      } catch (err) {
        console.error('[WebSocket] Message handling error:', err);
      }
    });

    ws.on('close', () => {
      clients.delete(clientData);
    });

    ws.on('error', (err) => {
      console.warn('[WebSocket] Client error:', err.message);
      clients.delete(clientData);
    });
  });

  // Hook into BaileysManager events to broadcast in real time
  baileysManager.onQR((profileId, qrDataUrl) => {
    broadcast({
      type: 'wa:qr',
      profileId,
      qr: qrDataUrl
    });
  });

  baileysManager.onStatus((profileId, status, details) => {
    broadcast({
      type: 'wa:status',
      profileId,
      status,
      details
    });
  });

  // Hook into BotEngine progress
  botEngine.onProgress((profileId, data) => {
    broadcast({
      type: 'bot:progress',
      profileId,
      ...data
    });
  });

  console.log('[WebSocket] WebSocket server initialized on path /ws');
}

function authenticateClient(clientData, token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fdispatch-secret-key-2026');
    clientData.userId = decoded.userId || decoded.id;
    clientData.role = decoded.role;
    clientData.companyId = decoded.companyId;
    clientData.isAuthenticated = true;

    clientData.ws.send(JSON.stringify({
      type: 'auth:success',
      userId: clientData.userId,
      role: clientData.role
    }));
  } catch (err) {
    clientData.ws.send(JSON.stringify({ type: 'auth:error', message: 'Token inválido' }));
  }
}

function broadcast(payload, filterFn = null) {
  const messageStr = JSON.stringify(payload);
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN && client.isAuthenticated) {
      if (!filterFn || filterFn(client)) {
        client.ws.send(messageStr);
      }
    }
  }
}

module.exports = {
  initWebSocketServer,
  broadcast
};
