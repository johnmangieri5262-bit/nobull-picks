// routes/picks.js — Stock pick management
const express = require('express');
const https = require('https');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { broadcastLeaderboard, broadcastPickChange } = require('../websocket');

const router = express.Router();

// All pick routes require authentication
router.use(authenticate);

// Crypto symbol map for Yahoo Finance
const CRYPTO_MAP = {
  'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD',
  'ADA': 'ADA-USD', 'DOGE': 'DOGE-USD', 'XRP': 'XRP-USD',
  'AVAX': 'AVAX-USD', 'DOT': 'DOT-USD', 'LINK': 'LINK-USD',
  'MATIC': 'MATIC-USD', 'BNB': 'BNB-USD', 'SHIB': 'SHIB-USD',
  'UNI': 'UNI-USD', 'ATOM': 'ATOM-USD', 'LTC': 'LTC-USD',
  'FIL': 'FIL-USD', 'APT': 'APT-USD', 'ARB': 'ARB-USD',
  'OP': 'OP-USD', 'NEAR': 'NEAR-USD', 'ICP': 'ICP-USD',
  'IMX': 'IMX-USD', 'AAVE': 'AAVE-USD', 'MKR': 'MKR-USD',
  'PEPE': 'PEPE-USD'
};

// Fetch price using raw HTTPS to Yahoo Finance v8 API (no ESM import needed)
function fetchYahooPrice(symbol, type) {
  return new Promise(function(resolve, reject) {
    var yahooSymbol = type === 'crypto'
      ? (CRYPTO_MAP[symbol] || symbol + '-USD')
      : symbol;

    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?interval=1d&range=1d';

    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          var meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
          if (meta && meta.regularMarketPrice) {
            resolve(meta.regularMarketPrice);
          } else {
            reject(new Error('No price in response'));
          }
        } catch (e) {
          reject(new Error('Parse error: ' + e.message));
        }
      });
    }).on('error', function(err) {
      reject(err);
    });
  });
}

// GET /api/picks — get current user's picks for active competition
router.get('/', function(req, res) {
  var compId = req.query.competition_id;
  
  var picks;
  if (compId) {
    picks = db.prepare(
      'SELECT p.*, c.status as comp_status FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE p.user_id = ? AND p.competition_id = ? ORDER BY p.added_at DESC'
    ).all(req.user.id, compId);
  } else {
    picks = db.prepare(
      'SELECT p.*, c.status as comp_status, c.name as comp_name FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE p.user_id = ? AND c.status IN (\'drafting\', \'active\') ORDER BY p.added_at DESC'
    ).all(req.user.id);
  }

  res.json({ picks: picks });
});

// GET /api/picks/user/:userId — get another user's picks (public view)
router.get('/user/:userId', function(req, res) {
  var compId = req.query.competition_id;
  if (!compId) {
    return res.status(400).json({ error: 'competition_id required' });
  }

  var picks = db.prepare(
    'SELECT p.symbol, p.name, p.type, p.return_pct, p.entry_price, p.current_price FROM picks p WHERE p.user_id = ? AND p.competition_id = ? ORDER BY p.return_pct DESC'
  ).all(req.params.userId, compId);

  res.json({ picks: picks });
});

