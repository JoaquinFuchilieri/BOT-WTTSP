
class BotEngine {
  constructor(whatsAppManager, storage = null) {
    this.waManager = whatsAppManager;
    this.storage = storage || require('./database');
    // Map<profileId, { running, abortController, batchCount }>
    this.activeBots = new Map();
    // Callback to emit progress to the renderer
    this.onProgress = null; // (profileId, data) => void

    // Turn-Based Interleaved Dispatcher across all bots:
    // Ensures only 1 bot dispatches a message over WhatsApp Web/network at any given instant.
    this._turnQueue = []; // array of { profileId, resolve }
    this._turnActiveHolder = null; // profileId currently holding the turn
  }

  /**
   * Acquire send turn across all active bots.
   * Resolves with a release function when it's this bot's turn to dispatch.
   */
  async _acquireSendTurn(profileId) {
    const botState = this.activeBots.get(profileId);
    if (!botState || !botState.running) return null;

    if (!this._turnActiveHolder) {
      this._turnActiveHolder = profileId;
      return () => this._releaseSendTurn(profileId);
    }

    console.log(`[Bot:${profileId}] Waiting for send turn (held by ${this._turnActiveHolder})...`);
    this._emitProgress(profileId, {
      status: 'waiting_turn',
      nextAction: 'Esperando turno de envío (otro bot despachando)... ⏳'
    });

    return new Promise((resolve) => {
      this._turnQueue.push({
        profileId,
        resolve: () => {
          this._turnActiveHolder = profileId;
          resolve(() => this._releaseSendTurn(profileId));
        }
      });
    });
  }

  /**
   * Release the send turn and hand over to the next bot in line.
   */
  _releaseSendTurn(profileId) {
    if (this._turnActiveHolder === profileId) {
      this._turnActiveHolder = null;
    }
    // Advance queue to next active bot
    while (this._turnQueue.length > 0) {
      const next = this._turnQueue.shift();
      const nextBotState = this.activeBots.get(next.profileId);
      if (nextBotState && nextBotState.running) {
        next.resolve();
        return;
      }
    }
  }

