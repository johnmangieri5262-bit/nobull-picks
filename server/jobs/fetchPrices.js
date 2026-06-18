// jobs/fetchPrices.js - Fetch current prices and update picks
const https = require('https');
const db = require('../database');

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

function getPrice(symbol, type) {
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
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          if (json.quotes && json.quotes.USD && json.quotes.USD.price > 0) {
            resolve(json.quotes.USD.price);
          } else { reject(new Error('No crypto price for ' + symbol)); }
        } catch (e) { reject(new Error('Crypto parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
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
    "SELECT DISTINCT symbol, type FROM league_picks"
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

module.exports = { fetchPrices };
