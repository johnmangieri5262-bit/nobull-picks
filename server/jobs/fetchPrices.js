// jobs/fetchPrices.js - Fetch current prices from Finnhub and update picks

const https = require('https');

const db = require('../database');



const FINNHUB_KEY = 'd8bh339r01qu2eqh9rkgd8bh339r01qu2eqh9rl0';



// Map crypto symbols to Finnhub/Binance format

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



function getPrice(symbol, type) {

  return new Promise(function(resolve, reject) {

    var finnhubSymbol = type === 'crypto'

      ? (CRYPTO_MAP[symbol] || 'BINANCE:' + symbol + 'USDT')

      : symbol;



    var url = 'https://finnhub.io/api/v1/quote?symbol=' + encodeURIComponent(finnhubSymbol) + '&token=' + FINNHUB_KEY;



    https.get(url, function(res) {

      var data = '';

      res.on('data', function(chunk) { data += chunk; });

      res.on('end', function() {

        try {

          var json = JSON.parse(data);

          if (json.c && json.c > 0) {

            resolve(json.c);

          } else if (json.pc && json.pc > 0) {

            resolve(json.pc);

          } else {

            reject(new Error('No price data'));

          }

        } catch (e) {

          reject(new Error('Parse error'));

        }

      });

    }).on('error', reject);

  });

}



function sleep(ms) {

  return new Promise(function(resolve) { setTimeout(resolve, ms); });

}



async function fetchPrices() {

  console.log('[' + new Date().toISOString() + '] Starting price fetch...');



  // Get all unique symbols from active/drafting competitions

  var symbols = db.prepare(

    "SELECT DISTINCT p.symbol, p.type FROM picks p JOIN competitions c ON c.id = p.competition_id WHERE c.status IN ('drafting', 'active')"

  ).all();



  if (symbols.length === 0) {

    console.log('No active picks to update.');

    return;

  }



  console.log('Fetching prices for ' + symbols.length + ' symbols...');



  var updated = 0;

  var failed = 0;



  for (var i = 0; i < symbols.length; i++) {

    var symbol = symbols[i].symbol;

    var type = symbols[i].type;



    try {

      var price = await getPrice(symbol, type);



      // Update current_price for all picks with this symbol

      db.prepare('UPDATE picks SET current_price = ? WHERE symbol = ?').run(price, symbol);



      // Calculate return_pct for locked picks

      db.prepare(

        'UPDATE picks SET return_pct = ROUND(((? - entry_price) / entry_price) * 100, 2) WHERE symbol = ? AND locked = 1 AND entry_price > 0'

      ).run(price, symbol);



      // Record price history

      db.prepare('INSERT INTO price_history (symbol, price) VALUES (?, ?)').run(symbol, price);



      updated++;

      console.log('  ' + symbol + ': $' + price.toFixed(2));



      // Rate limiting - Finnhub free tier is 60/min, so wait 1.1 seconds between calls

      await sleep(1100);

    } catch (err) {

      console.error('  Error fetching ' + symbol + ':', err.message);

      failed++;

      await sleep(500);

    }

  }



  // Also update league picks

  var leagueSymbols = db.prepare(

    "SELECT DISTINCT lp.symbol, lp.type FROM league_picks lp JOIN leagues l ON l.id = lp.league_id WHERE l.start_date <= date('now') AND l.end_date >= date('now')"

  ).all();



  for (var j = 0; j < leagueSymbols.length; j++) {

    var sym = leagueSymbols[j].symbol;

    var typ = leagueSymbols[j].type;



    try {

      var p = await getPrice(sym, typ);



      db.prepare('UPDATE league_picks SET current_price = ? WHERE symbol = ?').run(p, sym);

      db.prepare(

        'UPDATE league_picks SET return_pct = ROUND(((? - entry_price) / entry_price) * 100, 2) WHERE symbol = ? AND entry_price > 0'

      ).run(p, sym);



      console.log('  [league] ' + sym + ': $' + p.toFixed(2));

      await sleep(1100);

    } catch (err) {

      console.error('  [league] Error fetching ' + sym + ':', err.message);

      await sleep(500);

    }

  }



  console.log('Price fetch complete. Updated: ' + updated + ', Failed: ' + failed);

}



// If run directly (npm run fetch-prices)

if (require.main === module) {

  fetchPrices().then(function() { process.exit(0); }).catch(function(err) {

    console.error('Fatal error:', err);

    process.exit(1);

  });

}



module.exports = { fetchPrices };

