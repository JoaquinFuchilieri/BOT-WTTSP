const db = require('./database');

class BotEngine {
  constructor(whatsAppManager) {
    this.waManager = whatsAppManager;
    // Map<profileId, { running, abortController, batchCount }>
    this.activeBots = new Map();
    // Callback to emit progress to the renderer
    this.onProgress = null; // (profileId, data) => void
  }

  /**
   * Start the sending loop for a profile.
   * The loop runs asynchronously and can be stopped via stop().
   */
  start(profileId) {
    if (this.activeBots.has(profileId) && this.activeBots.get(profileId).running) {
      console.log(`[Bot:${profileId}] Already running`);
      return;
    }

    // Verify WhatsApp is connected or has saved session
    if (!this.waManager.isConnected(profileId)) {
      if (!this.waManager.hasSavedSession(profileId)) {
        this._emitProgress(profileId, {
          status: 'error',
          nextAction: 'WhatsApp no está vinculado. Haz clic en "Conectar WhatsApp" y escanea el código QR primero.'
        });
        return;
      }
    }

    // Get the message configured for this profile
    const message = db.getMessage(profileId);
    if (!message || message.trim() === '') {
      this._emitProgress(profileId, {
        status: 'error',
        nextAction: 'No hay mensaje configurado. Guardá un mensaje primero.'
      });
      return;
    }

    const botState = {
      running: true,
      batchCount: 0
    };
    this.activeBots.set(profileId, botState);

    console.log(`[Bot:${profileId}] Starting send loop...`);
    this._emitProgress(profileId, {
      status: 'running',
      nextAction: 'Iniciando...'
    });

    // Start the async loop (non-blocking)
    this._runLoop(profileId, message).catch(err => {
      console.error(`[Bot:${profileId}] Loop crashed:`, err);
      this._emitProgress(profileId, {
        status: 'error',
        nextAction: `Error fatal: ${err.message}`
      });
      this.stop(profileId);
    });
  }

  /**
   * Stop the sending loop for a profile.
   */
  stop(profileId, reason = 'Bot detenido por el usuario') {
    const botState = this.activeBots.get(profileId);
    if (botState) {
      botState.running = false;
      this.activeBots.delete(profileId);
      console.log(`[Bot:${profileId}] Stopped: ${reason}`);
      this._emitProgress(profileId, {
        status: 'stopped',
        currentNumber: '-',
        nextAction: reason
      });
    }
  }

  /**
   * Check if a bot is currently running for a profile.
   */
  isRunning(profileId) {
    const botState = this.activeBots.get(profileId);
    return botState ? botState.running : false;
  }

  /**
   * Stop all active bots (called on app quit).
   */
  stopAll() {
    for (const profileId of this.activeBots.keys()) {
      this.stop(profileId);
    }
  }

  // ============ PRIVATE: MAIN SEND LOOP ============

