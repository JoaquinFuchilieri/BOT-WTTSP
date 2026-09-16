const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const { app } = require('electron');

let db = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'bot-whatsapp.db');
}

function initDatabase() {
  const dbPath = getDbPath();
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'disconnected',
      message TEXT DEFAULT '',
      delay_min INTEGER DEFAULT 115,
      delay_max INTEGER DEFAULT 145,
      batch_size INTEGER DEFAULT 15,
      batch_pause_min INTEGER DEFAULT 25,
      batch_pause_max INTEGER DEFAULT 30,
      daily_limit INTEGER DEFAULT 200,
      sent_today INTEGER DEFAULT 0,
      last_sent_date TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS phone_queue (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sent_log (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      result TEXT DEFAULT 'sent',
      error_message TEXT DEFAULT '',
      sent_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_queue_profile_status ON phone_queue(profile_id, status);
    CREATE INDEX IF NOT EXISTS idx_sent_log_profile ON sent_log(profile_id);
  `);

  console.log('[DB] Database initialized at:', dbPath);
  return db;
}

// ============ PROFILES ============

function getAllProfiles() {
  const stmt = db.prepare(`
    SELECT id, name, status, message, delay_min, delay_max, 
           batch_size, batch_pause_min, batch_pause_max, daily_limit, 
           sent_today, last_sent_date
    FROM profiles ORDER BY created_at ASC
  `);
  const profiles = stmt.all();

  // Reset sent_today if date changed
  const today = new Date().toISOString().split('T')[0];
  for (const p of profiles) {
    if (p.last_sent_date !== today) {
      db.prepare('UPDATE profiles SET sent_today = 0, last_sent_date = ? WHERE id = ?').run(today, p.id);
      p.sent_today = 0;
    }
  }

  return profiles;
}

function getProfile(profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (profile) {
    const today = new Date().toISOString().split('T')[0];
    if (profile.last_sent_date !== today) {
      db.prepare('UPDATE profiles SET sent_today = 0, last_sent_date = ? WHERE id = ?').run(today, profileId);
      profile.sent_today = 0;
    }
  }
  return profile;
}

function createProfile(name) {
  const id = uuidv4();
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO profiles (id, name, last_sent_date) VALUES (?, ?, ?)
  `).run(id, name, today);
  return getProfile(id);
}

function deleteProfile(profileId) {
  db.prepare('DELETE FROM phone_queue WHERE profile_id = ?').run(profileId);
  db.prepare('DELETE FROM sent_log WHERE profile_id = ?').run(profileId);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
}

function updateProfileStatus(profileId, status) {
  db.prepare('UPDATE profiles SET status = ? WHERE id = ?').run(status, profileId);
}

function resetAllStatuses() {
  db.prepare("UPDATE profiles SET status = 'disconnected'").run();
}

function saveMessage(profileId, message) {
  db.prepare('UPDATE profiles SET message = ? WHERE id = ?').run(message, profileId);
}

function getMessage(profileId) {
  const row = db.prepare('SELECT message FROM profiles WHERE id = ?').get(profileId);
  return row ? row.message : '';
}

function getDelaySettings(profileId) {
  const row = db.prepare(`
    SELECT delay_min, delay_max, batch_size, batch_pause_min, batch_pause_max, daily_limit
    FROM profiles WHERE id = ?
  `).get(profileId);
  return row || { delay_min: 115, delay_max: 145, batch_size: 15, batch_pause_min: 25, batch_pause_max: 30, daily_limit: 200 };
}

function updateDelaySettings(profileId, settings) {
  db.prepare(`
    UPDATE profiles 
    SET delay_min = ?, delay_max = ?, batch_size = ?, 
        batch_pause_min = ?, batch_pause_max = ?, daily_limit = ?
    WHERE id = ?
  `).run(
    settings.delay_min, settings.delay_max, settings.batch_size,
    settings.batch_pause_min, settings.batch_pause_max, settings.daily_limit,
    profileId
  );
}

// ============ PHONE QUEUE ============

function importNumbers(profileId, numbers) {
  const insert = db.prepare(`
    INSERT INTO phone_queue (id, profile_id, phone_number) VALUES (?, ?, ?)
  `);

  // Check for existing numbers to avoid duplicates in queue
  const existsInQueue = db.prepare(
    'SELECT 1 FROM phone_queue WHERE profile_id = ? AND phone_number = ?'
  );

  const insertMany = db.transaction((nums) => {
    let imported = 0;
    for (const num of nums) {
      const cleaned = cleanPhoneNumber(num);
      if (!cleaned) continue;

      // Skip if already in queue
      if (existsInQueue.get(profileId, cleaned)) continue;

      insert.run(uuidv4(), profileId, cleaned);
      imported++;
    }
    return imported;
  });

  return insertMany(numbers);
}

function cleanPhoneNumber(num) {
  if (!num || typeof num !== 'string') return null;
  // Remove all non-digit characters except leading +
  let cleaned = num.trim().replace(/[^\d+]/g, '');
  // Remove leading +
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  // Must have at least 7 digits
  if (cleaned.length < 7) return null;
  return cleaned;
}

function getNextPendingNumber(profileId) {
  return db.prepare(`
    SELECT id, phone_number FROM phone_queue 
    WHERE profile_id = ? AND status = 'pending'
    ORDER BY created_at ASC, id ASC LIMIT 1
  `).get(profileId);
}

function peekNextPendingNumber(profileId) {
  return db.prepare(`
    SELECT id, phone_number FROM phone_queue 
    WHERE profile_id = ? AND status = 'pending'
    ORDER BY created_at ASC, id ASC LIMIT 1
  `).get(profileId);
}

function markNumberAsSent(queueId) {
  db.prepare("UPDATE phone_queue SET status = 'sent' WHERE id = ?").run(queueId);
}

function markNumberAsError(queueId) {
  db.prepare("UPDATE phone_queue SET status = 'error' WHERE id = ?").run(queueId);
}

function removeFromQueue(queueId) {
  db.prepare('DELETE FROM phone_queue WHERE id = ?').run(queueId);
}

function getQueueCount(profileId) {
  const pending = db.prepare(
    "SELECT COUNT(*) as count FROM phone_queue WHERE profile_id = ? AND status = 'pending'"
  ).get(profileId).count;
  const sent = db.prepare(
    "SELECT COUNT(*) as count FROM sent_log WHERE profile_id = ? AND result = 'sent'"
  ).get(profileId).count;
  const error = db.prepare(
    "SELECT COUNT(*) as count FROM phone_queue WHERE profile_id = ? AND status = 'error'"
  ).get(profileId).count;
  return { pending, sent, error };
}

function getQueueNumbers(profileId) {
  return db.prepare(`
    SELECT id, phone_number, status FROM phone_queue 
    WHERE profile_id = ? 
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'error' THEN 1 ELSE 2 END, created_at ASC, id ASC
    LIMIT 200
  `).all(profileId);
}

function clearQueue(profileId) {
  db.prepare("DELETE FROM phone_queue WHERE profile_id = ? AND status = 'pending'").run(profileId);
}

function retryErrors(profileId) {
  const result = db.prepare(
    "UPDATE phone_queue SET status = 'pending' WHERE profile_id = ? AND status = 'error'"
  ).run(profileId);
  return result.changes;
}

function clearErrors(profileId) {
  const result = db.prepare(
    "DELETE FROM phone_queue WHERE profile_id = ? AND status = 'error'"
  ).run(profileId);
  return result.changes;
}

function resetSendingQueue(profileId) {
  const result = db.prepare(
    "UPDATE phone_queue SET status = 'pending' WHERE profile_id = ? AND status = 'sending'"
  ).run(profileId);
  return result.changes;
}

// ============ SENT LOG ============

function logSentMessage(profileId, phoneNumber, result, errorMessage = '') {
  db.prepare(`
    INSERT INTO sent_log (id, profile_id, phone_number, result, error_message)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), profileId, phoneNumber, result, errorMessage);
}

function incrementSentToday(profileId) {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    UPDATE profiles SET sent_today = sent_today + 1, last_sent_date = ? WHERE id = ?
  `).run(today, profileId);
}

function getSentToday(profileId) {
  const profile = getProfile(profileId);
  return profile ? profile.sent_today : 0;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  closeDatabase,
  // Profiles
  getAllProfiles,
  getProfile,
  createProfile,
  deleteProfile,
  updateProfileStatus,
  resetAllStatuses,
  saveMessage,
  getMessage,
  getDelaySettings,
  updateDelaySettings,
  // Queue
  importNumbers,
  getNextPendingNumber,
  peekNextPendingNumber,
  markNumberAsSent,
  markNumberAsError,
  removeFromQueue,
  getQueueCount,
  getQueueNumbers,
  clearQueue,
  retryErrors,
  clearErrors,
  resetSendingQueue,
  // Sent log
  logSentMessage,
  incrementSentToday,
  getSentToday
};
