const db = require('../db');
const baileysManager = require('./baileys-manager');

// Track active bot worker loops: profileId -> { isRunning, timer, state }
const runningBots = new Map();

// Progress update listeners (WebSockets)
const progressListeners = new Set();

function onProgress(callback) {
  progressListeners.add(callback);
  return () => progressListeners.delete(callback);
}

function emitProgress(profileId, data) {
  for (const fn of progressListeners) {
    try { fn(profileId, data); } catch (e) { console.error('[BotEngine] Progress listener error:', e); }
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if current time is within work schedule for a profile and its company.
 * Priority: If company has work_schedule_enabled, it strictly overrides and enforces on all company bots.
 * Otherwise falls back to profile-level schedule if configured.
 */
function isWithinWorkSchedule(profile, company) {
  const schedEnabled = company && company.work_schedule_enabled !== undefined 
    ? company.work_schedule_enabled 
    : profile?.work_schedule_enabled;

  if (!schedEnabled) return { allowed: true };

  const startStr = (company?.work_schedule_start || profile?.work_schedule_start || '09:00').trim();
  const endStr = (company?.work_schedule_end || profile?.work_schedule_end || '20:00').trim();
  const daysStr = (company?.work_schedule_days || profile?.work_schedule_days || '1,2,3,4,5').trim();

  const now = new Date();
  const day = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const allowedDays = daysStr.split(',').map(d => parseInt(d.trim(), 10));

  if (!allowedDays.includes(day)) {
    return {
      allowed: false,
      reason: `Hoy no es un día laboral permitido según la configuración de la empresa (${startStr} a ${endStr}).`,
      startStr,
      endStr
    };
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);

  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;

  let inside = false;
  if (startTotal <= endTotal) {
    // Normal daytime schedule (e.g. 09:00 to 20:00)
    inside = currentMinutes >= startTotal && currentMinutes < endTotal;
  } else {
    // Overnight schedule (e.g. 22:00 to 06:00)
    inside = currentMinutes >= startTotal || currentMinutes < endTotal;
  }

  if (!inside) {
    return {
      allowed: false,
      reason: `Fuera del horario laboral permitido (${startStr} a ${endStr}).`,
      startStr,
      endStr
    };
  }

  return { allowed: true, startStr, endStr };
}

/**
 * Main worker loop for a single WhatsApp bot profile
 */
async function runBotLoop(profileId) {
  let botState = runningBots.get(profileId);
  if (!botState) return;

  console.log(`[BotEngine] Started worker loop for profile ${profileId}`);

  let consecutiveErrors = 0;
  let sentInCurrentBatch = 0;

  while (botState.isRunning) {
    try {
      // 1. Fetch fresh profile data with company work schedule
      const pRes = await db.query(`
        SELECT p.*, 
               c.work_schedule_enabled as comp_work_schedule_enabled,
               c.work_schedule_start as comp_work_schedule_start,
               c.work_schedule_end as comp_work_schedule_end,
               c.work_schedule_days as comp_work_schedule_days,
               c.name as comp_name
        FROM profiles p
        JOIN companies c ON p.company_id = c.id
        WHERE p.id = $1
      `, [profileId]);
      if (pRes.rows.length === 0) {
        console.warn(`[BotEngine] Profile ${profileId} deleted, stopping worker.`);
        break;
      }
      const profile = pRes.rows[0];
      const company = {
        work_schedule_enabled: profile.comp_work_schedule_enabled,
        work_schedule_start: profile.comp_work_schedule_start,
        work_schedule_end: profile.comp_work_schedule_end,
        work_schedule_days: profile.comp_work_schedule_days,
        name: profile.comp_name
      };

      // Check if manually disabled
      if (!profile.is_active_bot) {
        console.log(`[BotEngine] Profile ${profileId} marked inactive. Stopping loop.`);
        break;
      }

      // Check early warning pause
      if (profile.is_paused_early_warning) {
        emitProgress(profileId, { status: 'early_warning_paused', reason: profile.early_warning_reason });
        await sleep(30000);
        continue;
      }

      // 2. Work schedule check (Company schedule takes strict priority)
      const schedCheck = isWithinWorkSchedule(profile, company);
      if (!schedCheck.allowed) {
        console.log(`[BotEngine] Profile ${profileId} is outside work schedule (${schedCheck.reason}). Auto-stopping bot.`);
        botState.status = 'outside_work_schedule';
        botState.nextAction = schedCheck.reason;
        emitProgress(profileId, {
          status: 'outside_work_schedule',
          sentToday: profile.sent_today || 0,
          nextAction: schedCheck.reason
        });
        // Auto-stop bot completely to prevent random running
        await stopBot(profileId, schedCheck.reason);
        break;
      }

      // 3. Daily counter reset check
      const today = new Date().toISOString().split('T')[0];
      const lastDate = profile.last_sent_date ? new Date(profile.last_sent_date).toISOString().split('T')[0] : '';
      let sentToday = profile.sent_today || 0;

      if (lastDate !== today) {
        await db.query("UPDATE profiles SET sent_today = 0, last_sent_date = CURRENT_DATE WHERE id = $1", [profileId]);
        sentToday = 0;
      }

      // 4. Daily limit check (with warmup support)
      let effectiveLimit = profile.daily_limit || 200;
      if (profile.warmup_enabled) {
        const warmupLimit = (profile.warmup_day || 1) * (profile.warmup_daily_increment || 15);
        effectiveLimit = Math.min(profile.warmup_max_limit || 200, warmupLimit);
      }

      if (sentToday >= effectiveLimit) {
        emitProgress(profileId, {
          status: 'daily_limit_reached',
          sentToday,
          effectiveLimit,
          nextAction: 'Límite diario alcanzado. Reanudará mañana.'
        });
        await sleep(60000); // Wait 1 min before checking date again
        continue;
      }

      // 5. WhatsApp connection check
      const session = baileysManager.getSession(profileId);
      if (session.status !== 'connected') {
        emitProgress(profileId, {
          status: 'waiting_connection',
          nextAction: 'Esperando conexión con WhatsApp...'
        });
        await sleep(10000);
        continue;
      }

      // 6. Batch pause check
      const batchSize = profile.batch_size || 15;
      if (sentInCurrentBatch >= batchSize) {
        const pauseMinutes = randomBetween(profile.batch_pause_min || 25, profile.batch_pause_max || 30);
        const pauseSeconds = pauseMinutes * 60;
        const nextSendAt = Date.now() + (pauseSeconds * 1000);
        botState.status = 'batch_pause';
        botState.nextSendAt = nextSendAt;
        console.log(`[BotEngine] Profile ${profileId} reached batch limit (${batchSize}). Pausing for ${pauseMinutes}m...`);

        sentInCurrentBatch = 0;
        let pauseElapsed = 0;
        while (pauseElapsed < pauseSeconds && botState.isRunning) {
          const remainingSecs = Math.max(0, Math.round((nextSendAt - Date.now()) / 1000));
          botState.nextAction = `Pausa de lote: descansando (${Math.ceil(remainingSecs / 60)}m restantes)...`;
          emitProgress(profileId, {
            status: 'batch_pause',
            pauseMinutes,
            countdown: remainingSecs,
            nextSendAt,
            nextAction: botState.nextAction
          });
          await sleep(1000);
          pauseElapsed += 1;
        }
        botState.status = 'processing';
        botState.nextSendAt = null;
        continue;
      }

      // 7. Get next pending phone number from queue
      const qRes = await db.query(
        "SELECT id, phone_number FROM phone_queue WHERE profile_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT 1",
        [profileId]
      );

      if (qRes.rows.length === 0) {
        emitProgress(profileId, {
          status: 'idle_empty_queue',
          sentToday,
          nextAction: 'Cola vacía. Esperando nuevos números.'
        });
        await sleep(15000); // Check again in 15 seconds
        continue;
      }

      const queueItem = qRes.rows[0];
      const phoneNumber = queueItem.phone_number;
      const messageText = profile.message || '';

      if (!messageText.trim()) {
        emitProgress(profileId, {
          status: 'no_message_configured',
          nextAction: 'El bot no tiene mensaje configurado. Edita el mensaje para comenzar.'
        });
        await sleep(15000);
        continue;
      }

      // Mark as sending
      await db.query("UPDATE phone_queue SET status = 'sending' WHERE id = $1", [queueItem.id]);

      emitProgress(profileId, {
        status: 'sending',
        currentNumber: phoneNumber,
        sentToday,
        nextAction: `Enviando mensaje a ${phoneNumber}...`
      });

      // 8. Execute Send via Baileys
      let sendSuccess = false;
      let errorMsg = '';

      try {
        await baileysManager.sendMessage(profileId, phoneNumber, messageText);
        sendSuccess = true;
        consecutiveErrors = 0;
      } catch (sendErr) {
        errorMsg = sendErr.message || 'Error desconocido al enviar';
        console.warn(`[BotEngine] Error sending to ${phoneNumber} on profile ${profileId}:`, errorMsg);
        consecutiveErrors++;
      }

      // 9. Update Queue and Logs
      if (sendSuccess) {
        await db.query("UPDATE phone_queue SET status = 'sent' WHERE id = $1", [queueItem.id]);
        await db.query(
          "INSERT INTO sent_log (profile_id, phone_number, result) VALUES ($1, $2, 'sent')",
          [profileId, phoneNumber]
        );
        await db.query(
          "UPDATE profiles SET sent_today = sent_today + 1, last_sent_date = CURRENT_DATE WHERE id = $1",
          [profileId]
        );

        sentToday++;
        sentInCurrentBatch++;
      } else {
        await db.query("UPDATE phone_queue SET status = 'error' WHERE id = $1", [queueItem.id]);
        await db.query(
          "INSERT INTO sent_log (profile_id, phone_number, result, error_message) VALUES ($1, $2, 'error', $3)",
          [profileId, phoneNumber, errorMsg]
        );

        // Check Early Warning condition: inspect error rate over last 30 sends
        try {
          const logRes = await db.query(
            "SELECT result FROM sent_log WHERE profile_id = $1 ORDER BY sent_at DESC LIMIT 30",
            [profileId]
          );
          if (logRes.rows.length >= 10) {
            const errorCount = logRes.rows.filter(r => r.result === 'error').length;
            const errorRate = errorCount / logRes.rows.length;
            if (errorRate > 0.20) {
              // Pause bot for protection
              await db.query(
                "UPDATE profiles SET is_paused_early_warning = TRUE, early_warning_reason = $1, is_active_bot = FALSE WHERE id = $2",
                [`Tasa de errores anormalmente alta (${Math.round(errorRate * 100)}%). Bot pausado para proteger el número.`, profileId]
              );
              emitProgress(profileId, {
                status: 'early_warning_paused',
                nextAction: 'Alerta temprana activada: bot pausado automáticamente para prevenir baneo.'
              });
              break;
            }
          }
        } catch (warnErr) {
          console.error('[BotEngine] Early warning check failed:', warnErr);
        }
      }

      // 10. Human Delay between messages (Controlled strictly by SuperAdmin config)
      const delayMin = profile.delay_min || 115;
      const delayMax = profile.delay_max || 145;
      const waitSeconds = randomBetween(delayMin, delayMax);
      const nextSendAt = Date.now() + (waitSeconds * 1000);
      botState.status = 'cooling_down';
      botState.nextSendAt = nextSendAt;

      console.log(`[BotEngine] Profile ${profileId} sent to ${phoneNumber}. Waiting ${waitSeconds}s before next...`);

      // Sleep in 1-second increments so countdown is precise and bot stops responsively
      let elapsed = 0;
      while (elapsed < waitSeconds && botState.isRunning) {
        const remaining = Math.max(0, Math.round((nextSendAt - Date.now()) / 1000));
        botState.nextAction = `Esperando retraso humano de seguridad (${remaining}s)...`;
        emitProgress(profileId, {
          status: 'cooling_down',
          sentToday,
          countdown: remaining,
          nextSendAt,
          nextAction: botState.nextAction
        });
        await sleep(1000);
        elapsed += 1;
      }
      botState.status = 'processing';
      botState.nextSendAt = null;

    } catch (loopErr) {
      console.error(`[BotEngine] Unexpected error in worker loop for ${profileId}:`, loopErr);
      await sleep(10000);
    }
  }

  runningBots.delete(profileId);
  console.log(`[BotEngine] Worker loop ended for profile ${profileId}`);
}

/**
 * Start bot sending for a profile
 */
async function startBot(profileId) {
  const session = baileysManager.getSession(profileId);
  if (!session || session.status !== 'connected') {
    throw new Error('No se puede encender el bot: la cuenta de WhatsApp no está conectada. Escanea el código QR primero.');
  }

  // Fetch profile and company data to check work schedule
  const pRes = await db.query(`
    SELECT p.*, 
           c.work_schedule_enabled as comp_work_schedule_enabled,
           c.work_schedule_start as comp_work_schedule_start,
           c.work_schedule_end as comp_work_schedule_end,
           c.work_schedule_days as comp_work_schedule_days,
           c.name as comp_name
    FROM profiles p
    JOIN companies c ON p.company_id = c.id
    WHERE p.id = $1
  `, [profileId]);

  if (pRes.rows.length === 0) {
    throw new Error('Perfil no encontrado');
  }

  const profile = pRes.rows[0];
  const company = {
    work_schedule_enabled: profile.comp_work_schedule_enabled,
    work_schedule_start: profile.comp_work_schedule_start,
    work_schedule_end: profile.comp_work_schedule_end,
    work_schedule_days: profile.comp_work_schedule_days,
    name: profile.comp_name
  };

  // Check schedule
  const schedCheck = isWithinWorkSchedule(profile, company);
  if (!schedCheck.allowed) {
    throw new Error(`No se puede encender el bot: ${schedCheck.reason}`);
  }

  let botState = runningBots.get(profileId);
  if (botState && botState.isRunning) {
    return { success: true, message: 'El bot ya está en ejecución' };
  }

  await db.query("UPDATE profiles SET is_active_bot = TRUE, is_paused_early_warning = FALSE WHERE id = $1", [profileId]);

  botState = { isRunning: true, status: 'started', nextSendAt: null, nextAction: 'Bot activado' };
  runningBots.set(profileId, botState);

  // Fire and forget worker loop
  runBotLoop(profileId).catch(err => {
    console.error(`[BotEngine] Worker fatal crash for ${profileId}:`, err);
  });

  emitProgress(profileId, { status: 'started', nextAction: 'Bot activado.' });
  return { success: true };
}

/**
 * Stop bot sending for a profile
 */
async function stopBot(profileId, reason = 'Bot apagado.') {
  const botState = runningBots.get(profileId);
  if (botState) {
    botState.isRunning = false;
    botState.status = 'stopped';
    botState.nextSendAt = null;
    botState.nextAction = reason;
  }
  runningBots.delete(profileId);

  await db.query("UPDATE profiles SET is_active_bot = FALSE WHERE id = $1", [profileId]);

  emitProgress(profileId, { status: 'stopped', nextAction: reason, countdown: 0, nextSendAt: null });
  return { success: true };
}

/**
 * Get live state and countdown timestamp of a bot
 */
function getBotState(profileId) {
  const botState = runningBots.get(profileId);
  if (!botState || !botState.isRunning) {
    return {
      isRunning: false,
      status: 'stopped',
      nextSendAt: null,
      countdown: 0,
      nextAction: 'Bot en pausa'
    };
  }
  const nextSendAt = botState.nextSendAt || null;
  const countdown = nextSendAt ? Math.max(0, Math.round((nextSendAt - Date.now()) / 1000)) : 0;
  return {
    isRunning: true,
    status: botState.status || 'running',
    nextSendAt,
    countdown,
    nextAction: botState.nextAction || 'Bot activo procesando'
  };
}

/**
 * Auto-start all active bots on server startup
 */
async function autoStartBots() {
  try {
    const res = await db.query("SELECT id, name FROM profiles WHERE is_active_bot = TRUE");
    console.log(`[BotEngine] Found ${res.rows.length} bots marked as active on startup.`);
    for (const p of res.rows) {
      console.log(`[BotEngine] Auto-starting bot '${p.name}' (${p.id})...`);
      startBot(p.id).catch(err => console.error(`[BotEngine] Auto-start failed for ${p.id}:`, err.message));
    }
  } catch (err) {
    console.error('[BotEngine] Error in autoStartBots:', err);
  }
}

module.exports = {
  startBot,
  stopBot,
  autoStartBots,
  onProgress,
  getBotState,
  isWithinWorkSchedule,
  runningBots
};
