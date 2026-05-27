// routes/picks.js - Stock pick management

const express = require('express');

const https = require('https');

const db = require('../database');

const { authenticate } = require('../middleware/auth');

const { broadcastLeaderboard, broadcastPickChange } = require('../websocket');



const router = express.Router();



// All pick routes require authentication

router.use(authenticate);



// Crypto symbol map for Finnhub (uses Binance exchange prefix)

const CRYPTO_MAP = {

  'BTC': 'BINANCE:BTCUSDT', 'ETH': 'BINANCE:ETHUSDT', 'SOL': 'BINANCE:SOLUSDT',

  'ADA': 'BINANCE:ADAUSDT', 'DOGE': 'BINANCE:DOGEUSDT', 'XRP': 'BINANCE:XRPUSDT',

  'AVAX': 'BINANCE:AVAXUSDT', 'DOT': 'BINANCE:DOTUSDT', 'LINK': 'BINANCE:LINKUSDT',

  'MATIC': 'BINANCE:MATICUSDT', 'BNB': 'BINANCE:BNBUSDT', 'SHIB': 'BINANCE:SHIBUSDT',

  'UNI': 'BINANCE:UNIUSDT', 'ATOM': 'BINANCE:ATOMUSDT', 'LTC': 'BINANCE:LTCUSDT',

  'FIL': 'BINANCE:FILUSDT', 'APT': 'BINANCE:APTUSDT', 'ARB': 'BINANCE:ARBUSDT',

  'OP': 'BINANCE:OPUSDT', 'NEAR': 'BINANCE:NEARUSDT', 'ICP': 'BINANCE:ICPUSDT',

  'IMX': 'BINANCE:IMXUSDT', 'AAVE': 'BINANCE:AAVEUSDT', 'MKR': 'BINANCE:MKRUSDT',

  'PEPE': 'BINANCE:PEPEUSDT'

};



// ============ PRICE FETCHING VIA FINNHUB ============



function fetchPrice(symbol, type) {

  return new Promise(function(resolve, reject) {

    var apiKey = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';

    // Key hardcoded



    var finnhubSymbol = type === 'crypto'

      ? (CRYPTO_MAP[symbol] || 'BINANCE:' + symbol + 'USDT')

      : symbol;



    var url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(finnhubSymbol) + '&token=' + apiKey;



    https.get(url, function(res) {

      var data = '';

      res.on('data', function(chunk) { data += chunk; });

      res.on('end', function() {

        try {

          var json = JSON.parse(data);

          // json.c = current price, json.pc = previous close

          if (json.c && json.c > 0) {

            resolve(json.c);

          } else if (json.pc && json.pc > 0) {

            resolve(json.pc);

          } else {

            reject(new Error('No price data for ' + symbol));

          }

        } catch (e) {

          reject(new Error('Parse error'));

        }

      });

    }).on('error', function(err) {

      reject(err);

    });

  });

}



// ============ ROUTES ============



// GET /api/picks - get current user picks for active competition

router.get('/', function(req, res) {

  var compId = req.query.competition_id;



  var picks;

  if (compId) {

    picks = db.prepare(

      'SELECT p.*, c.status as comp_status FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE p.user_id = ? AND p.competition_id = ? ORDER BY p.added_at DESC'

    ).all(req.user.id, compId);

  } else {

    picks = db.prepare(

      "SELECT p.*, c.status as comp_status, c.name as comp_name FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE p.user_id = ? AND c.status IN ('drafting', 'active') ORDER BY p.added_at DESC"

    ).all(req.user.id);

  }



  res.json({ picks: picks });

});



// GET /api/picks/user/:userId - get another user picks

router.get('/user/:userId', function(req, res) {

  var compId = req.query.competition_id;

  if (!compId) {

    return res.status(400).json({ error: 'competition_id required' });

  }

  var picks = db.prepare(

    'SELECT symbol, name, type, entry_price, current_price, return_pct, added_at FROM picks WHERE user_id = ? AND competition_id = ? ORDER BY return_pct DESC'

  ).all(req.params.userId, compId);

  res.json({ picks: picks });

});



// POST /api/picks - add a pick (instant price lock)

router.post('/', function(req, res) {

  var symbol = req.body.symbol;

  var name = req.body.name;

  var type = req.body.type;

  var compId = req.body.competition_id;



  if (!symbol || !name || !type) {

    return res.status(400).json({ error: 'symbol, name, and type required' });

  }

  if (['stock', 'etf', 'crypto'].indexOf(type) === -1) {

    return res.status(400).json({ error: 'type must be stock, etf, or crypto' });

  }



  // Find active/drafting competition

  var comp;

  if (compId) {

    comp = db.prepare("SELECT * FROM competitions WHERE id = ? AND status IN ('drafting', 'active')").get(compId);

  } else {

    comp = db.prepare("SELECT * FROM competitions WHERE status IN ('drafting', 'active') ORDER BY created_at DESC LIMIT 1").get();

  }

  if (!comp) return res.status(400).json({ error: 'No active competition' });



  // Check pick count (max 10)

  var count = db.prepare('SELECT COUNT(*) as cnt FROM picks WHERE user_id = ? AND competition_id = ?').get(req.user.id, comp.id);

  if (count.cnt >= 10) {

    return res.status(400).json({ error: 'Maximum 10 picks allowed' });

  }



  // Check duplicate

  var exists = db.prepare('SELECT id FROM picks WHERE user_id = ? AND competition_id = ? AND symbol = ?').get(req.user.id, comp.id, symbol.toUpperCase());

  if (exists) return res.status(400).json({ error: 'Already picked ' + symbol });



  // Fetch live price and lock immediately

  fetchPrice(symbol.toUpperCase(), type).then(function(entryPrice) {

    var result = db.prepare(

      'INSERT INTO picks (user_id, competition_id, symbol, name, type, entry_price, current_price, locked) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'

    ).run(req.user.id, comp.id, symbol.toUpperCase(), name, type, entryPrice, entryPrice);



    var pick = {

      id: result.lastInsertRowid,

      symbol: symbol.toUpperCase(),

      name: name,

      type: type,

      entry_price: entryPrice,

      current_price: entryPrice,

      return_pct: 0,

      locked: 1

    };



    res.status(201).json({ pick: pick });



    // Broadcast the pick change

    try { broadcastPickChange(req.user.id, comp.id); } catch(e) {}

  }).catch(function(err) {

    console.error('Price fetch error for ' + symbol + ':', err.message);

    res.status(400).json({ error: 'Could not get price for ' + symbol + '. Try again in a moment.' });

  });

});



// DELETE /api/picks/:id - remove a pick

router.delete('/:id', function(req, res) {

  var pick = db.prepare('SELECT p.*, c.status as comp_status FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE p.id = ? AND p.user_id = ?').get(req.params.id, req.user.id);



  if (!pick) return res.status(404).json({ error: 'Pick not found' });

  if (pick.comp_status === 'ended') return res.status(400).json({ error: 'Competition has ended' });



  db.prepare('DELETE FROM picks WHERE id = ?').run(req.params.id);

  res.json({ message: 'Removed ' + pick.symbol });



  try { broadcastPickChange(req.user.id, pick.competition_id); } catch(e) {}

});



module.exports = router;

