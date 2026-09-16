class ApiSync {
  constructor(authClient) {
    this.authClient = authClient;
    this.apiUrl = authClient.apiUrl;
  }

  async request(endpoint, options = {}) {
    let token = this.authClient.getAccessToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };

    let response = await fetch(`${this.apiUrl}${endpoint}`, {
      ...options,
      headers
    });

    // If unauthorized, attempt one refresh
    if (response.status === 401) {
      try {
        token = await this.authClient.refresh();
        headers['Authorization'] = `Bearer ${token}`;
        response = await fetch(`${this.apiUrl}${endpoint}`, {
          ...options,
          headers
        });
      } catch (refreshErr) {
        console.error('[ApiSync] Failed to refresh token during request:', refreshErr);
      }
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP error ${response.status}`);
      error.status = response.status;
      error.reason = data.reason;
      throw error;
    }

    return data;
  }

  // --- Users ---
  async getUsers() {
    return this.request('/users');
  }

  // --- Profiles ---
  async getAllProfiles(assignedUserId = null) {
    const query = assignedUserId ? `?assigned_user_id=${assignedUserId}` : '';
    return this.request(`/profiles${query}`);
  }

  async getProfile(id) {
    return this.request(`/profiles/${id}`);
  }

  async createProfile(name, assigned_user_id = null) {
    return this.request('/profiles', {
      method: 'POST',
      body: JSON.stringify({ name, assigned_user_id })
    });
  }

  async deleteProfile(id) {
    return this.request(`/profiles/${id}`, { method: 'DELETE' });
  }

  async updateProfileStatus(id, status) {
    return this.request(`/profiles/${id}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }

  async saveMessage(id, message) {
    return this.request(`/profiles/${id}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ message })
    });
  }

  async getMessage(id) {
    const profile = await this.getProfile(id);
    return profile ? profile.message : '';
  }

  async getDelaySettings(id) {
    const p = await this.getProfile(id);
    if (!p) return {};
    return {
      delay_min: p.delay_min,
      delay_max: p.delay_max,
      batch_size: p.batch_size,
      batch_pause_min: p.batch_pause_min,
      batch_pause_max: p.batch_pause_max,
      daily_limit: p.daily_limit,
      work_schedule_enabled: p.work_schedule_enabled,
      work_schedule_start: p.work_schedule_start || '09:00',
      work_schedule_end: p.work_schedule_end || '18:00',
      work_schedule_days: p.work_schedule_days || '1,2,3,4,5',
      warmup_enabled: p.warmup_enabled,
      warmup_day: p.warmup_day || 1,
      warmup_daily_increment: p.warmup_daily_increment || 15,
      warmup_max_limit: p.warmup_max_limit || 200,
      is_paused_early_warning: p.is_paused_early_warning,
      early_warning_reason: p.early_warning_reason
    };
  }

  async updateDelaySettings(id, settings) {
    return this.request(`/profiles/${id}/config`, {
      method: 'PATCH',
      body: JSON.stringify(settings)
    });
  }

  // --- Announcements & Early Warning ---
  async getActiveAnnouncements() {
    return this.request('/announcements/active');
  }

  async resumeEarlyWarning(profileId) {
    return this.request(`/profiles/${profileId}/early-warning/resume`, { method: 'POST' });
  }

  // --- Help Manual ---
  async getHelpManual() {
    return this.request('/help?target=desktop', {
      headers: { 'X-Client': 'desktop' }
    });
  }

  // --- Queue ---
  async importNumbers(profileId, numbers) {
    return this.request(`/profiles/${profileId}/queue/import`, {
      method: 'POST',
      body: JSON.stringify({ numbers })
    });
  }

  async getNextPendingNumber(profileId) {
    const res = await this.request(`/profiles/${profileId}/queue/next`);
    return res.item || null;
  }

  async peekNextPendingNumber(profileId) {
    try {
      const res = await this.request(`/profiles/${profileId}/queue/peek`);
      return res.item || null;
    } catch (e) {
      return null;
    }
  }

  async markNumberAsSent(profileId, queueId, phoneNumber) {
    return this.request(`/profiles/${profileId}/queue/${queueId}/sent`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber })
    });
  }

  async markNumberAsError(profileId, queueId, phoneNumber, errorMessage = '') {
    return this.request(`/profiles/${profileId}/queue/${queueId}/error`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, errorMessage })
    });
  }

  async getQueueCount(profileId) {
    const stats = await this.request(`/stats/profiles/${profileId}`);
    return {
      pending: stats.pending,
      sent: stats.sentToday,
      error: stats.error
    };
  }

  async getQueueNumbers(profileId) {
    return this.request(`/profiles/${profileId}/queue`);
  }

  async clearQueue(profileId) {
    return this.request(`/profiles/${profileId}/queue`, { method: 'DELETE' });
  }

  async retryErrors(profileId) {
    const res = await this.request(`/profiles/${profileId}/queue/retry-errors`, { method: 'POST' });
    return res.retried;
  }

  async clearErrors(profileId) {
    return this.request(`/profiles/${profileId}/queue?status=error`, { method: 'DELETE' });
  }

  async resetSendingQueue(profileId) {
    return this.request(`/profiles/${profileId}/queue/reset-sending`, { method: 'POST' });
  }

  // --- Stats / Heartbeat ---
  async pushProgress(profileId, data) {
    return this.request('/stats/progress', {
      method: 'POST',
      body: JSON.stringify({
        profileId,
        status: data.status,
        sentToday: data.sentToday
      })
    });
  }
}

module.exports = ApiSync;
