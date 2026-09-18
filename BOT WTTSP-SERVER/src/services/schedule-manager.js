const db = require('../db');
const botEngine = require('./server-bot-engine');
const baileysManager = require('./baileys-manager');

let scheduleInterval = null;

/**
 * Check all companies with work schedule enabled, auto-starting or auto-stopping bots
 */
async function processCompanySchedules() {
  try {
    const companiesRes = await db.query(`
      SELECT id, name, work_schedule_enabled, work_schedule_start, work_schedule_end, work_schedule_days
      FROM companies
      WHERE work_schedule_enabled = TRUE
    `);

    for (const comp of companiesRes.rows) {
      const sched = botEngine.isWithinWorkSchedule(null, comp);

      if (!sched.allowed) {
        // Outside working hours: stop all active bots for this company
        const activeBots = await db.query(
          "SELECT id, name FROM profiles WHERE company_id = $1 AND is_active_bot = TRUE",
          [comp.id]
        );

        for (const b of activeBots.rows) {
          console.log(`[ScheduleManager] Auto-stopping bot '${b.name}' (${b.id}) - Company '${comp.name}' is outside work schedule (${sched.reason})`);
          await botEngine.stopBot(b.id, `Horario laboral cerrado (${comp.work_schedule_start} a ${comp.work_schedule_end}).`);
        }
      } else {
        // Inside working hours: find connected bots with pending queue that are NOT running and auto-start them
        const candidates = await db.query(`
          SELECT p.id, p.name, p.status, p.is_active_bot,
                 COUNT(q.id) as pending_queue
          FROM profiles p
          LEFT JOIN phone_queue q ON q.profile_id = p.id AND q.status = 'pending'
          WHERE p.company_id = $1
            AND p.status = 'connected'
            AND p.is_active_bot = FALSE
            AND p.is_paused_early_warning = FALSE
          GROUP BY p.id
          HAVING COUNT(q.id) > 0
        `, [comp.id]);

        for (const c of candidates.rows) {
          const session = baileysManager.getSession(c.id);
          if (session && session.status === 'connected') {
            console.log(`[ScheduleManager] Auto-starting bot '${c.name}' (${c.id}) - Inside work schedule (${comp.work_schedule_start}-${comp.work_schedule_end}) and has ${c.pending_queue} pending messages.`);
            botEngine.startBot(c.id).catch(err => {
              console.error(`[ScheduleManager] Auto-start error for bot ${c.id}:`, err.message);
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[ScheduleManager] Error processing company schedules:', err.message);
  }
}

/**
 * Start recurring cron / timer
 */
function initScheduleManager(intervalMs = 30000) {
  if (scheduleInterval) clearInterval(scheduleInterval);
  setTimeout(() => {
    processCompanySchedules().catch(console.error);
  }, 5000);

  scheduleInterval = setInterval(processCompanySchedules, intervalMs);
  console.log(`[ScheduleManager] Initialized. Monitoring company work schedules every ${intervalMs / 1000}s.`);
}

function stopScheduleManager() {
  if (scheduleInterval) {
    clearInterval(scheduleInterval);
    scheduleInterval = null;
  }
}

module.exports = {
  initScheduleManager,
  stopScheduleManager,
  processCompanySchedules
};