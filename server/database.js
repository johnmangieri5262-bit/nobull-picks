// database.js — SQLite schema & connection

const Database = require('better-sqlite3');

const path = require('path');

const fs = require('fs');



const DB_PATH = process.env.DB_PATH || '/app/server/data/nobullpicks.db';


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



  -- Competitions (main quarterly/yearly)

  CREATE TABLE IF NOT EXISTS competitions (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL,

    type TEXT NOT NULL CHECK(type IN ('quarterly', 'yearly')),

    quarter TEXT,

    year INTEGER NOT NULL,

    draft_start TEXT NOT NULL,

    lock_date TEXT NOT NULL,

    end_date TEXT NOT NULL,

    status TEXT DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'drafting', 'active', 'ended')),

    created_at TEXT DEFAULT (datetime('now'))

  );



  -- Picks (for main competitions)

  CREATE TABLE IF NOT EXISTS picks (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    competition_id INTEGER NOT NULL,

    symbol TEXT NOT NULL,

    name TEXT NOT NULL,

    type TEXT NOT NULL CHECK(type IN ('stock', 'etf', 'crypto')),

    entry_price REAL,

    current_price REAL,

    return_pct REAL DEFAULT 0,

    added_at TEXT DEFAULT (datetime('now')),

    locked INTEGER DEFAULT 0,

    FOREIGN KEY (user_id) REFERENCES users(id),

    FOREIGN KEY (competition_id) REFERENCES competitions(id),

    UNIQUE(user_id, competition_id, symbol)

  );



  -- Price history

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

    max_uses INTEGER DEFAULT 0,

    use_count INTEGER DEFAULT 0,

    created_by INTEGER,

    active INTEGER DEFAULT 1,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (created_by) REFERENCES users(id)

  );



  -- ==================== CUSTOM LEAGUES ====================



  -- Leagues (user-created private competitions)

  CREATE TABLE IF NOT EXISTS leagues (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL,

    password_hash TEXT NOT NULL,

    creator_id INTEGER NOT NULL,

    max_players INTEGER DEFAULT 20,

    max_picks INTEGER DEFAULT 10,

    min_picks INTEGER DEFAULT 3,

    start_date TEXT NOT NULL,

    end_date TEXT NOT NULL,

    created_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (creator_id) REFERENCES users(id)

  );



  -- League members

  CREATE TABLE IF NOT EXISTS league_members (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    league_id INTEGER NOT NULL,

    user_id INTEGER NOT NULL,

    joined_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (league_id) REFERENCES leagues(id),

    FOREIGN KEY (user_id) REFERENCES users(id),

    UNIQUE(league_id, user_id)

  );



  -- League picks (separate from main competition picks)

  CREATE TABLE IF NOT EXISTS league_picks (

    id INTEGER PRIMARY KEY AUTOINCREMENT,

    league_id INTEGER NOT NULL,

    user_id INTEGER NOT NULL,

    symbol TEXT NOT NULL,

    name TEXT NOT NULL,

    type TEXT NOT NULL CHECK(type IN ('stock', 'etf', 'crypto')),

    entry_price REAL,

    current_price REAL,

    return_pct REAL DEFAULT 0,

    added_at TEXT DEFAULT (datetime('now')),

    FOREIGN KEY (league_id) REFERENCES leagues(id),

    FOREIGN KEY (user_id) REFERENCES users(id),

    UNIQUE(league_id, user_id, symbol)

  );



  -- Indexes

  CREATE INDEX IF NOT EXISTS idx_picks_user_comp ON picks(user_id, competition_id);

  CREATE INDEX IF NOT EXISTS idx_picks_symbol ON picks(symbol);

  CREATE INDEX IF NOT EXISTS idx_price_history_symbol ON price_history(symbol, recorded_at);

  CREATE INDEX IF NOT EXISTS idx_competitions_status ON competitions(status);

  CREATE INDEX IF NOT EXISTS idx_league_members ON league_members(league_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_league_picks_league ON league_picks(league_id, user_id);

  CREATE INDEX IF NOT EXISTS idx_league_picks_symbol ON league_picks(symbol);

`);



module.exports = db;