// POST /api/picks — add a pick (immediately locks in current price)
router.post('/', function(req, res) {
  var symbol = req.body.symbol;
  var name = req.body.name;
  var type = req.body.type;
  var competition_id = req.body.competition_id;

  // Validate inputs
  if (!symbol || !name || !type || !competition_id) {
    return res.status(400).json({ error: 'symbol, name, type, and competition_id required' });
  }
  if (['stock', 'etf', 'crypto'].indexOf(type) === -1) {
    return res.status(400).json({ error: 'type must be stock, etf, or crypto' });
  }

  // Verify competition is in drafting or active phase
  var comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(competition_id);
  if (!comp) return res.status(404).json({ error: 'Competition not found' });
  if (comp.status !== 'drafting' && comp.status !== 'active') {
    return res.status(400).json({ error: 'Competition is not accepting picks' });
  }

  // Check pick count (max 10)
  var count = db.prepare(
    'SELECT COUNT(*) as cnt FROM picks WHERE user_id = ? AND competition_id = ?'
  ).get(req.user.id, competition_id);
  
  if (count.cnt >= 10) {
    return res.status(400).json({ error: 'Maximum 10 picks allowed' });
  }

  // Check for duplicate
  var exists = db.prepare(
    'SELECT id FROM picks WHERE user_id = ? AND competition_id = ? AND symbol = ?'
  ).get(req.user.id, competition_id, symbol.toUpperCase());
  
  if (exists) {
    return res.status(400).json({ error: 'Already picked ' + symbol });
  }

  // Fetch current price from Yahoo Finance — this IS the entry price
  fetchYahooPrice(symbol.toUpperCase(), type).then(function(entryPrice) {
    // Insert pick with price locked immediately
    var result = db.prepare(
      'INSERT INTO picks (user_id, competition_id, symbol, name, type, entry_price, current_price, locked) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
    ).run(req.user.id, competition_id, symbol.toUpperCase(), name, type, entryPrice, entryPrice);

    // Record in price history
    db.prepare('INSERT INTO price_history (symbol, price) VALUES (?, ?)').run(symbol.toUpperCase(), entryPrice);

    // Broadcast to all WebSocket clients
    broadcastPickChange(competition_id, 'added', { symbol: symbol.toUpperCase(), user: req.user.id });
    broadcastLeaderboard(competition_id);

    res.status(201).json({
      pick: {
        id: result.lastInsertRowid,
        symbol: symbol.toUpperCase(),
        name: name,
        type: type,
        competition_id: competition_id,
        entry_price: entryPrice,
        current_price: entryPrice,
        return_pct: 0,
        locked: 1
      }
    });
  }).catch(function(err) {
    console.error('Price fetch error for ' + symbol + ':', err.message);
    res.status(400).json({ error: 'Could not get price for ' + symbol + '. Verify the ticker is valid and try again.' });
  });
});

// DELETE /api/picks/:id — remove a pick
router.delete('/:id', function(req, res) {
  var pick = db.prepare(
    'SELECT p.*, c.status as comp_status FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE p.id = ? AND p.user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!pick) return res.status(404).json({ error: 'Pick not found' });
  if (pick.comp_status === 'ended') {
    return res.status(400).json({ error: 'Competition has ended' });
  }

  db.prepare('DELETE FROM picks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

  broadcastPickChange(pick.competition_id, 'removed', { symbol: pick.symbol, user: req.user.id });
  broadcastLeaderboard(pick.competition_id);

  res.json({ message: 'Removed ' + pick.symbol });
});

// GET /api/picks/portfolio — get portfolio summary for current user
router.get('/portfolio', function(req, res) {
  var compId = req.query.competition_id;
  if (!compId) return res.status(400).json({ error: 'competition_id required' });

  var picks = db.prepare(
    'SELECT * FROM picks WHERE user_id = ? AND competition_id = ? ORDER BY return_pct DESC'
  ).all(req.user.id, compId);

  if (picks.length === 0) {
    return res.json({ portfolio: { picks: [], avg_return: 0, best: null, worst: null, count: 0 } });
  }

  var totalReturn = 0;
  for (var i = 0; i < picks.length; i++) {
    totalReturn += (picks[i].return_pct || 0);
  }
  var avgReturn = totalReturn / picks.length;

  res.json({
    portfolio: {
      picks: picks,
      avg_return: Math.round(avgReturn * 100) / 100,
      best: { symbol: picks[0].symbol, return_pct: picks[0].return_pct },
      worst: { symbol: picks[picks.length - 1].symbol, return_pct: picks[picks.length - 1].return_pct },
      count: picks.length
    }
  });
});

module.exports = router;


