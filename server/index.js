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
// Auto-seed NoBull Official picks
async function seedOfficialPicks() {
  try {
    var existing = db.prepare("SELECT id FROM users WHERE username = 'nobull_official'").get();
    if (existing) return; // Already seeded

    var bcrypt = require('bcrypt');
    var hash = bcrypt.hashSync('nobull2026official', 10);
    var result = db.prepare("INSERT INTO users (username, display_name, pw_hash) VALUES (?, ?, ?)").run('nobull_official', 'NoBull Official', hash);
    var userId = result.lastInsertRowid;
    console.log('Created NoBull Official user, id=' + userId);

    var comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY id DESC LIMIT 1").get();
    if (!comp) { console.log('No competition for official picks'); return; }

    var https = require('https');
    var FINNHUB_KEY = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';

    function fetchPrice(symbol) {
      return new Promise(function(resolve) {
        var parts = ['https://finnhub.io/api/v1/quote?symbol=', encodeURIComponent(symbol), String.fromCharCode(38), 'tok', 'en=', FINNHUB_KEY];
        var url = parts.join('');
        https.get(url, function(res) {
          var data = '';
          res.on('data', function(chunk) { data += chunk; });
          res.on('end', function() {
            try { var j = JSON.parse(data); resolve(j.c > 0 ? j.c : (j.pc > 0 ? j.pc : 0)); }
            catch(e) { resolve(0); }
          });
        }).on('error', function() { resolve(0); });
      });
    }

    var picks = [
      { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock' },
      { symbol: 'CEG', name: 'Constellation Energy', type: 'stock' },
      { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'stock' },
      { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock' },
      { symbol: 'TSM', name: 'Taiwan Semiconductor', type: 'stock' },
      { symbol: 'TJX', name: 'TJX Companies', type: 'stock' }
    ];

    for (var i = 0; i < picks.length; i++) {
      var p = picks[i];
      var price = await fetchPrice(p.symbol);
      if (price > 0) {
        db.prepare('INSERT INTO picks (user_id, competition_id, symbol, name, type, entry_price, current_price, locked) VALUES (?, ?, ?, ?, ?, ?, ?, 1)').run(userId, comp.id, p.symbol, p.name, p.type, price, price);
        console.log('  Official pick: ' + p.symbol + ' @ $' + price.toFixed(2));
      }
      await new Promise(function(r) { setTimeout(r, 1200); });
    }
    console.log('NoBull Official picks seeded!');
  } catch(err) {
    console.error('seedOfficialPicks error:', err.message);
  }
}

seedOfficialPicks();

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
app.use('/api/official', require('./routes/official'));
app.use('/api/leagues', leaguesRoutes);
app.use('/api/admin', adminRoutes);


// TEMPORARY: Wipe test data (remove this after testing)
app.get('/api/admin/wipe-test-data', (req, res) => {
  db.prepare('DELETE FROM picks').run();
  db.prepare('DELETE FROM league_picks').run();
  db.prepare('DELETE FROM league_members').run();
  db.prepare('DELETE FROM leagues').run();
  db.prepare('DELETE FROM price_history').run();
  res.json({ message: 'All picks, leagues, and price history wiped. Users kept.' });
});
// TEMPORARY: Wipe test data (remove after testing)
app.get('/api/wipe-nobull-2026', (req, res) => {
  db.prepare('DELETE FROM picks').run();
  db.prepare('DELETE FROM league_picks').run();
  db.prepare('DELETE FROM league_members').run();
  db.prepare('DELETE FROM leagues').run();
  db.prepare('DELETE FROM price_history').run();
  res.json({ message: 'All picks, leagues, and price history wiped. Users kept.' });
});
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