  /**
   * Start the sending loop for a profile.
   * The loop runs asynchronously and can be stopped via stop().
   */
  async start(profileId) {
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
    let message = '';
    try {
      message = await this.storage.getMessage(profileId);
    } catch (err) {
      console.error(`[Bot:${profileId}] Error fetching message:`, err);
    }

    if (!message || message.trim() === '') {
      this._emitProgress(profileId, {
        status: 'error',
        nextAction: 'No hay mensaje configurado. Guardá un mensaje primero.'
      });
      return;
    }

    const botState = {
      running: true,
      batchCount: 0,
      lastStatus: 'starting',
      lastData: null
    };
    this.activeBots.set(profileId, botState);

    // Auto-heal any numbers left in 'sending' state from previous crashes/restarts
    try {
      if (this.storage && this.storage.resetSendingQueue) {
        await this.storage.resetSendingQueue(profileId);
      }
    } catch (healErr) {
      console.warn(`[Bot:${profileId}] Reset sending queue notice:`, healErr.message);
    }

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

      // Clean up from turn queue if waiting or holding
      this._turnQueue = this._turnQueue.filter(entry => entry.profileId !== profileId);
      if (this._turnActiveHolder === profileId) {
        this._releaseSendTurn(profileId);
      }

      console.log(`[Bot:${profileId}] Stopped: ${reason}`);
      this._emitProgress(profileId, {
        status: 'stopped',
        currentNumber: '-',
        nextNumber: '-',
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
   * Get all active bots states for main screen UI.
   */
  getAllStates() {
    const states = {};
    for (const [id, state] of this.activeBots.entries()) {
      states[id] = {
        running: state.running,
        status: state.lastStatus || 'running',
        data: state.lastData || null
      };
    }
    return states;
  }

  /**
   * Stop all active bots (called on app quit).
   */
  stopAll() {
    for (const profileId of Array.from(this.activeBots.keys())) {
      this.stop(profileId);
    }
    this._turnQueue = [];
    this._turnActiveHolder = null;
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
        while (waited < 45000 && !this.waManager.isConnected(profileId) && botState.running) {
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
      // --- CHECK 1: Is WhatsApp still connected? (Grace period for multi-bot CPU spikes) ---
      if (!this.waManager.isConnected(profileId)) {
        console.warn(`[Bot:${profileId}] WhatsApp temporarily not ready. Waiting for recovery...`);
        this._emitProgress(profileId, {
          status: 'running',
          nextAction: 'Reconectando con WhatsApp... aguarda un momento ⏳'
        });

        let recovered = false;
        let waitTime = 0;
        while (waitTime < 30000 && botState.running) {
          await new Promise(r => setTimeout(r, 2000));
          waitTime += 2000;
          if (this.waManager.isConnected(profileId)) {
            recovered = true;
            break;
          }
        }

        if (!recovered && botState.running) {
          if (this.waManager.hasSavedSession(profileId)) {
            try {
              console.log(`[Bot:${profileId}] Attempting auto-reconnect of saved session...`);
              await this.waManager.initClient(profileId);
              let reinitWait = 0;
              while (reinitWait < 30000 && botState.running) {
                await new Promise(r => setTimeout(r, 2000));
                reinitWait += 2000;
                if (this.waManager.isConnected(profileId)) {
                  recovered = true;
                  break;
                }
              }
            } catch (reErr) {
              console.error(`[Bot:${profileId}] Reconnect failed:`, reErr.message);
            }
          }
        }

        if (!recovered) {
          this.stop(profileId, 'WhatsApp se desconectó y no pudo restablecer conexión.');
          return;
        }
      }

      // --- CHECK 2: Settings, Early Warning, Work Schedule & Daily Limits ---
      let settings = { daily_limit: 200, delay_min: 115, delay_max: 145, batch_size: 15, batch_pause_min: 25, batch_pause_max: 30 };
      let counts = { pending: 0, sent: 0, error: 0 };
      try {
        settings = await this.storage.getDelaySettings(profileId);
        counts = await this.storage.getQueueCount(profileId);
      } catch (err) {
        console.error(`[Bot:${profileId}] Failed to fetch settings/counts:`, err);
      }

      const sentToday = counts.sent || 0;

      // Check Early Warning flag on profile
      if (settings.is_paused_early_warning) {
        this.stop(profileId, `Cola pausada por el Sistema de Alerta Temprana: ${settings.early_warning_reason || 'Alta tasa de fallos'}. Reanudala desde el panel.`);
        return;
      }

      // Check Work Schedule (Operating Window)
      if (!this._isWithinWorkSchedule(settings)) {
        const start = settings.work_schedule_start || '09:00';
        const end = settings.work_schedule_end || '18:00';
        this._emitProgress(profileId, {
          status: 'schedule_pause',
          sent: sentToday,
          pending: counts.pending,
          errors: counts.error,
          currentNumber: '-',
          nextAction: `Fuera del horario laboral configurado (${start} - ${end}). Pausado automáticamente ⏳`
        });
        await this._interruptibleSleep(profileId, 30000);
        continue;
      }

      // Check Daily Limit (with Warm-up Mode scaling if enabled)
      let effectiveDailyLimit = settings.daily_limit || 200;
      let isWarmupActive = false;
      if (settings.warmup_enabled) {
        const warmupDay = settings.warmup_day || 1;
        const increment = settings.warmup_daily_increment || 15;
        const maxWarmup = settings.warmup_max_limit || 200;
        effectiveDailyLimit = Math.min(maxWarmup, warmupDay * increment);
        isWarmupActive = true;
      }

      if (sentToday >= effectiveDailyLimit) {
        const pauseNotice = isWarmupActive
          ? `Modo Calentamiento: Límite del Día ${settings.warmup_day || 1} alcanzado (${sentToday}/${effectiveDailyLimit}). Se reanudará mañana 🛡️`
          : `Límite diario alcanzado (${effectiveDailyLimit}). Se reanudará mañana.`;

        this._emitProgress(profileId, {
          status: 'paused',
          sent: sentToday,
          nextAction: pauseNotice
        });
        // Wait 30 minutes and check again (date might change)
        await this._interruptibleSleep(profileId, 30 * 60 * 1000);
        continue;
      }

      if (counts.pending <= 0) {
        this.stop(profileId, 'Cola vacía. Todos los mensajes fueron enviados ✅');
        return;
      }


      // --- ACQUIRE SEND TURN (Interleaved Dispatcher: only 1 bot sends at a physical moment) ---
      const releaseTurn = await this._acquireSendTurn(profileId);
      if (!botState.running) {
        if (releaseTurn) releaseTurn();
        return;
      }

      let isConnError = false;

      try {
        // --- CHECK 3: Get next number from queue (Atomic fetch inside turn lock) ---
        let next = null;
        try {
          next = await this.storage.getNextPendingNumber(profileId);
        } catch (err) {
          if (err.reason === 'PROFILE_PAUSED_EARLY_WARNING' || (err.message && err.message.includes('EARLY_WARNING'))) {
            this.stop(profileId, `Cola pausada por alerta temprana: ${err.message}`);
            return;
          }
          console.error(`[Bot:${profileId}] Failed to get next number from queue:`, err);
        }

        if (!next) {
          this.stop(profileId, 'Cola vacía. Todos los mensajes fueron enviados ✅');
          return;
        }

        // --- SEND MESSAGE ---
        this._emitProgress(profileId, {
          status: 'sending',
          sent: sentToday,
          pending: counts.pending,
          errors: counts.error,
          currentNumber: next.phone_number,
          nextNumber: next.phone_number,
          nextAction: `Enviando mensaje a ${next.phone_number}... 📤`
        });

        try {
          const sendResult = await this.waManager.sendMessage(profileId, next.phone_number, message);
          const confirmedPhone = (sendResult && sendResult.targetJid)
            ? sendResult.targetJid.replace('@c.us', '')
            : next.phone_number;

          // Success: mark as sent via storage/API
          await this.storage.markNumberAsSent(profileId, next.id, confirmedPhone);
          botState.batchCount++;

          let updatedCounts = counts;
          try {
            updatedCounts = await this.storage.getQueueCount(profileId);
          } catch (e) {}

          const updatedSent = updatedCounts.sent || (sentToday + 1);

          console.log(`[Bot:${profileId}] ✅ Sent to ${confirmedPhone} (${updatedSent}/${settings.daily_limit} today, batch: ${botState.batchCount}/${settings.batch_size})`);

          this._emitProgress(profileId, {
            status: 'running',
            sent: updatedSent,
            pending: updatedCounts.pending,
            errors: updatedCounts.error,
            currentNumber: confirmedPhone,
            nextNumber: confirmedPhone,
            nextAction: `Mensaje enviado con éxito a ${confirmedPhone} ✅`
          });

        } catch (err) {
          console.error(`[Bot:${profileId}] ❌ Failed to send to ${next.phone_number}:`, err.message);

          const isConnectionError =
            err.message.includes('WhatsApp no está conectado') ||
            err.message.includes('Session closed') ||
            err.message.includes('Target closed') ||
            err.message.includes('Protocol error') ||
            err.message.includes('destroyed') ||
            err.message.includes('detached');

          if (isConnectionError) {
            isConnError = true;
            // Do NOT mark number as error if it was a connection drop.
            // Keep it pending and attempt recovery so we don't burn the queue.
            console.warn(`[Bot:${profileId}] Connection issue detected. Retaining ${next.phone_number} as pending.`);
            this._emitProgress(profileId, {
              status: 'running',
              sent: sentToday,
              pending: counts.pending,
              errors: counts.error,
              currentNumber: next.phone_number,
              nextNumber: next.phone_number,
              nextAction: `WhatsApp se desconectó durante el envío a ${next.phone_number}. Intentando reconectar... ⏳`
            });
          } else {
            // True destination error (e.g. invalid number): mark as error in queue
            await this.storage.markNumberAsError(profileId, next.id, next.phone_number, err.message);

            let updatedCounts = counts;
            try {
              updatedCounts = await this.storage.getQueueCount(profileId);
            } catch (e) {}

            this._emitProgress(profileId, {
              status: 'running',
              sent: sentToday,
              pending: updatedCounts.pending,
              errors: updatedCounts.error,
              currentNumber: next.phone_number,
              nextNumber: next.phone_number,
              nextAction: `Error enviando a ${next.phone_number}: ${err.message}. Continuando...`
            });
          }
        }

        // Stagger window (2.5 to 4.5s) between bots to ensure zero network/IP collision
        if (botState.running) {
          await new Promise(r => setTimeout(r, this._randomBetween(2500, 4500)));
        }

      } finally {
        // Release turn to next waiting bot
        if (releaseTurn) {
          releaseTurn();
        }
      }

      if (isConnError) {
        await this._interruptibleSleep(profileId, 5000);
        continue;
      }

      // --- CHECK: Still running after send? ---
      if (!botState.running) return;

      // Peek the next pending number to display it during the waiting period
      let upcoming = null;
      try {
        upcoming = await this.storage.peekNextPendingNumber(profileId);
      } catch (peekErr) {
        console.warn(`[Bot:${profileId}] Failed to peek next number:`, peekErr.message);
      }

      let curCounts = counts;
      try { curCounts = await this.storage.getQueueCount(profileId); } catch (e) {}

      if (!upcoming && (curCounts.pending === 0 || !curCounts.pending)) {
        this.stop(profileId, 'Cola completada. Todos los mensajes fueron enviados ✅');
        return;
      }

      const nextPhone = upcoming ? upcoming.phone_number : '-';

      // --- DELAY LOGIC ---

      // Check if batch is complete → long pause
      if (botState.batchCount >= settings.batch_size) {
        botState.batchCount = 0;
        const pauseMs = this._randomBetween(
          settings.batch_pause_min * 60 * 1000,
          settings.batch_pause_max * 60 * 1000
        );
        const pauseMin = Math.round(pauseMs / 60000);
        const resumeTimestampMs = Date.now() + pauseMs;

        console.log(`[Bot:${profileId}] 🛑 Batch pause: ${pauseMin} minutes`);

        this._emitProgress(profileId, {
          status: 'batch_pause',
          sent: curCounts.sent,
          pending: curCounts.pending,
          errors: curCounts.error,
          currentNumber: nextPhone,
          nextNumber: nextPhone,
          delaySec: Math.round(pauseMs / 1000),
          resumeTimestampMs: resumeTimestampMs,
          nextAction: `Pausa de lote: ~${pauseMin} minutos. Próximo envío a las ${this._getResumeTime(pauseMs)} (${nextPhone})`
        });

        await this._interruptibleSleep(profileId, pauseMs);

      } else {
        // Normal delay between messages
        const delayMs = this._randomBetween(
          settings.delay_min * 1000,
          settings.delay_max * 1000
        );
        const delaySec = Math.round(delayMs / 1000);
        const resumeTimestampMs = Date.now() + delayMs;

        console.log(`[Bot:${profileId}] ⏳ Waiting ${delaySec} seconds before next message`);

        this._emitProgress(profileId, {
          status: 'waiting',
          sent: curCounts.sent,
          pending: curCounts.pending,
          errors: curCounts.error,
          currentNumber: nextPhone,
          nextNumber: nextPhone,
          delaySec: delaySec,
          resumeTimestampMs: resumeTimestampMs,
          nextAction: `Esperando intervalo antes del próximo envío a ${nextPhone}...`
        });

        await this._interruptibleSleep(profileId, delayMs);
      }
    }
  }

  // ============ PRIVATE HELPERS ============

  _randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  async _interruptibleSleep(profileId, totalMs) {
    const checkInterval = 2000;
    let elapsed = 0;

    while (elapsed < totalMs) {
      const botState = this.activeBots.get(profileId);
      if (!botState || !botState.running) return;

      const remaining = Math.min(checkInterval, totalMs - elapsed);
      await new Promise(resolve => setTimeout(resolve, remaining));
      elapsed += remaining;
    }
  }

  _getResumeTime(pauseMs) {
    const resumeDate = new Date(Date.now() + pauseMs);
    return resumeDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  _emitProgress(profileId, data) {
    const botState = this.activeBots.get(profileId);
    if (botState) {
      if (data.status) botState.lastStatus = data.status;
      botState.lastData = { ...(botState.lastData || {}), ...data };
    }
    if (this.onProgress) {
      this.onProgress(profileId, data);
    }
  }

  /**
   * Check if current time falls within configured work schedule
   */
  _isWithinWorkSchedule(settings) {
    if (!settings.work_schedule_enabled || settings.work_schedule_enabled === 'false' || settings.work_schedule_enabled === '0' || settings.work_schedule_enabled === 0) {
      return true;
    }

    const now = new Date();
    const jsDay = now.getDay();
    const currentDayNum = jsDay === 0 ? 7 : jsDay;

    const allowedDays = (settings.work_schedule_days || '1,2,3,4,5')
      .split(',')
      .map(d => parseInt(d.trim(), 10))
      .filter(n => !isNaN(n));

    if (allowedDays.length > 0 && !allowedDays.includes(currentDayNum)) {
      return false;
    }

    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const currentTimeMin = currentHour * 60 + currentMin;

    const [startH, startM] = (settings.work_schedule_start || '09:00').split(':').map(Number);
    const [endH, endM] = (settings.work_schedule_end || '18:00').split(':').map(Number);

    const startTimeMin = (startH || 0) * 60 + (startM || 0);
    const endTimeMin = (endH || 0) * 60 + (endM || 0);

    if (currentTimeMin < startTimeMin || currentTimeMin >= endTimeMin) {
      return false;
    }

    return true;
  }

}

module.exports = BotEngine;
