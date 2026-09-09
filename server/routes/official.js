// routes/official.js
const express = require('express');
const router = express.Router();
const https = require('https');

var FINNHUB_KEY = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';

var OFFICIAL_PICKS = [
  { symbol: 'V', name: 'Visa Inc.', type: 'stock', locked: '2026-06-23T19:15:00' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', locked: '2026-07-01T13:54:00' },
  { symbol: 'CEG', name: 'Constellation Energy', type: 'stock', locked: '2026-07-07T13:55:00' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'stock', locked: '2026-07-21T13:00:00' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway', type: 'stock', locked: '2026-07-21T13:00:00' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor', type: 'stock', locked: '2026-08-04T19:15:00' },
  { symbol: 'TT', name: 'Trane Technologies', type: 'stock', locked: '2026-08-04T19:15:00' },
  { symbol: 'COIN', name: 'Coinbase Global', type: 'stock', locked: '2026-08-12T19:15:00' },
  { symbol: 'PLNT', name: 'Planet Fitness', type: 'stock', locked: '2026-08-19T19:15:00' },
  { symbol: 'CEG', name: 'Constellation Energy', type: 'stock', locked: '2026-08-25T19:15:00' },
  { symbol: 'WMT', name: 'Walmart Inc.', type: 'stock', locked: '2026-09-02T19:15:00' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'stock', locked: '2026-09-09T19:15:00' }
];

var ENTRY_PRICES_LIST = [328.50, 237.53, 239.00, 206.40, 489.83, 419.27, 472.24, 149.72, 52.73, 277.35, 105.97, 252.15];
var pricesLocked = true;

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
          else { resolve(0); }
        } catch (e) { resolve(0); }
      });
    }).on('error', function() { resolve(0); });
  });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

router.get('/', async function(req, res) {
  try {
    var results = [];
    for (var i = 0; i < OFFICIAL_PICKS.length; i++) {
      var pick = OFFICIAL_PICKS[i];
      var currentPrice = await getFinnhubPrice(pick.symbol);
      var entryPrice = ENTRY_PRICES_LIST[i];

      var returnPct = 0;
      if (entryPrice > 0 && currentPrice > 0) {
        returnPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      }

      results.push({
        symbol: pick.symbol,
        name: pick.name,
        type: pick.type,
        entry_price: entryPrice,
        current_price: currentPrice,
        return_pct: Math.round(returnPct * 100) / 100,
        added_at: pick.locked
      });

      if (i < OFFICIAL_PICKS.length - 1) await sleep(300);
    }

    var totalReturn = 0;
    var count = 0;
    for (var j = 0; j < results.length; j++) {
      if (results[j].current_price > 0) {
        totalReturn += results[j].return_pct;
        count++;
      }
    }
    var avgReturn = count > 0 ? Math.round((totalReturn / count) * 100) / 100 : 0;

    res.json({ picks: results, avg_return: avgReturn, pick_count: OFFICIAL_PICKS.length });
  } catch (err) {
    console.error('GET /official error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
