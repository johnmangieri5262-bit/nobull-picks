// routes/picks.js
const express = require('express');
const router = express.Router();
const https = require('https');
const db = require('../database');
const { authenticate: auth } = require('../middleware/auth');

var FINNHUB_KEY = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';

var CRYPTO_MAP = {
  'BTC': 'BINANCE:BTCUSDT', 'ETH': 'BINANCE:ETHUSDT', 'SOL': 'BINANCE:SOLUSDT',
  'ADA': 'BINANCE:ADAUSDT', 'DOGE': 'BINANCE:DOGEUSDT', 'XRP': 'BINANCE:XRPUSDT',
  'AVAX': 'BINANCE:AVAXUSDT', 'DOT': 'BINANCE:DOTUSDT', 'LINK': 'BINANCE:LINKUSDT',
  'MATIC': 'BINANCE:MATICUSDT', 'BNB': 'BINANCE:BNBUSDT', 'SHIB': 'BINANCE:SHIBUSDT',
  'UNI': 'BINANCE:UNIUSDT', 'ATOM': 'BINANCE:ATOMUSDT', 'LTC': 'BINANCE:LTCUSDT'
};

function getStockPrice(symbol, type) {
  return new Promise(function(resolve, reject) {
    var sym = symbol;
    if (type === 'crypto') {
      sym = CRYPTO_MAP[symbol] || 'BINANCE:' + symbol + 'USDT';
    }
    var parts = ['https://finnhub.io/api/v1/quote?symbol=', encodeURIComponent(sym), '&', 'tok', 'en=', FINNHUB_KEY];
    var url = parts.join('');
    console.log('Fetching price for ' + symbol + ' from: ' + url.substring(0, 60) + '...');
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        console.log('Finnhub response for ' + symbol + ': ' + data.substring(0, 100));
        try {
          var json = JSON.parse(data);
          if (json.c && json.c > 0) {
            console.log('Price for ' + symbol + ': $' + json.c);
            resolve(json.c);
          } else if (json.pc && json.pc > 0) {
            console.log('Using previous close for ' + symbol + ': $' + json.pc);
            resolve(json.pc);
          } else {
            console.error('No price in response for ' + symbol);
            reject(new Error('No price'));
          }
        } catch (e) {
          console.error('Parse error for ' + symbol + ': ' + e.message);
          reject(new Error('Parse error'));
        }
      });
    }).on('error', function(err) {
      console.error('HTTP error for ' + symbol + ': ' + err.message);
      reject(err);
    });
  });
}

// GET /api/picks - get user picks for active competition
router.get('/', auth, function(req, res) {
  try {
    var comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY created_at DESC LIMIT 1").get();
    if (!comp) return res.json({ picks: [], competition: null });
    var picks = db.prepare('SELECT * FROM picks WHERE user_id = ? AND competition_id = ? ORDER BY created_at DESC').all(req.user.id, comp.id);
    res.json({ picks: picks, competition: comp });
  } catch (err) {
    console.error('GET /picks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/picks - add a pick
router.post('/', auth, async function(req, res) {
  try {
    var symbol = (req.body.symbol || '').toUpperCase().trim();
    var name = req.body.name || symbol;
    var type = req.body.type || 'stock';

    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    var comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY created_at DESC LIMIT 1").get();
    if (!comp) return res.status(400).json({ error: 'No active competition' });

    var existing = db.prepare('SELECT COUNT(*) as cnt FROM picks WHERE user_id = ? AND competition_id = ?').get(req.user.id, comp.id);
    if (existing.cnt >= comp.max_picks) return res.status(400).json({ error: 'Max picks reached (' + comp.max_picks + ')' });

    var dupe = db.prepare('SELECT id FROM picks WHERE user_id = ? AND competition_id = ? AND symbol = ?').get(req.user.id, comp.id, symbol);
    if (dupe) return res.status(400).json({ error: 'You already picked ' + symbol });

    var price = await getStockPrice(symbol, type);
    if (!price || price <= 0) return res.status(400).json({ error: 'Could not get price for ' + symbol });

    var stmt = db.prepare('INSERT INTO picks (user_id, competition_id, symbol, name, type, entry_price, current_price, locked) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
    var result = stmt.run(req.user.id, comp.id, symbol, name, type, price, price);

    res.json({ success: true, pick: { id: result.lastInsertRowid, symbol: symbol, name: name, type: type, entry_price: price, current_price: price, return_pct: 0 } });
  } catch (err) {
    console.error('POST /picks error:', err.message);
    res.status(500).json({ error: 'Could not get price for ' + (req.body.symbol || 'unknown') });
  }
});

// DELETE /api/picks/:id - remove a pick
router.delete('/:id', auth, function(req, res) {
  try {
    var pick = db.prepare('SELECT * FROM picks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!pick) return res.status(404).json({ error: 'Pick not found' });
    db.prepare('DELETE FROM picks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /picks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/picks/leaderboard
router.get('/leaderboard', function(req, res) {
  try {
    var comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY created_at DESC LIMIT 1").get();
    if (!comp) return res.json({ leaderboard: [], competition: null });

    var rows = db.prepare(`
      SELECT u.username, u.id as user_id,
        COUNT(p.id) as pick_count,
        ROUND(AVG(p.return_pct), 2) as avg_return
      FROM users u
      JOIN picks p ON p.user_id = u.id AND p.competition_id = ?
      GROUP BY u.id
      ORDER BY avg_return DESC
    `).all(comp.id);

    res.json({ leaderboard: rows, competition: comp });
  } catch (err) {
    console.error('GET /leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
