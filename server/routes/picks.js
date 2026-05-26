// routes/picks.js - Stock pick management

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



// ============ ROBUST PRICE FETCHING (multiple fallbacks) ============



function fetchYahooPrice(symbol, type) {

  return new Promise(function(resolve, reject) {

    var yahooSymbol = type === 'crypto'

      ? (CRYPTO_MAP[symbol] || symbol + '-USD')

      : symbol;

    

    // Method 1: query2 v8 chart

    var url1 = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?interval=1d&range=1d';

    tryChartFetch(url1, function(price) {

      if (price) return resolve(price);

      

      // Method 2: query1 v8 chart with range=5d

      var url2 = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?interval=1d&range=5d';

      tryChartFetch(url2, function(price2) {

        if (price2) return resolve(price2);

        

        // Method 3: scrape quote page

        var url3 = 'https://finance.yahoo.com/quote/' + encodeURIComponent(yahooSymbol) + '/';

        scrapeQuotePage(url3, function(price3) {

          if (price3) return resolve(price3);

          reject(new Error('All price methods failed for ' + symbol));

        });

      });

    });

  });

}



function tryChartFetch(url, callback) {

  var options = {

    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }

  };

  https.get(url, options, function(res) {

    if (res.statusCode !== 200) {

      res.resume();

      callback(null);

      return;

    }

    var data = '';

    res.on('data', function(chunk) { data += chunk; });

    res.on('end', function() {

      try {

        var json = JSON.parse(data);

        var meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;

        if (meta && meta.regularMarketPrice) {

          callback(meta.regularMarketPrice);

        } else {

          callback(null);

        }

      } catch (e) {

        callback(null);

      }

    });

  }).on('error', function() { callback(null); });

}



function scrapeQuotePage(url, callback) {

  var options = {

    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }

  };

  

  function handleResponse(res) {

    // Follow redirects

    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {

      if (res.headers.location) {

        var redirectUrl = res.headers.location;

        if (redirectUrl.startsWith('/')) redirectUrl = 'https://finance.yahoo.com' + redirectUrl;

        https.get(redirectUrl, options, handleResponse).on('error', function() { callback(null); });

        res.resume();

      } else {

        callback(null);

      }

      return;

    }

    if (res.statusCode !== 200) {

      res.resume();

      callback(null);

      return;

    }

    var data = '';

    res.on('data', function(chunk) { data += chunk; });

    res.on('end', function() {

      // Try multiple regex patterns for the price

      var patterns = [

        /"regularMarketPrice":\s*\{[^}]*"raw":\s*([\d.]+)/,

        /"regularMarketPrice":\s*([\d.]+)/,

        /data-field="regularMarketPrice"[^>]*value="([\d.]+)"/,

        /Fw\(700\)[^>]*>([\d,.]+)<\/fin-streamer>/

      ];

      for (var i = 0; i < patterns.length; i++) {

        var match = data.match(patterns[i]);

        if (match) {

          var price = parseFloat(match[1].replace(/,/g, ''));

          if (price > 0) {

            callback(price);

            return;

          }

        }

      }

      callback(null);

    });

  }

  

  https.get(url, options, handleResponse).on('error', function() { callback(null); });

}



// ============ ROUTES ============



// GET /api/picks - get current user's picks for active competition

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



// GET /api/picks/user/:userId - get another user's picks

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

  fetchYahooPrice(symbol.toUpperCase(), type).then(function(entryPrice) {

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



// DELETE /api/picks/:id - remove a pick (allowed anytime except after competition ends)

router.delete('/:id', function(req, res) {

  var pick = db.prepare('SELECT p.*, c.status as comp_status FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE p.id = ? AND p.user_id = ?').get(req.params.id, req.user.id);

  

  if (!pick) return res.status(404).json({ error: 'Pick not found' });

  if (pick.comp_status === 'ended') return res.status(400).json({ error: 'Competition has ended' });



  db.prepare('DELETE FROM picks WHERE id = ?').run(req.params.id);

  res.json({ message: 'Removed ' + pick.symbol });



  try { broadcastPickChange(req.user.id, pick.competition_id); } catch(e) {}

});



module.exports = router;
