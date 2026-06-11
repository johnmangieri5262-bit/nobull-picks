// routes/picks.js
const express = require('express');
const router = express.Router();
const https = require('https');
const db = require('../database');
const { authenticate: auth } = require('../middleware/auth');

var FINNHUB_KEY = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';

var CRYPTO_IDS = {
  'BTC': 'btc-bitcoin', 'ETH': 'eth-ethereum', 'SOL': 'sol-solana',
  'ADA': 'ada-cardano', 'DOGE': 'doge-dogecoin', 'XRP': 'xrp-xrp',
  'AVAX': 'avax-avalanche', 'DOT': 'dot-polkadot', 'LINK': 'link-chainlink',
  'MATIC': 'matic-polygon', 'BNB': 'bnb-binance-coin', 'SHIB': 'shib-shiba-inu',
  'UNI': 'uni-uniswap', 'ATOM': 'atom-cosmos', 'LTC': 'ltc-litecoin',
  'FIL': 'fil-filecoin', 'APT': 'apt-aptos', 'ARB': 'arb-arbitrum',
  'OP': 'op-optimism', 'NEAR': 'near-near-protocol', 'ICP': 'icp-internet-computer',
  'IMX': 'imx-immutable-x', 'AAVE': 'aave-new', 'MKR': 'mkr-maker', 'PEPE': 'pepe-pepe'
};

var CRYPTO_SYMBOLS = Object.keys(CRYPTO_IDS);

function getStockPrice(symbol, type) {
  if (type === 'crypto' || CRYPTO_SYMBOLS.indexOf(symbol) !== -1) {
    return getCryptoPrice(symbol);
  }
  return getFinnhubPrice(symbol);
}

function getFinnhubPrice(symbol) {
  return new Promise(function(resolve, reject) {
    var parts = ['https://finnhub.io/api/v1/quote?symbol=', encodeURIComponent(symbol), String.fromCharCode(38), 'tok', 'en=', FINNHUB_KEY];
    var url = parts.join('');
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.c && json.c > 0) { resolve(json.c); }
          else if (json.pc && json.pc > 0) { resolve(json.pc); }
          else { reject(new Error('No price for ' + symbol)); }
        } catch (e) { reject(new Error('Parse error')); }
      });
    }).on('error', reject);
  });
}

function getCryptoPrice(symbol) {
  return new Promise(function(resolve, reject) {
    var coinId = CRYPTO_IDS[symbol] || symbol.toLowerCase() + '-' + symbol.toLowerCase();
    var options = {
      hostname: 'api.coinpaprika.com',
      path: '/v1/tickers/' + coinId,
      method: 'GET',
      headers: { 'User-Agent': 'NoBullPicks/1.0', 'Accept': 'application/json' }
    };
    console.log('Crypto fetch: ' + coinId);
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        console.log('Crypto response (' + res.statusCode + '): ' + data.substring(0, 120));
        try {
          var json = JSON.parse(data);
          if (json.quotes && json.quotes.USD && json.quotes.USD.price > 0) {
            resolve(json.quotes.USD.price);
          } else { reject(new Error('No crypto price for ' + symbol)); }
        } catch (e) { reject(new Error('Crypto parse error: ' + data.substring(0, 50))); }
      });
    });
    req.on('error', function(err) {
      console.error('Crypto request error: ' + err.message);
      reject(err);
    });
    req.end();
  });
}

// Helper: check if US stock market is currently open
function isMarketOpen() {
  var now = new Date();
  var etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  var et = new Date(etStr);
  var hour = et.getHours();
  var min = et.getMinutes();
  var day = et.getDay();
  return day >= 1 && day <= 5 && ((hour > 9 || (hour === 9 && min >= 30)) && hour < 16);
}

// GET /api/picks
router.get('/', auth, function(req, res) {
  try {
    var comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY id DESC LIMIT 1").get();
    if (!comp) return res.json({ picks: [], competition: null });
    var picks = db.prepare('SELECT * FROM picks WHERE user_id = ? AND competition_id = ? ORDER BY id DESC').all(req.user.id, comp.id);
    res.json({ picks: picks, competition: comp });
  } catch (err) {
    console.error('GET /picks error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/picks
router.post('/', auth, async function(req, res) {
  try {
    var symbol = (req.body.symbol || '').toUpperCase().trim();
    var name = req.body.name || symbol;
    var type = req.body.type || 'stock';

    if (!symbol) return res.status(400).json({ error: 'Symbol required' });

    var comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY id DESC LIMIT 1").get();
    if (!comp) return res.status(400).json({ error: 'No active competition' });

    var existing = db.prepare('SELECT COUNT(*) as cnt FROM picks WHERE user_id = ? AND competition_id = ?').get(req.user.id, comp.id);
    if (existing.cnt >= 10) return res.status(400).json({ error: 'Max picks reached (10)' });

    var dupe = db.prepare('SELECT id FROM picks WHERE user_id = ? AND competition_id = ? AND symbol = ?').get(req.user.id, comp.id, symbol);
    if (dupe) return res.status(400).json({ error: 'You already picked ' + symbol });

    var price = await getStockPrice(symbol, type);
    if (!price || price <= 0) return res.status(400).json({ error: 'Could not get price for ' + symbol });

    // Queue picks added outside market hours — entry price fills on next trading session
    var isCrypto = (type === 'crypto' || CRYPTO_SYMBOLS.indexOf(symbol) !== -1);
    if (!isMarketOpen() && !isCrypto) {
      // Stock/ETF added after hours: save with entry_price = 0 (pending)
      var stmt = db.prepare('INSERT INTO picks (user_id, competition_id, symbol, name, type, entry_price, current_price, locked) VALUES (?, ?, ?, ?, ?, 0, 0, 1)');
      var result = stmt.run(req.user.id, comp.id, symbol, name, type);
      return res.json({ success: true, pick: { id: result.lastInsertRowid, symbol: symbol, name: name, type: type, entry_price: 0, current_price: 0, return_pct: 0, added_at: new Date().toISOString() }, queued: true, message: symbol + ' queued! Entry price locks at next market open.' });
    }

    var stmt = db.prepare('INSERT INTO picks (user_id, competition_id, symbol, name, type, entry_price, current_price, locked) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
    var result = stmt.run(req.user.id, comp.id, symbol, name, type, price, price);

    res.json({ success: true, pick: { id: result.lastInsertRowid, symbol: symbol, name: name, type: type, entry_price: price, current_price: price, return_pct: 0, added_at: new Date().toISOString() } });
  } catch (err) {
    console.error('POST /picks error:', err.message);
    res.status(500).json({ error: 'Could not get price for ' + (req.body.symbol || 'unknown') });
  }
});

// DELETE /api/picks/:id
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
    var comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY id DESC LIMIT 1").get();
    if (!comp) return res.json({ leaderboard: [], competition: null });

    var rows = db.prepare("SELECT u.username, u.display_name, u.id as user_id, COUNT(p.id) as pick_count, ROUND(AVG(p.return_pct), 2) as avg_return FROM users u JOIN picks p ON p.user_id = u.id AND p.competition_id = ? WHERE p.entry_price > 0 GROUP BY u.id ORDER BY avg_return DESC").all(comp.id);

    var leaderboard = rows.map(function(r, i) {
      return { rank: i + 1, user_id: r.user_id, username: r.username, display_name: r.display_name || r.username, pick_count: r.pick_count, avg_return: r.avg_return || 0 };
    });

    res.json({ leaderboard: leaderboard, competition: comp });
  } catch (err) {
    console.error('GET /leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
