require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const db = require('./index');

async function migrate() {
  try {
    console.log('[Migration] Starting database migration for Baileys web platform...');

    // 1. Add whatsapp_limit to companies if not exists
    await db.query(`
      ALTER TABLE companies 
      ADD COLUMN IF NOT EXISTS whatsapp_limit INTEGER DEFAULT 10;
    `);
    console.log('[Migration] Column whatsapp_limit added/verified on companies table.');

    // 2. Add is_active_bot and phone_number to profiles if not exists
    await db.query(`
      ALTER TABLE profiles 
      ADD COLUMN IF NOT EXISTS is_active_bot BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30) DEFAULT '';
    `);
    console.log('[Migration] Columns is_active_bot, phone_number added/verified on profiles table.');

    // 3. Update schema default for companies with 0 or null whatsapp_limit to 10
    await db.query(`
      UPDATE companies SET whatsapp_limit = 10 WHERE whatsapp_limit IS NULL;
    `);

    console.log('[Migration] Database migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Migration Error]', err);
    process.exit(1);
  }
}

migrate();
