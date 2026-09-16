const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class AuthClient {
  constructor() {
    this.apiUrl = process.env.API_URL || 'http://localhost:3000';
    this.session = null;
    this.getStoredSession();
  }

  getStoredSession() {
    if (this.session) return this.session;
    try {
      const tokenFilePath = path.join(app.getPath('userData'), 'auth-session.json');
      if (fs.existsSync(tokenFilePath)) {
        const raw = fs.readFileSync(tokenFilePath, 'utf8');
        this.session = JSON.parse(raw);
        return this.session;
      }
    } catch (e) {
      console.warn('[AuthClient] Failed to read auth-session.json:', e.message);
    }
    return null;
  }

  saveSession(data) {
    this.session = data;
    try {
      const tokenFilePath = path.join(app.getPath('userData'), 'auth-session.json');
      fs.writeFileSync(tokenFilePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.warn('[AuthClient] Failed to save auth-session.json:', e.message);
    }
  }

  clearSession() {
    this.session = null;
    try {
      const tokenFilePath = path.join(app.getPath('userData'), 'auth-session.json');
      if (fs.existsSync(tokenFilePath)) fs.unlinkSync(tokenFilePath);
    } catch (e) {}
  }

  getAccessToken() {
    return this.session ? this.session.accessToken : null;
  }

  async login(email, password) {
    const res = await fetch(`${this.apiUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, clientType: 'desktop' })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login falló');
    }

    this.saveSession({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user
    });

    return data;
  }

  async refresh() {
    const session = this.getStoredSession();
    if (!session || !session.refreshToken) {
      throw new Error('No refresh token available');
    }

    const res = await fetch(`${this.apiUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });

    const data = await res.json();
    if (!res.ok) {
      // If 403, pass the reason (company_disabled or user_disabled)
      const err = new Error(data.error || 'Token refresh failed');
      err.status = res.status;
      err.reason = data.reason;
      throw err;
    }

    session.accessToken = data.accessToken;
    this.saveSession(session);
    return data.accessToken;
  }

  async checkAuth() {
    const session = this.getStoredSession();
    if (!session || !session.accessToken) {
      return null;
    }

    try {
      const res = await fetch(`${this.apiUrl}/auth/me`, {
        headers: { 'Authorization': `Bearer ${session.accessToken}` }
      });

      if (res.ok) {
        return session.user;
      }

      // Try refresh once
      await this.refresh();
      return session.user;
    } catch (err) {
      console.warn('[AuthClient] checkAuth error:', err.message);
      return null;
    }
  }
}

module.exports = AuthClient;
