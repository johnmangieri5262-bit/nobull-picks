// database.js — SQLite schema & connection
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/nobullpicks.db';

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ==================== SCHEMA ====================
db.exec(`
  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    is_admin INTEGER DEFAULT 0
  );

  -- Competitions
  CREATE TABLE IF NOT EXISTS competitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('quarterly', 'yearly')),
    quarter TEXT,  -- e.g. 'Q3' for quarterly
    year INTEGER NOT NULL,
    draft_start TEXT NOT NULL,
    lock_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'drafting', 'active', 'ended')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Picks (a user's stock selections for a competition)
  CREATE TABLE IF NOT EXISTS picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    competition_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('stock', 'etf', 'crypto')),
    entry_price REAL,         -- locked at competition start
    current_price REAL,       -- updated periodically
    return_pct REAL DEFAULT 0,
    added_at TEXT DEFAULT (datetime('now')),
    locked INTEGER DEFAULT 0, -- 1 when competition starts
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (competition_id) REFERENCES competitions(id),
    UNIQUE(user_id, competition_id, symbol)
  );

  -- Price history (for sparklines / charts)
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    price REAL NOT NULL,
    recorded_at TEXT DEFAULT (datetime('now'))
  );

  -- Invite codes
  CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    max_uses INTEGER DEFAULT 0,  -- 0 = unlimited
    use_count INTEGER DEFAULT 0,
    created_by INTEGER,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_picks_user_comp ON picks(user_id, competition_id);
  CREATE INDEX IF NOT EXISTS idx_picks_symbol ON picks(symbol);
  CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_competitions_status ON competitions(status);
`);

module.exports = db;