  async _runLoop(profileId, message) {
    const botState = this.activeBots.get(profileId);
    if (!botState) return;

    // Auto-connect if not currently in memory but saved on disk
    if (!this.waManager.isConnected(profileId) && this.waManager.hasSavedSession(profileId)) {
      console.log(`[Bot:${profileId}] Auto-connecting saved WhatsApp session...`);
      this._emitProgress(profileId, {
        status: 'running',
        nextAction: 'Reanudando WhatsApp con tu sesión guardada... aguarda unos segundos ⏳'
      });
      try {
        await this.waManager.initClient(profileId);
        let waited = 0;
        while (waited < 35000 && !this.waManager.isConnected(profileId) && botState.running) {
          await new Promise(r => setTimeout(r, 1000));
          waited += 1000;
        }
        if (!this.waManager.isConnected(profileId)) {
          this.stop(profileId, 'No se pudo conectar WhatsApp automáticamente. Haz clic en Conectar.');
          return;
        }
      } catch (err) {
        this.stop(profileId, `Error al conectar WhatsApp: ${err.message}`);
        return;
      }
    }

    while (botState.running) {
      // --- CHECK 1: Is WhatsApp still connected? ---
      if (!this.waManager.isConnected(profileId)) {
        this.stop(profileId, 'WhatsApp se desconectó. Reconectá la sesión.');
        return;
      }

      // --- CHECK 2: Daily limit ---
      const settings = db.getDelaySettings(profileId);
      const sentToday = db.getSentToday(profileId);

      if (sentToday >= settings.daily_limit) {
        this._emitProgress(profileId, {
          status: 'paused',
          sent: sentToday,
          nextAction: `Límite diario alcanzado (${settings.daily_limit}). Se reanudará mañana.`
        });
        // Wait 30 minutes and check again (date might change)
        await this._interruptibleSleep(profileId, 30 * 60 * 1000);
        continue;
      }

      // --- CHECK 3: Operating hours (if enforced by user) ---
      if (settings.enforce_hours) {
        const currentHour = new Date().getHours();
        const startHour = settings.start_hour ?? 9;
        const endHour = settings.end_hour ?? 20;
        if (currentHour < startHour || currentHour >= endHour) {
          this._emitProgress(profileId, {
            status: 'paused',
            sent: sentToday,
            nextAction: `Fuera de horario laboral (${startHour}:00 - ${endHour}:00). Esperando...`
          });
          // Wait 15 minutes and check again
          await this._interruptibleSleep(profileId, 15 * 60 * 1000);
          continue;
        }
      }

      // --- CHECK 4: Get next number from queue ---
      const next = db.getNextPendingNumber(profileId);
      if (!next) {
        this.stop(profileId, 'Cola vacía. Todos los mensajes fueron enviados ✅');
        return;
      }

      // --- SEND MESSAGE ---
      const counts = db.getQueueCount(profileId);
      this._emitProgress(profileId, {
        status: 'sending',
        sent: sentToday,
        pending: counts.pending,
        errors: counts.error,
        currentNumber: next.phone_number,
        nextAction: `Enviando mensaje a ${next.phone_number}...`
      });

      try {
        await this.waManager.sendMessage(profileId, next.phone_number, message);

        // Success: remove from queue and log
        db.removeFromQueue(next.id);
        db.logSentMessage(profileId, next.phone_number, 'sent');
        db.incrementSentToday(profileId);
        botState.batchCount++;

        const updatedCounts = db.getQueueCount(profileId);
        const updatedSent = db.getSentToday(profileId);

        console.log(`[Bot:${profileId}] ✅ Sent to ${next.phone_number} (${updatedSent}/${settings.daily_limit} today, batch: ${botState.batchCount}/${settings.batch_size})`);

        this._emitProgress(profileId, {
          status: 'running',
          sent: updatedSent,
          pending: updatedCounts.pending,
          errors: updatedCounts.error,
          currentNumber: next.phone_number,
          nextAction: 'Mensaje enviado ✅'
        });

      } catch (err) {
        console.error(`[Bot:${profileId}] ❌ Failed to send to ${next.phone_number}:`, err.message);

        // Error: mark as error in queue and log
        db.markNumberAsError(next.id);
        db.logSentMessage(profileId, next.phone_number, 'error', err.message);

        const updatedCounts = db.getQueueCount(profileId);
        this._emitProgress(profileId, {
          status: 'running',
          sent: sentToday,
          pending: updatedCounts.pending,
          errors: updatedCounts.error,
          currentNumber: next.phone_number,
          nextAction: `Error: ${err.message}. Continuando...`
        });
      }

      // --- CHECK: Still running after send? ---
      if (!botState.running) return;

      // --- DELAY LOGIC ---

      // Check if batch is complete → long pause
      if (botState.batchCount >= settings.batch_size) {
        botState.batchCount = 0;
        const pauseMs = this._randomBetween(
          settings.batch_pause_min * 60 * 1000,
          settings.batch_pause_max * 60 * 1000
        );
        const pauseMin = Math.round(pauseMs / 60000);

        console.log(`[Bot:${profileId}] 🛑 Batch pause: ${pauseMin} minutes`);
        this._emitProgress(profileId, {
          status: 'batch_pause',
          sent: db.getSentToday(profileId),
          pending: db.getQueueCount(profileId).pending,
          errors: db.getQueueCount(profileId).error,
          currentNumber: '',
          nextAction: `Pausa de lote: ~${pauseMin} minutos. Próximo envío a las ${this._getResumeTime(pauseMs)}`
        });

        await this._interruptibleSleep(profileId, pauseMs);

      } else {
        // Normal delay between messages
        const delayMs = this._randomBetween(
          settings.delay_min * 1000,
          settings.delay_max * 1000
        );
        const delaySec = Math.round(delayMs / 1000);

        console.log(`[Bot:${profileId}] ⏳ Waiting ${delaySec} seconds before next message`);
        this._emitProgress(profileId, {
          status: 'waiting',
          sent: db.getSentToday(profileId),
          pending: db.getQueueCount(profileId).pending,
          errors: db.getQueueCount(profileId).error,
          currentNumber: '',
          nextAction: `Esperando ~${delaySec} segundos antes del próximo mensaje...`
        });

        await this._interruptibleSleep(profileId, delayMs);
      }
    }
  }

  // ============ PRIVATE HELPERS ============

  /**
   * Generate a random number between min and max (inclusive).
   */
  _randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Sleep that can be interrupted if the bot is stopped.
   * Checks every 2 seconds if the bot is still running.
   */
  async _interruptibleSleep(profileId, totalMs) {
    const checkInterval = 2000; // Check every 2 seconds
    let elapsed = 0;

    while (elapsed < totalMs) {
      const botState = this.activeBots.get(profileId);
      if (!botState || !botState.running) return;

      const remaining = Math.min(checkInterval, totalMs - elapsed);
      await new Promise(resolve => setTimeout(resolve, remaining));
      elapsed += remaining;
    }
  }

  /**
   * Calculate the approximate resume time after a pause.
   */
  _getResumeTime(pauseMs) {
    const resumeDate = new Date(Date.now() + pauseMs);
    return resumeDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Emit progress data to the renderer process.
   */
  _emitProgress(profileId, data) {
    if (this.onProgress) {
      this.onProgress(profileId, data);
    }
  }
}

module.exports = BotEngine;
