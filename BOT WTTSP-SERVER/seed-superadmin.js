require('dotenv').config();
const db = require('./src/db');
const bcrypt = require('bcrypt');

async function seed() {
  try {
    const compRes = await db.query('SELECT id FROM companies LIMIT 1');
    const companyId = compRes.rows[0].id;

    const hash = await bcrypt.hash('superadmin123', 10);
    const email = 'superadmin@botwttsp.com';

    await db.query(`
      INSERT INTO users (company_id, email, password_hash, role, status)
      VALUES ($1, $2, $3, 'superadmin', 'active')
      ON CONFLICT (email) 
      DO UPDATE SET role = 'superadmin', password_hash = $3, status = 'active'
    `, [companyId, email, hash]);

    console.log('✅ Superadmin created successfully: superadmin@botwttsp.com / superadmin123');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding superadmin:', err);
    process.exit(1);
  }
}

seed();
