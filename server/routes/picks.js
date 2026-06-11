// jobs/fetchPrices.js - Fetch current prices and update picks
const https = require('https');
const db = require('../database');

var FMP_KEY = 'ZxMhLYmFdRwM6cmFxuh7o111j75gYoom';
var FINNHUB_KEY = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';

var CRYPTO_MAP = {
  'BTC': 'BINANCE:BTCUSDT', 'ETH': 'BINANCE:ETHUSDT', 'SOL': 'BINANCE:SOLUSDT',
  'ADA': 'BINANCE:ADAUSDT', 'DOGE': 'BINANCE:DOGEUSDT', 'XRP': 'BINANCE:XRPUSDT',
  'AVAX': 'BINANCE:AVAXUSDT', 'DOT': 'BINANCE:DOTUSDT', 'LINK': 'BINANCE:LINKUSDT',
  'MATIC': 'BINANCE:MATICUSDT', 'BNB': 'BINANCE:BNBUSDT', 'SHIB': 'BINANCE:SHIBUSDT',
  'UNI': 'BINANCE:UNIUSDT', 'ATOM': 'BINANCE:ATOMUSDT', 'LTC': 'BINANCE:LTCUSDT'
};

var FMP_CRYPTO = {
  'BTC': 'BTCUSD', 'ETH': 'ETHUSD', 'SOL': 'SOLUSD',
  'ADA': 'ADAUSD', 'DOGE': 'DOGEUSD', 'XRP': 'XRPUSD',
  'AVAX': 'AVAXUSD', 'DOT': 'DOTUSD', 'LINK': 'LINKUSD',
  'MATIC': 'MATICUSD', 'BNB': 'BNBUSD', 'SHIB': 'SHIBUSD',
  'UNI': 'UNIUSD', 'ATOM': 'ATOMUSD', 'LTC': 'LTCUSD'
};

function buildFinnhubUrl(symbol) {
  return 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(symbol) + String.fromCharCode(38) + 'token=' + FINNHUB_KEY;
}

function buildFmpUrl(symbol) {
  return 'https://financialmodelingprep.com/api/v3/quote/' + encodeURIComponent(symbol) + '?apikey=' + FMP_KEY;
}

function fetchFMP(symbol, type) {
  return new Promise(function(resolve, reject) {
    var fmpSymbol = type === 'crypto' ? (FMP_CRYPTO[symbol] || symbol + 'USD') : symbol;
    var url = buildFmpUrl(fmpSymbol);
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (Array.isArray(json) && json.length > 0 && json[0].price > 0) {
            resolve(json[0].price);
          } else { reject(new Error('FMP no price')); }
        } catch (e) { reject(new Error('FMP parse error')); }
      });
    }).on('error', reject);
  });
}

function fetchFinnhub(symbol, type) {
  return new Promise(function(resolve, reject) {
    var finnhubSymbol = type === 'crypto' ? (CRYPTO_MAP[symbol] || 'BINANCE:' + symbol + 'USDT') : symbol;
    var url = buildFinnhubUrl(finnhubSymbol);
    https.get(url, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.c && json.c > 0) { resolve(json.c); }
          else if (json.pc && json.pc > 0) { resolve(json.pc); }
          else { reject(new Error('Finnhub no price')); }
        } catch (e) { reject(new Error('Finnhub parse error')); }
      });
    }).on('error', reject);
  });
}

function getPrice(symbol, type) {
  return fetchFMP(symbol, type).catch(function() {
    return fetchFinnhub(symbol, type);
  });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function fetchPrices() {
  console.log('[' + new Date().toISOString() + '] Starting price fetch...');

  var symbols = db.prepare(
    "SELECT DISTINCT p.symbol, p.type FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE c.status IN ('drafting', 'active')"
  ).all();

  if (symbols.length === 0) { console.log('No active picks to update.'); return; }
  console.log('Fetching prices for ' + symbols.length + ' symbols...');

  var updated = 0, failed = 0;
  for (var i = 0; i < symbols.length; i++) {
    var sym = symbols[i].symbol, typ = symbols[i].type;
    try {
      var price = await getPrice(sym, typ);
      db.prepare('UPDATE picks SET current_price = ? WHERE symbol = ?').run(price, sym);
      db.prepare('UPDATE picks SET return_pct = ROUND(((? - entry_price) / entry_price) * 100, 2) WHERE symbol = ? AND locked = 1 AND entry_price > 0').run(price, sym);
      db.prepare('INSERT INTO price_history (symbol, price) VALUES (?, ?)').run(sym, price);
      updated++;
      console.log('  ' + sym + ': $' + price.toFixed(2));
      await sleep(1200);
    } catch (err) {
      console.error('  Error: ' + sym + ': ' + err.message);
      failed++;
      await sleep(500);
    }
  }

  // Also update league picks
  var leagueSymbols = db.prepare(
    "SELECT DISTINCT lp.symbol, lp.type FROM league_picks lp JOIN leagues l ON l.id = lp.league_id WHERE l.start_date <= date('now') AND l.end_date >= date('now')"
  ).all();

  for (var j = 0; j < leagueSymbols.length; j++) {
    var s = leagueSymbols[j].symbol, t = leagueSymbols[j].type;
    try {
      var p = await getPrice(s, t);
      db.prepare('UPDATE league_picks SET current_price = ? WHERE symbol = ?').run(p, s);
      db.prepare('UPDATE league_picks SET return_pct = ROUND(((? - entry_price) / entry_price) * 100, 2) WHERE symbol = ? AND entry_price > 0').run(p, s);
      await sleep(1200);
    } catch (err) { await sleep(500); }
  }

  console.log('Done. Updated: ' + updated + ', Failed: ' + failed);
}

if (require.main === module) {
  fetchPrices().then(function() { process.exit(0); }).catch(function(err) {
    console.error('Fatal:', err);
    process.exit(1);
  });
}

module.exports = router;
