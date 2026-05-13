const bcrypt = require('bcrypt');
const db = require('./database');

async function seed() {
  const existing = db.prepare('SELECT id FROM invite_codes WHERE code = ?').get('NOBULL2026');
  if (existing) return;

  console.log('Seeding database...');
  db.prepare('INSERT INTO invite_codes (code, max_uses, active) VALUES (?, ?, ?)').run('NOBULL2026', 0, 1);

  const hash = await bcrypt.hash('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, is_admin) VALUES (?, ?, ?, ?)').run('admin', hash, 'Admin', 1);

  db.prepare(`INSERT INTO competitions (name, type, quarter, year, draft_start, lock_date, end_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('Q3 2026', 'quarterly', 'Q3', 2026, '2026-06-01', '2026-07-01', '2026-09-30', 'drafting');

  console.log('Seed complete!');
}

seed().catch(console.error);
module.exports = seed;
