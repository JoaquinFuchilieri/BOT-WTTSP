require('dotenv').config();
const db = require('../src/db');

async function clean() {
  await db.query("DELETE FROM users WHERE email LIKE 'admin_%@test.com'");
  await db.query("DELETE FROM companies WHERE name LIKE 'Empresa Test%'");
  console.log('Cleaned test companies successfully');
  process.exit(0);
}

clean().catch(console.error);
