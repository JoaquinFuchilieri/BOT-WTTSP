const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const db = require('./database');
const WhatsAppManager = require('./whatsapp-manager');
const BotEngine = require('./bot-engine');

// ============ GLOBALS ============
let mainWindow = null;
const waManager = new WhatsAppManager();
const botEngine = new BotEngine(waManager);

// ============ WINDOW CREATION ============

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Bot WhatsApp',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Show window when ready (avoid white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Remove menu bar for cleaner look
  mainWindow.setMenuBarVisibility(false);
}

// ============ WHATSAPP MANAGER CALLBACKS ============

waManager.onQRCode = (profileId, qrDataUrl) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wa:qr', profileId, qrDataUrl);
  }
};

waManager.onStatusChange = (profileId, status) => {
  // Update status in database
  db.updateProfileStatus(profileId, status);
  // Notify renderer
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

// --- Profiles ---
ipcMain.handle('profiles:getAll', () => {
  return db.getAllProfiles();
});

ipcMain.handle('profiles:create', (_event, name) => {
  return db.createProfile(name);
});

ipcMain.handle('profiles:delete', async (_event, profileId) => {
  // Stop bot if running
  botEngine.stop(profileId);
  // Disconnect WhatsApp if connected
  await waManager.destroyClient(profileId);
  // Delete from database
  db.deleteProfile(profileId);
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

// --- Queue ---
ipcMain.handle('queue:import', (_event, profileId, numbers) => {
  const imported = db.importNumbers(profileId, numbers);
  return { imported };
});

ipcMain.handle('queue:count', (_event, profileId) => {
  return db.getQueueCount(profileId);
});

ipcMain.handle('queue:numbers', (_event, profileId) => {
  return db.getQueueNumbers(profileId);
});

ipcMain.handle('queue:clear', (_event, profileId) => {
  db.clearQueue(profileId);
});

ipcMain.handle('queue:retryErrors', (_event, profileId) => {
  return db.retryErrors(profileId);
});

ipcMain.handle('queue:clearErrors', (_event, profileId) => {
  return db.clearErrors(profileId);
});

// --- Messages ---
ipcMain.handle('message:save', (_event, profileId, text) => {
  db.saveMessage(profileId, text);
});

ipcMain.handle('message:get', (_event, profileId) => {
  return db.getMessage(profileId);
});

// --- Bot Control ---
ipcMain.handle('bot:start', (_event, profileId) => {
  botEngine.start(profileId);
});

ipcMain.handle('bot:stop', (_event, profileId) => {
  botEngine.stop(profileId);
});

ipcMain.handle('bot:isRunning', (_event, profileId) => {
  return botEngine.isRunning(profileId);
});

// --- Delay Settings ---
ipcMain.handle('settings:get', (_event, profileId) => {
  return db.getDelaySettings(profileId);
});

ipcMain.handle('settings:update', (_event, profileId, settings) => {
  db.updateDelaySettings(profileId, settings);
});

// ============ APP LIFECYCLE ============

app.whenReady().then(() => {
  db.initDatabase();
  db.resetAllStatuses();
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
  db.closeDatabase();
});

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});
