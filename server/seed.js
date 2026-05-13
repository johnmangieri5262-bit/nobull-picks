// seed.js — Seed database with initial data
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./database');

async function seed() {
  console.log('Seeding database...');

  // Create default invite code
  const existingCode = db.prepare('SELECT id FROM invite_codes WHERE code = ?').get('NOBULL2026');
  if (!existingCode) {
    db.prepare('INSERT INTO invite_codes (code, max_uses, active) VALUES (?, ?, ?)').run('NOBULL2026', 0, 1);
    console.log('  Created invite code: NOBULL2026');
  }

  // Create admin user
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const hash = await bcrypt.hash('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)').run('admin', hash, 'Admin', 1);
    console.log('  Created admin user (admin / admin123)');
  }

  // Create Q3 2026 competition
  const existingComp = db.prepare('SELECT id FROM competitions WHERE name = ?').get('Q3 2026');
  if (!existingComp) {
    db.prepare(`
      INSERT INTO competitions (name, type, quarter, year, draft_start, lock_date, end_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Q3 2026', 'quarterly', 'Q3', 2026, '2026-06-01', '2026-07-01', '2026-09-30', 'drafting');
    console.log('  Created Q3 2026 competition (drafting)');
  }

  // Create some demo users with picks
  const demoUsers = [
    { username: 'miket', display: 'Mike T.', picks: ['NVDA', 'AAPL', 'MSFT', 'AMZN', 'TSLA', 'META', 'GOOGL'] },
    { username: 'sarahk', display: 'Sarah K.', picks: ['BTC', 'ETH', 'SOL', 'QQQ', 'ARKK'] },
    { username: 'jamesr', display: 'James R.', picks: ['AMZN', 'COST', 'WMT', 'V', 'JPM', 'MSFT', 'AAPL', 'SPY', 'QQQ', 'VTI'] },
    { username: 'lisam', display: 'Lisa M.', picks: ['QQQ', 'NFLX', 'DIS', 'SHOP'] },
    { username: 'davidh', display: 'David H.', picks: ['MSFT', 'V', 'JNJ', 'SPY', 'XLF', 'JPM'] },
  ];

  const comp = db.prepare('SELECT id FROM competitions WHERE name = ?').get('Q3 2026');
  
  for (const demo of demoUsers) {
    let user = db.prepare('SELECT id FROM users WHERE username = ?').get(demo.username);
    if (!user) {
      const hash = await bcrypt.hash('demo123', 10);
      const result = db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)').run(demo.username, hash, demo.display);
      user = { id: result.lastInsertRowid };
      console.log(`  Created demo user: ${demo.display}`);
    }

    // Add picks
    for (const symbol of demo.picks) {
      const existing = db.prepare('SELECT id FROM picks WHERE user_id = ? AND competition_id = ? AND symbol = ?').get(user.id, comp.id, symbol);
      if (!existing) {
        const type = ['BTC', 'ETH', 'SOL', 'ADA', 'DOGE', 'XRP', 'AVAX', 'DOT'].includes(symbol) ? 'crypto' :
                     ['SPY', 'QQQ', 'IWM', 'VTI', 'ARKK', 'XLF', 'XLE'].includes(symbol) ? 'etf' : 'stock';
        const price = (Math.random() * 400 + 20).toFixed(2);
        db.prepare(`
          INSERT INTO picks (user_id, competition_id, symbol, name, type, entry_price, current_price, return_pct)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(user.id, comp.id, symbol, symbol, type, price, price, (Math.random() * 20 - 5).toFixed(2));
      }
    }
  }

  console.log('Seed complete!');
}

seed().catch(console.error);
