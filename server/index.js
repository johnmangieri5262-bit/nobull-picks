// index.js — NoBull Picks Server

require('dotenv').config();



const express = require('express');

const cors = require('cors');

const helmet = require('helmet');

const http = require('http');

const rateLimit = require('express-rate-limit');

const path = require('path');

const cron = require('node-cron');



const db = require('./database');

const authRoutes = require('./routes/auth');

const competitionsRoutes = require('./routes/competitions');

const picksRoutes = require('./routes/picks');

const leaguesRoutes = require('./routes/leagues');

const adminRoutes = require('./routes/admin');

const { initWebSocket, broadcastLeaderboard, broadcastPriceUpdate, broadcastStatusChange, getStats } = require('./websocket');

const { fetchPrices } = require('./jobs/fetchPrices');



// ==================== AUTO-SEED ====================

// Ensure Q3 2026 competition exists on every startup

(function autoSeed() {

  const existing = db.prepare('SELECT id FROM competitions LIMIT 1').get();

  if (!existing) {

    db.prepare(`

      INSERT INTO competitions (name, type, quarter, year, draft_start, lock_date, end_date, status)

      VALUES (?, ?, ?, ?, ?, ?, ?, ?)

    `).run('Q3 2026', 'quarterly', 'Q3', 2026, '2026-06-01', '2026-07-01', '2026-09-30', 'drafting');

    console.log('Auto-seeded Q3 2026 competition (drafting)');

  }

})();



const app = express();

const server = http.createServer(app);

const PORT = process.env.PORT || 3000;



// ==================== MIDDLEWARE ====================

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({

  origin: process.env.CORS_ORIGIN || '*',

  credentials: true

}));

app.use(express.json());



// Rate limiting

const apiLimiter = rateLimit({

  windowMs: 15 * 60 * 1000,

  max: 100,

  message: { error: 'Too many requests, try again later' }

});

app.use('/api/', apiLimiter);



const authLimiter = rateLimit({

  windowMs: 15 * 60 * 1000,

  max: 20,

  message: { error: 'Too many auth attempts, try again later' }

});

app.use('/api/auth/', authLimiter);



// ==================== API ROUTES ====================

app.use('/api/auth', authRoutes);

app.use('/api/competitions', competitionsRoutes);

app.use('/api/picks', picksRoutes);

app.use('/api/leagues', leaguesRoutes);

app.use('/api/admin', adminRoutes);



// Health check

app.get('/api/health', (req, res) => {

  res.json({ 

    status: 'ok', 

    timestamp: new Date().toISOString(),

    uptime: process.uptime(),

    websocket: getStats()

  });

});



// ==================== SERVE FRONTEND ====================

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {

  if (!req.path.startsWith('/api')) {

    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));

  }

});



// ==================== SCHEDULED JOBS ====================

function updateCompetitionStatuses() {

  const now = new Date().toISOString().split('T')[0];

  

  db.prepare(`

    UPDATE competitions SET status = 'drafting' 

    WHERE status = 'upcoming' AND draft_start <= ?

  `).run(now);



  const toLock = db.prepare(`

    SELECT id FROM competitions WHERE status = 'drafting' AND lock_date <= ?

  `).all(now);

  

  for (const comp of toLock) {

    db.prepare(`

      UPDATE picks SET locked = 1, entry_price = COALESCE(current_price, entry_price)

      WHERE competition_id = ? AND locked = 0

    `).run(comp.id);

    

    const underMin = db.prepare(`

      SELECT user_id FROM picks WHERE competition_id = ? GROUP BY user_id HAVING COUNT(*) < 3

    `).all(comp.id);

    for (const u of underMin) {

      db.prepare('DELETE FROM picks WHERE competition_id = ? AND user_id = ?').run(comp.id, u.user_id);

    }



    db.prepare('UPDATE competitions SET status = ? WHERE id = ?').run('active', comp.id);

    console.log(`Competition ${comp.id} is now ACTIVE. Picks locked.`);

  }



  db.prepare(`

    UPDATE competitions SET status = 'ended' 

    WHERE status = 'active' AND end_date < ?

  `).run(now);

}



// Run status check every hour

cron.schedule('0 * * * *', () => {

  console.log('Running competition status check...');

  updateCompetitionStatuses();

});



// Fetch prices on a schedule

const priceCron = process.env.PRICE_CRON || '*/5 9-16 * * 1-5';

cron.schedule(priceCron, () => {

  fetchPrices().then(() => {

    const activeComps = db.prepare("SELECT id FROM competitions WHERE status = 'active'").all();

    activeComps.forEach(c => broadcastLeaderboard(c.id));

  }).catch(err => console.error('Price fetch failed:', err.message));



});



// Crypto prices every 15 min on weekends

cron.schedule('*/15 * * * 0,6', () => {

  fetchPrices().then(() => {

    const activeComps = db.prepare("SELECT id FROM competitions WHERE status = 'active'").all();

    activeComps.forEach(c => broadcastLeaderboard(c.id));

  }).catch(err => console.error('Weekend price fetch failed:', err.message));



});



// ==================== STARTUP ====================

initWebSocket(server);



server.listen(PORT, () => {

  console.log(`

  ╔══════════════════════════════════════════╗

  ║   NoBull Picks Server                   ║

  ║   HTTP + WebSocket on :${PORT}             ║

  ╚══════════════════════════════════════════╝

  `);

  

  updateCompetitionStatuses();

});



module.exports = app;
