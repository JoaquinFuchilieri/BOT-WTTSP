const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err, client) => {
  // Cloud databases (like Railway) periodically close idle socket connections.
  // We log the warning and let pg-pool recycle the connection automatically instead of crashing the server process.
  console.warn('[DB Pool Warning] Idle connection closed or reset by host:', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
