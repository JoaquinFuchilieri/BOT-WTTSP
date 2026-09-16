class ConnectivityManager {
  constructor(authClient) {
    this.authClient = authClient;
    this.apiUrl = authClient.apiUrl;
    this.isOnline = true;
    this.offlineSince = null;
    this.gracePeriodMs = 5 * 60 * 1000; // 5 minutes grace period
    this.pingInterval = null;
    this.refreshInterval = null;

    // Callbacks
    this.onKill = null; // (reason) => {}
    this.onConnectionLost = null; // () => {}
    this.onConnectionRestored = null; // () => {}
  }

  start() {
    this.stop();

    // 1. Refresh loop every 20 minutes (Kill switch & token renewal)
    this.refreshInterval = setInterval(async () => {
      try {
        console.log('[Connectivity] Refreshing access token...');
        await this.authClient.refresh();
      } catch (err) {
        console.error('[Connectivity] Token refresh error:', err.message, err.status, err.reason);
        if (err.status === 403) {
          // Kill switch triggered by SaaS Admin!
          console.warn('[Connectivity] KILL SWITCH ACTIVATED:', err.reason);
          this.authClient.clearSession();
          if (this.onKill) {
            this.onKill(err.reason || 'account_suspended');
          }
        }
      }
    }, 20 * 60 * 1000);

    // 2. Ping check every 30 seconds
    this.pingInterval = setInterval(async () => {
      await this.checkPing();
    }, 30 * 1000);
  }

  stop() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  async checkPing() {
    try {
      const res = await fetch(`${this.apiUrl}/health`, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        if (!this.isOnline) {
          console.log('[Connectivity] Connection restored!');
          this.isOnline = true;
          this.offlineSince = null;
          if (this.onConnectionRestored) this.onConnectionRestored();
        }
        return true;
      }
      throw new Error('Ping status not ok');
    } catch (err) {
      if (this.isOnline) {
        if (!this.offlineSince) {
          this.offlineSince = Date.now();
          console.warn('[Connectivity] Ping failed. Grace period started (5 minutes)...');
        } else if (Date.now() - this.offlineSince > this.gracePeriodMs) {
          console.warn('[Connectivity] Grace period expired without internet. Pausing bot...');
          this.isOnline = false;
          if (this.onConnectionLost) this.onConnectionLost();
        }
      }
      return false;
    }
  }
}

module.exports = ConnectivityManager;
