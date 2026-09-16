require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');
const bcrypt = require('bcrypt');

async function initDb() {
  try {
    console.log('[DB Init] Connecting to PostgreSQL database...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('[DB Init] Executing schema.sql...');
    await db.query(sql);
    console.log('[DB Init] Schema executed successfully. All tables created.');

    // Seed default plan & superadmin if not exists
    const planRes = await db.query("SELECT id FROM plans WHERE name = 'Enterprise' LIMIT 1");
    let planId;
    if (planRes.rows.length === 0) {
      const newPlan = await db.query(
        "INSERT INTO plans (name, user_limit) VALUES ('Enterprise', 10) RETURNING id"
      );
      planId = newPlan.rows[0].id;
      console.log('[DB Seed] Created default Enterprise plan.');
    } else {
      planId = planRes.rows[0].id;
    }

    const companyRes = await db.query("SELECT id FROM companies WHERE name = 'Demo Company' LIMIT 1");
    let companyId;
    if (companyRes.rows.length === 0) {
      const newCompany = await db.query(
        "INSERT INTO companies (name, plan_id, status) VALUES ('Demo Company', $1, 'active') RETURNING id",
        [planId]
      );
      companyId = newCompany.rows[0].id;
      console.log('[DB Seed] Created Demo Company.');
    } else {
      companyId = companyRes.rows[0].id;
    }

    const userRes = await db.query("SELECT id FROM users WHERE email = 'admin@demo.com' LIMIT 1");
    if (userRes.rows.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await db.query(
        "INSERT INTO users (company_id, email, password_hash, role, status) VALUES ($1, 'admin@demo.com', $2, 'admin', 'active')",
        [companyId, passwordHash]
      );
      console.log('[DB Seed] Created default admin user: admin@demo.com / admin123');
    }

    console.log('[DB Init] Database initialization complete!');
    process.exit(0);
  } catch (error) {
    console.error('[DB Init Error]', error);
    process.exit(1);
  }
}

initDb();
