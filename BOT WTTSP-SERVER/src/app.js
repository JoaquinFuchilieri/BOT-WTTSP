const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');

const app = express();

// Disable information disclosure header
app.disable('x-powered-by');

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

// Security and anti-caching headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src 'self' data: blob: https:; font-src 'self' https: data:;");

  // Prevent stale caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/companies');
const userRoutes = require('./routes/users');
const profileRoutes = require('./routes/profiles');
const queueRoutes = require('./routes/queue');
const statsRoutes = require('./routes/stats');
const blacklistRoutes = require('./routes/blacklist');
const announcementRoutes = require('./routes/announcements');
const auditLogRoutes = require('./routes/audit-logs');
const helpRoutes = require('./routes/help');

app.use('/auth', authRoutes);
app.use('/companies', companyRoutes);
app.use('/users', userRoutes);
app.use('/profiles', profileRoutes);
app.use('/profiles/:id/queue', queueRoutes);
app.use('/stats', statsRoutes);
app.use('/blacklist', blacklistRoutes);
app.use('/announcements', announcementRoutes);
app.use('/audit-logs', auditLogRoutes);
app.use('/help', helpRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
