const { contextBridge, ipcRenderer } = require('electron');

// Store handler references for cleanup (module-scope, not on contextBridge)
let _qrHandler = null;
let _statusHandler = null;
let _progressHandler = null;

contextBridge.exposeInMainWorld('api', {
  // ============ PROFILES ============
  getProfiles: () => ipcRenderer.invoke('profiles:getAll'),
  createProfile: (name) => ipcRenderer.invoke('profiles:create', name),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),

  // ============ WHATSAPP ============
  connectWhatsApp: (profileId) => ipcRenderer.invoke('wa:connect', profileId),
  disconnectWhatsApp: (profileId) => ipcRenderer.invoke('wa:disconnect', profileId),
  getWhatsAppSessionState: (profileId) => ipcRenderer.invoke('wa:getSessionState', profileId),

  // ============ QUEUE ============
  importNumbers: (profileId, numbers) => ipcRenderer.invoke('queue:import', profileId, numbers),
  getQueueCount: (profileId) => ipcRenderer.invoke('queue:count', profileId),
  getQueueNumbers: (profileId) => ipcRenderer.invoke('queue:numbers', profileId),
  clearQueue: (profileId) => ipcRenderer.invoke('queue:clear', profileId),
  retryErrors: (profileId) => ipcRenderer.invoke('queue:retryErrors', profileId),
  clearErrors: (profileId) => ipcRenderer.invoke('queue:clearErrors', profileId),

  // ============ MESSAGES ============
  saveMessage: (profileId, text) => ipcRenderer.invoke('message:save', profileId, text),
  getMessage: (profileId) => ipcRenderer.invoke('message:get', profileId),

  // ============ BOT CONTROL ============
  startBot: (profileId) => ipcRenderer.invoke('bot:start', profileId),
  stopBot: (profileId) => ipcRenderer.invoke('bot:stop', profileId),
  isBotRunning: (profileId) => ipcRenderer.invoke('bot:isRunning', profileId),

  // ============ DELAY SETTINGS ============
  getDelaySettings: (profileId) => ipcRenderer.invoke('settings:get', profileId),
  updateDelaySettings: (profileId, settings) => ipcRenderer.invoke('settings:update', profileId, settings),

  // ============ EVENT LISTENERS (Main → Renderer) ============
  onQRCode: (callback) => {
    // Remove previous listener if exists
    if (_qrHandler) ipcRenderer.removeListener('wa:qr', _qrHandler);
    _qrHandler = (_event, profileId, qrDataUrl) => callback(profileId, qrDataUrl);
    ipcRenderer.on('wa:qr', _qrHandler);
  },
  removeQRCodeListener: () => {
    if (_qrHandler) {
      ipcRenderer.removeListener('wa:qr', _qrHandler);
      _qrHandler = null;
    }
  },

  onStatusChange: (callback) => {
    if (_statusHandler) ipcRenderer.removeListener('wa:status', _statusHandler);
    _statusHandler = (_event, profileId, status) => callback(profileId, status);
    ipcRenderer.on('wa:status', _statusHandler);
  },
  removeStatusChangeListener: () => {
    if (_statusHandler) {
      ipcRenderer.removeListener('wa:status', _statusHandler);
      _statusHandler = null;
    }
  },

  onBotProgress: (callback) => {
    if (_progressHandler) ipcRenderer.removeListener('bot:progress', _progressHandler);
    _progressHandler = (_event, profileId, data) => callback(profileId, data);
    ipcRenderer.on('bot:progress', _progressHandler);
  },
  removeBotProgressListener: () => {
    if (_progressHandler) {
      ipcRenderer.removeListener('bot:progress', _progressHandler);
      _progressHandler = null;
    }
  }
});
