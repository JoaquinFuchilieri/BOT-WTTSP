// ============ ANTI-DEBUGGING & SECURITY SHIELD ============
const suspiciousArgs = ['--inspect', '--inspect-brk', '--remote-debugging-port', '--remote-debugging-targets', '--enable-logging'];
for (const arg of process.argv) {
  for (const sus of suspiciousArgs) {
    if (arg.toLowerCase().includes(sus)) {
      console.error('[Security Violation] Unauthorized debugging flag detected:', arg);
      app.exit(1);
    }
  }
}
delete process.env.NODE_OPTIONS;

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const WhatsAppManager = require('./whatsapp-manager');
const BotEngine = require('./bot-engine');
const AuthClient = require('./auth-client');
const ApiSync = require('./api-sync');
const ConnectivityManager = require('./connectivity');

// ============ INSTANCES ============
let mainWindow = null;
const waManager = new WhatsAppManager();
const authClient = new AuthClient();
const apiSync = new ApiSync(authClient);
const connectivity = new ConnectivityManager(authClient);
const botEngine = new BotEngine(waManager, apiSync);

// ============ WINDOW CREATION ============

async function createWindow() {
  const appRoot = app.getAppPath();
  const preloadPath = fs.existsSync(path.join(appRoot, 'dist', 'preload', 'index.js'))
    ? path.join(appRoot, 'dist', 'preload', 'index.js')
    : path.join(appRoot, 'src', 'preload', 'index.js');
  const rendererDir = fs.existsSync(path.join(appRoot, 'dist', 'renderer', 'index.html'))
    ? path.join(appRoot, 'dist', 'renderer')
    : path.join(appRoot, 'src', 'renderer');
  const iconPath = path.join(rendererDir, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'F-Dispatch',
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false
    }
  });

  // Strict anti-DevTools: close immediately if opened
  mainWindow.webContents.on('devtools-opened', () => {
    mainWindow.webContents.closeDevTools();
  });

  // Block DevTools shortcuts and source inspection (F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+R, F5)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toUpperCase();
    if (key === 'F12' || key === 'F5') {
      event.preventDefault();
      return;
    }
    if (input.control || input.meta) {
      if (key === 'U' || key === 'R') {
        event.preventDefault();
        return;
      }
      if (input.shift && (key === 'I' || key === 'J' || key === 'C')) {
        event.preventDefault();
        return;
      }
    }
  });

  // Lock navigation to local files only
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  // Verify authentication before deciding which page to load
  const user = await authClient.checkAuth();
  if (user) {
    console.log('[Main] Authenticated session found for:', user.email);
    connectivity.start();
    mainWindow.loadFile(path.join(rendererDir, 'index.html'));
  } else {
    console.log('[Main] No active session. Redirecting to login.html');
    mainWindow.loadFile(path.join(rendererDir, 'login.html'));
  }

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    console.log(`[Renderer] ${message}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.setMenuBarVisibility(false);

  // Open external links (mailto, http, https) in native OS apps/browsers
  const { shell } = require('electron');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Native desktop context menu for input/textarea fields (Cut, Copy, Paste, Undo, Select All)
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'undo', label: 'Deshacer' }));
      menu.append(new MenuItem({ role: 'redo', label: 'Rehacer' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'cut', label: 'Cortar' }));
      menu.append(new MenuItem({ role: 'copy', label: 'Copiar' }));
      menu.append(new MenuItem({ role: 'paste', label: 'Pegar' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ role: 'selectAll', label: 'Seleccionar todo' }));
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ role: 'copy', label: 'Copiar' }));
      menu.append(new MenuItem({ role: 'selectAll', label: 'Seleccionar todo' }));
    } else {
      return;
    }
    menu.popup({ window: mainWindow, x: params.x, y: params.y });
  });

  // Guard against window crashes and unhandled renderer exits
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[Main] Render process gone:', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Main] Window unresponsive, allowing recovery...');
  });
}

// ============ CONNECTIVITY & KILL SWITCH CALLBACKS ============

connectivity.onKill = (reason) => {
  console.warn('[Main] Kill switch activated. Reason:', reason);
  botEngine.stopAll();
  waManager.destroyAll();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:kill', reason);
  }
};

connectivity.onConnectionLost = () => {
  console.warn('[Main] Internet connection lost over 5 minutes. Pausing bots...');
  botEngine.stopAll();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connectivity:lost');
  }
};

connectivity.onConnectionRestored = () => {
  console.log('[Main] Internet connection restored.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connectivity:restored');
  }
};

// ============ WHATSAPP MANAGER CALLBACKS ============

waManager.onQRCode = (profileId, qrDataUrl) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wa:qr', profileId, qrDataUrl);
  }
};

waManager.onStatusChange = async (profileId, status) => {
  try {
    await apiSync.updateProfileStatus(profileId, status);
  } catch (err) {
    console.error(`[Main] Error updating status in API for ${profileId}:`, err.message);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wa:status', profileId, status);
  }
};

waManager.onError = (profileId, error) => {
  console.error(`[Main] WA Error for ${profileId}: ${error}`);
};

// ============ BOT ENGINE CALLBACKS ============

botEngine.onProgress = (profileId, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bot:progress', profileId, data);
  }
};

// ============ IPC HANDLERS ============

// --- Auth ---
ipcMain.handle('shell:openExternal', async (_event, url) => {
  const { shell } = require('electron');
  return shell.openExternal(url);
});

ipcMain.handle('auth:login', async (_event, email, password) => {
  const result = await authClient.login(email, password);
  connectivity.start();
  return result;
});

ipcMain.handle('auth:logout', async () => {
  botEngine.stopAll();
  await waManager.destroyAll();
  connectivity.stop();
  authClient.clearSession();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'login.html'));
  }
});

ipcMain.handle('auth:getSession', () => {
  return authClient.getStoredSession();
});

// --- Users ---
ipcMain.handle('users:getAll', async () => {
  return apiSync.getUsers();
});

// --- Profiles (Synchronized with SaaS Backend) ---
ipcMain.handle('profiles:getAll', async (_event, assignedUserId = null) => {
  return apiSync.getAllProfiles(assignedUserId);
});

ipcMain.handle('profiles:create', async (_event, name, assignedUserId = null) => {
  return apiSync.createProfile(name, assignedUserId);
});

ipcMain.handle('profiles:delete', async (_event, profileId) => {
  botEngine.stop(profileId);
  await waManager.destroyClient(profileId);
  return apiSync.deleteProfile(profileId);
});

// --- WhatsApp ---
ipcMain.handle('wa:connect', async (_event, profileId) => {
  try {
    await waManager.initClient(profileId);
  } catch (err) {
    console.error(`[Main] Failed to connect WA for ${profileId}:`, err);
    throw err;
  }
});

ipcMain.handle('wa:disconnect', async (_event, profileId) => {
  botEngine.stop(profileId);
  await waManager.destroyClient(profileId);
});

ipcMain.handle('wa:getSessionState', (_event, profileId) => {
  return waManager.getSessionState(profileId);
});

ipcMain.handle('wa:unlink', async (_event, profileId) => {
  botEngine.stop(profileId);
  const result = await waManager.unlinkSession(profileId);
  try {
    await apiSync.updateProfileStatus(profileId, 'disconnected');
  } catch (e) {}
  return result;
});

// --- Queue ---
ipcMain.handle('queue:import', async (_event, profileId, numbers) => {
  return apiSync.importNumbers(profileId, numbers);
});

ipcMain.handle('queue:count', async (_event, profileId) => {
  return apiSync.getQueueCount(profileId);
});

ipcMain.handle('queue:numbers', async (_event, profileId) => {
  return apiSync.getQueueNumbers(profileId);
});

ipcMain.handle('queue:clear', async (_event, profileId) => {
  return apiSync.clearQueue(profileId);
});

ipcMain.handle('queue:retryErrors', async (_event, profileId) => {
  return apiSync.retryErrors(profileId);
});

ipcMain.handle('queue:clearErrors', async (_event, profileId) => {
  return apiSync.clearErrors(profileId);
});

// --- File Parsing (PDF & TXT) ---
ipcMain.handle('file:parsePdf', async (_event, arrayBuffer) => {
  try {
    const buffer = Buffer.from(arrayBuffer);
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    console.error('[Main] Error parsing PDF:', err);
    throw new Error('No se pudo procesar el archivo PDF: ' + err.message);
  }
});

// --- Messages ---
ipcMain.handle('message:save', async (_event, profileId, text) => {
  return apiSync.saveMessage(profileId, text);
});

ipcMain.handle('message:get', async (_event, profileId) => {
  return apiSync.getMessage(profileId);
});

// --- Bot Control ---
ipcMain.handle('bot:start', async (_event, profileId) => {
  await botEngine.start(profileId);
});

ipcMain.handle('bot:stop', (_event, profileId) => {
  botEngine.stop(profileId);
});

ipcMain.handle('bot:isRunning', (_event, profileId) => {
  return botEngine.isRunning(profileId);
});

ipcMain.handle('bot:getAllStates', () => {
  return botEngine.getAllStates();
});

ipcMain.handle('bot:startAll', async (_event, profileIds) => {
  if (Array.isArray(profileIds)) {
    for (const id of profileIds) {
      botEngine.start(id).catch(err => {
        console.error(`[Main] Auto-start bot for ${id} error:`, err.message);
      });
    }
  }
});

ipcMain.handle('bot:stopAll', () => {
  botEngine.stopAll();
});

// --- Delay Settings ---
ipcMain.handle('settings:get', async (_event, profileId) => {
  return apiSync.getDelaySettings(profileId);
});

ipcMain.handle('settings:update', async (_event, profileId, settings) => {
  return apiSync.updateDelaySettings(profileId, settings);
});

// --- System Announcements & Early Warning Control ---
ipcMain.handle('announcements:getActive', async () => {
  try {
    return await apiSync.getActiveAnnouncements();
  } catch (err) {
    console.warn('[Main] Failed to get active announcements:', err.message);
    return [];
  }
});

ipcMain.handle('bot:resumeEarlyWarning', async (_event, profileId) => {
  return apiSync.resumeEarlyWarning(profileId);
});

function filterManualForDesktop(md) {
  if (!md) return '';
  let res = md;
  // 1. Clean intro sentence mentioning Panel Web
  res = res.replace(/tanto\s+en\s+el\s+\*?\*?Programa\s+de\s+Escritorio\*?\*?\s+como\s+en\s+el\s+\*?\*?Panel\s+Web\*?\*?\./gi, 'en el **Programa de Escritorio**.');
  res = res.replace(/\s*como\s+en\s+el\s+\*?\*?Panel\s+Web\*?\*?\./gi, '.');
  // 2. Remove Section 3 (Panel Web) and sub-items from Table of Contents
  res = res.replace(/^\s*3\.\s*\[.*?(?:web|panel|saas).*?\].*?\n(?:\s+-\s*3\.\d+.*?\n)*/gim, '');
  // 3. Renumber Section 4 in Table of Contents to Section 3
  res = res.replace(/^\s*4\.\s*\[(.*?)\]\((#.*?)\)/gim, (match, title, anchor) => {
    const cleanTitle = title.replace(/^4\.\s*/, '3. ');
    const cleanAnchor = anchor.replace(/#4-/, '#3-');
    return `3. [${cleanTitle}](${cleanAnchor})`;
  });
  // 4. Remove Section 3 body
  res = res.replace(/(?:---\s*\n+)?##\s*3\.\s*.*?(?:panel|web|saas)[\s\S]*?(?=(?:---\s*\n+)?##\s*4\.)/gi, '');
  res = res.replace(/(?:---\s*\n+)?##\s*3\.\s*.*?(?:panel|web|saas)[\s\S]*?(?=(?:---\s*\n+)?##\s*\d+|$)/gi, '');
  // 5. Renumber Section 4 heading to Section 3
  res = res.replace(/##\s*4\.\s*/g, '## 3. ');
  // 6. Clean duplicate separators
  res = res.replace(/---\s*\n\s*---\s*\n/g, '---\n');
  return res.trim();
}

// --- Help Manual ---
ipcMain.handle('help:getManual', async () => {
  try {
    const res = await apiSync.getHelpManual();
    if (res && res.content) {
      res.content = filterManualForDesktop(res.content);
    }
    return res;
  } catch (err) {
    console.warn('[Main] Failed to get help manual from server:', err.message);
    return {
      title: 'Manual de Uso e Interacción — F-Dispatch',
      content: '# Manual de Uso e Interacción — F-Dispatch\n\nNo se pudo obtener la versión en línea del manual. Verifique su conexión al servidor.'
    };
  }
});

// ============ APP LIFECYCLE ============

app.whenReady().then(() => {
  waManager.cleanAllOrphanProcesses();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  console.log('[Main] Shutting down...');
  botEngine.stopAll();
  await waManager.destroyAll();
  connectivity.stop();
});

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
});

// ============ LOCAL DEBUG SERVER (127.0.0.1:3001) ============
const http = require('http');
const debugServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3001');
  res.setHeader('Content-Type', 'application/json');

  try {
    if (url.pathname.startsWith('/debug/dismiss/')) {
      const profileId = url.pathname.split('/')[3];
      const session = waManager.sessions.get(profileId);
      if (!session || !session.client || !session.client.pupPage) {
        return res.end(JSON.stringify({ error: 'No pupPage' }));
      }
      const clicked = await session.client.pupPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('div[role="dialog"] button, div[role="dialog"] div[role="button"]'));
        for (const btn of buttons) {
          const text = (btn.innerText || '').toLowerCase().trim();
          if (text.includes('continuar') || text.includes('entendido') || text.includes('ok') || text.includes('cerrar') || text.includes('close')) {
            btn.click();
            return `Clicked: ${text}`;
          }
        }
        const closeX = document.querySelector('div[role="dialog"] span[data-icon="x"], div[role="dialog"] button[aria-label="Cerrar"], div[role="dialog"] button[aria-label="Close"]');
        if (closeX) {
          (closeX.closest('button') || closeX).click();
          return 'Clicked close X';
        }
        return 'No modal button found';
      });
      return res.end(JSON.stringify({ success: true, clicked }));
    }

    if (url.pathname.startsWith('/debug/connect/')) {
      const profileId = url.pathname.split('/')[3];
      console.log(`[Debug] Initializing WhatsApp client for profile: ${profileId}`);
      waManager.initClient(profileId).catch(err => {
        console.error(`[Debug] Init error for ${profileId}:`, err.message);
      });
      return res.end(JSON.stringify({ success: true, message: 'Initialization started' }));
    }

    if (url.pathname === '/debug/sessions') {
      const list = Array.from(waManager.sessions.entries()).map(([id, s]) => ({
        id,
        status: s.status,
        hasClient: !!s.client,
        hasPupPage: !!(s.client && s.client.pupPage)
      }));
      return res.end(JSON.stringify(list, null, 2));
    }

    if (url.pathname === '/debug/eval-window') {
      const code = url.searchParams.get('code');
      if (mainWindow && !mainWindow.isDestroyed() && code) {
        try {
          const resEval = await mainWindow.webContents.executeJavaScript(code);
          return res.end(JSON.stringify({ success: true, result: resEval }));
        } catch (e) {
          return res.end(JSON.stringify({ error: e.message }));
        }
      }
      return res.end(JSON.stringify({ error: 'No main window or code' }));
    }

    if (url.pathname === '/debug/window-shot') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const img = await mainWindow.webContents.capturePage();
        const savePath = path.join(__dirname, '../../scratch/window-shot.png');
        const fs = require('fs');
        fs.writeFileSync(savePath, img.toPNG());
        return res.end(JSON.stringify({ success: true, path: savePath }));
      }
      return res.end(JSON.stringify({ error: 'No main window' }));
    }

    if (url.pathname.startsWith('/debug/screenshot/')) {
      const profileId = url.pathname.split('/')[3];
      const session = waManager.sessions.get(profileId);
      if (!session || !session.client || !session.client.pupPage) {
        return res.end(JSON.stringify({ error: 'No active pupPage for this profile' }));
      }
      const shotPath = path.join(__dirname, `../../scratch/shot-${profileId}.png`);
      await session.client.pupPage.screenshot({ path: shotPath });
      return res.end(JSON.stringify({ success: true, path: shotPath }));
    }

    if (url.pathname.startsWith('/debug/eval/')) {
      const profileId = url.pathname.split('/')[3];
      const session = waManager.sessions.get(profileId);
      if (!session || !session.client || !session.client.pupPage) {
        return res.end(JSON.stringify({ error: 'No active pupPage' }));
      }
      const pageInfo = await session.client.pupPage.evaluate(() => {
        return {
          title: document.title,
          url: window.location.href,
          hasWWebJS: !!window.WWebJS,
          hasStore: !!window.Store,
          bodySnippet: document.body ? document.body.innerText.slice(0, 500) : ''
        };
      });
      return res.end(JSON.stringify({ status: session.status, pageInfo }, null, 2));
    }

    if (url.pathname.startsWith('/debug/test-send/')) {
      const profileId = url.pathname.split('/')[3];
      const phone = url.searchParams.get('phone');
      const text = url.searchParams.get('text') || 'Test message';
      const result = await waManager.sendMessage(profileId, phone, text);
      return res.end(JSON.stringify({ success: true, result }, null, 2));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: err.message, stack: err.stack }));
  }
});

debugServer.listen(3001, '127.0.0.1', () => {
  console.log('[Main] Debug server listening on http://127.0.0.1:3001');
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});
