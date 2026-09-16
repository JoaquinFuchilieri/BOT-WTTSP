require('dotenv').config();
const db = require('./src/db');

async function createNotesTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS company_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        author_email VARCHAR(100) NOT NULL,
        title VARCHAR(150) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(50) DEFAULT 'general',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_company_notes ON company_notes(company_id);
    `);
    console.log('✅ company_notes table created successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating company_notes table:', err);
    process.exit(1);
  }
}

createNotesTable();
