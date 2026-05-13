// jobs/fetchPrices.js — Fetch current prices from Yahoo Finance & update picks
const yahooFinance = require('yahoo-finance2').default;
const db = require('../database');

// Map crypto symbols to Yahoo Finance format
const CRYPTO_MAP = {
  'BTC': 'BTC-USD',
  'ETH': 'ETH-USD',
  'SOL': 'SOL-USD',
  'ADA': 'ADA-USD',
  'DOGE': 'DOGE-USD',
  'XRP': 'XRP-USD',
  'AVAX': 'AVAX-USD',
  'DOT': 'DOT-USD',
  'LINK': 'LINK-USD',
  'MATIC': 'MATIC-USD'
};

async function fetchPrices() {
  console.log(`[${new Date().toISOString()}] Starting price fetch...`);

  // Get all unique symbols from active/drafting competitions
  const symbols = db.prepare(`
    SELECT DISTINCT p.symbol, p.type FROM picks p
    JOIN competitions c ON c.id = p.competition_id
    WHERE c.status IN ('drafting', 'active')
  `).all();

  if (symbols.length === 0) {
    console.log('No active picks to update.');
    return;
  }

  console.log(`Fetching prices for ${symbols.length} symbols...`);
  
  let updated = 0;
  let failed = 0;

  for (const { symbol, type } of symbols) {
    try {
      // Convert to Yahoo Finance ticker format
      const yahooSymbol = type === 'crypto' 
        ? (CRYPTO_MAP[symbol] || symbol + '-USD')
        : symbol;

      const quote = await yahooFinance.quote(yahooSymbol);
      
      if (!quote || !quote.regularMarketPrice) {
        console.warn(`  No price data for ${symbol} (${yahooSymbol})`);
        failed++;
        continue;
      }

      const price = quote.regularMarketPrice;

      // Update current_price for all picks with this symbol
      db.prepare(`
        UPDATE picks SET current_price = ? WHERE symbol = ?
      `).run(price, symbol);

      // Calculate return_pct for locked picks
      db.prepare(`
        UPDATE picks 
        SET return_pct = ROUND(((? - entry_price) / entry_price) * 100, 2)
        WHERE symbol = ? AND locked = 1 AND entry_price > 0
      `).run(price, symbol);

      // Record price history
      db.prepare(`
        INSERT INTO price_history (symbol, price) VALUES (?, ?)
      `).run(symbol, price);

      updated++;
      console.log(`  ${symbol}: $${price.toFixed(2)}`);

      // Rate limiting — small delay between requests
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`  Error fetching ${symbol}:`, err.message);
      failed++;
    }
  }

  console.log(`Price fetch complete. Updated: ${updated}, Failed: ${failed}`);
}

// If run directly (npm run fetch-prices)
if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  fetchPrices().then(() => process.exit(0)).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { fetchPrices };
