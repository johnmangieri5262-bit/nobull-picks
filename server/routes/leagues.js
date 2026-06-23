// routes/leagues.js - Custom League management
const express = require('express');
const https = require('https');
const bcrypt = require('bcrypt');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

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

function getStockPrice(symbol, type) {
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

// POST /api/leagues - create a new league
router.post('/', async function(req, res) {
  try {
    var name = req.body.name;
    var leaguePw = req.body.league_pw;
    var max_players = req.body.max_players || 20;
    var start_date = req.body.start_date;
    var end_date = req.body.end_date;
    var max_picks = req.body.max_picks || 10;
    var min_picks = req.body.min_picks || 3;

    if (!name || !leaguePw || !start_date || !end_date) {
      return res.status(400).json({ error: 'name, league_pw, start_date, and end_date required' });
    }
    if (name.length > 40) return res.status(400).json({ error: 'League name must be 40 characters or less' });
    if (leaguePw.length < 4) return res.status(400).json({ error: 'League code must be at least 4 characters' });
    if (max_players < 2 || max_players > 100) return res.status(400).json({ error: 'max_players must be between 2 and 100' });
    if (new Date(end_date) <= new Date(start_date)) return res.status(400).json({ error: 'end_date must be after start_date' });

    var hashed = await bcrypt.hash(leaguePw, 10);
    var result = db.prepare('INSERT INTO leagues (name, password_hash, creator_id, max_players, start_date, end_date, max_picks, min_picks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, hashed, req.user.id, max_players, start_date, end_date, max_picks, min_picks);
    var leagueId = result.lastInsertRowid;
    db.prepare('INSERT INTO league_members (league_id, user_id) VALUES (?, ?)').run(leagueId, req.user.id);

    res.status(201).json({ league: { id: leagueId, name: name, creator_id: req.user.id, max_players: max_players, start_date: start_date, end_date: end_date, max_picks: max_picks, min_picks: min_picks, player_count: 1, status: getLeagueStatus(start_date, end_date) } });
  } catch (err) {
    console.error('Create league error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leagues/join
router.post('/join', async function(req, res) {
  try {
    var league_id = req.body.league_id;
    var leaguePw = req.body.league_pw;
    if (!league_id || !leaguePw) return res.status(400).json({ error: 'league_id and league_pw required' });

    var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(league_id);
    if (!league) return res.status(404).json({ error: 'League not found' });

    var valid = await bcrypt.compare(leaguePw, league.password_hash);
    if (!valid) return res.status(401).json({ error: 'Wrong league code' });

    var existing = db.prepare('SELECT id FROM league_members WHERE league_id = ? AND user_id = ?').get(league_id, req.user.id);
    if (existing) return res.status(400).json({ error: 'Already in this league' });

    var count = db.prepare('SELECT COUNT(*) as cnt FROM league_members WHERE league_id = ?').get(league_id);
    if (count.cnt >= league.max_players) return res.status(400).json({ error: 'League is full' });

    db.prepare('INSERT INTO league_members (league_id, user_id) VALUES (?, ?)').run(league_id, req.user.id);
    res.json({ message: 'Joined ' + league.name + '!', league_id: league_id });
  } catch (err) {
    console.error('Join league error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
// GET /api/leagues/:id/picks/player/:userId — view another player's picks (only after league starts)
router.get('/:id/picks/player/:userId', function(req, res) {
  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'League not found' });
  var status = getLeagueStatus(league.start_date, league.end_date);
  if (status === 'upcoming') return res.status(403).json({ error: 'Picks are hidden until the league starts' });
  var member = db.prepare('SELECT id FROM league_members WHERE league_id = ? AND user_id = ?').get(parseInt(req.params.id), req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member of this league' });
  var picks = db.prepare('SELECT * FROM league_picks WHERE league_id = ? AND user_id = ? ORDER BY id DESC').all(parseInt(req.params.id), parseInt(req.params.userId));
  var player = db.prepare('SELECT display_name FROM users WHERE id = ?').get(parseInt(req.params.userId));
  res.json({ picks: picks, player_name: player ? player.display_name : 'Unknown' });
});
// GET /api/leagues
router.get('/', function(req, res) {
  var leagues = db.prepare('SELECT l.*, (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as player_count FROM leagues l JOIN league_members lm ON lm.league_id = l.id WHERE lm.user_id = ? ORDER BY l.id DESC').all(req.user.id);
  leagues.forEach(function(l) { l.status = getLeagueStatus(l.start_date, l.end_date); });
  res.json({ leagues: leagues });
});

// GET /api/leagues/browse
router.get('/browse', function(req, res) {
  var leagues = db.prepare('SELECT l.id, l.name, l.max_players, l.start_date, l.end_date, l.max_picks, l.min_picks, l.creator_id, (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as player_count, (SELECT display_name FROM users WHERE id = l.creator_id) as creator_name FROM leagues l ORDER BY l.id DESC LIMIT 50').all();
  leagues.forEach(function(l) { l.status = getLeagueStatus(l.start_date, l.end_date); });
  res.json({ leagues: leagues });
});

// GET /api/leagues/:id
router.get('/:id', function(req, res) {
  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  var members = db.prepare('SELECT u.id, u.display_name, lm.joined_at FROM league_members lm JOIN users u ON u.id = lm.user_id WHERE lm.league_id = ? ORDER BY lm.joined_at').all(req.params.id);
  league.status = getLeagueStatus(league.start_date, league.end_date);
  league.player_count = members.length;
  res.json({ league: league, members: members, is_member: members.some(function(m) { return m.id === req.user.id; }) });
});

// GET /api/leagues/:id/leaderboard
router.get('/:id/leaderboard', function(req, res) {
  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  var leaderboard = db.prepare('SELECT u.id, u.display_name, COUNT(lp.id) as pick_count, COALESCE(AVG(lp.return_pct), 0) as avg_return FROM league_members lm JOIN users u ON u.id = lm.user_id LEFT JOIN league_picks lp ON lp.league_id = lm.league_id AND lp.user_id = lm.user_id WHERE lm.league_id = ? GROUP BY u.id ORDER BY avg_return DESC').all(req.params.id);
  leaderboard.forEach(function(p, i) { p.rank = i + 1; p.avg_return = Math.round(p.avg_return * 100) / 100; });
  res.json({ leaderboard: leaderboard });
});

// POST /api/leagues/:id/picks
router.post('/:id/picks', function(req, res) {
  var leagueId = parseInt(req.params.id);
  var symbol = (req.body.symbol || '').toUpperCase().trim();
  var name = req.body.name || symbol;
  var type = req.body.type || 'stock';

  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);
  if (!league) return res.status(404).json({ error: 'League not found' });

  var member = db.prepare('SELECT id FROM league_members WHERE league_id = ? AND user_id = ?').get(leagueId, req.user.id);
  if (!member) return res.status(403).json({ error: 'Not a member of this league' });

  var status = getLeagueStatus(league.start_date, league.end_date);
  if (status === 'ended') return res.status(400).json({ error: 'League has ended' });

  var count = db.prepare('SELECT COUNT(*) as cnt FROM league_picks WHERE league_id = ? AND user_id = ?').get(leagueId, req.user.id);
  if (count.cnt >= league.max_picks) return res.status(400).json({ error: 'Maximum ' + league.max_picks + ' picks allowed' });

  var exists = db.prepare('SELECT id FROM league_picks WHERE league_id = ? AND user_id = ? AND symbol = ?').get(leagueId, req.user.id, symbol);
  if (exists) return res.status(400).json({ error: 'Already picked ' + symbol });

  getStockPrice(symbol, type).then(function(price) {
    var result = db.prepare('INSERT INTO league_picks (league_id, user_id, symbol, name, type, entry_price, current_price) VALUES (?, ?, ?, ?, ?, ?, ?)').run(leagueId, req.user.id, symbol, name, type, price, price);
    res.status(201).json({ pick: { id: result.lastInsertRowid, symbol: symbol, name: name, type: type, entry_price: price, current_price: price, return_pct: 0 } });
  }).catch(function(err) {
    console.error('League pick price error:', err.message);
    res.status(400).json({ error: 'Could not get price for ' + symbol });
  });
});

// GET /api/leagues/:id/picks
router.get('/:id/picks', function(req, res) {
  var picks = db.prepare('SELECT * FROM league_picks WHERE league_id = ? AND user_id = ? ORDER BY id DESC').all(parseInt(req.params.id), req.user.id);
  res.json({ picks: picks });
});

// DELETE /api/leagues/:id/picks/:pickId
router.delete('/:id/picks/:pickId', function(req, res) {
  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'League not found' });
  var pick = db.prepare('SELECT * FROM league_picks WHERE id = ? AND league_id = ? AND user_id = ?').get(parseInt(req.params.pickId), parseInt(req.params.id), req.user.id);
  if (!pick) return res.status(404).json({ error: 'Pick not found' });
  db.prepare('DELETE FROM league_picks WHERE id = ?').run(pick.id);
  res.json({ message: 'Removed ' + pick.symbol });
});

// DELETE /api/leagues/:id/leave
router.delete('/:id/leave', function(req, res) {
  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.creator_id === req.user.id) return res.status(400).json({ error: 'Creator cannot leave. Delete the league instead.' });
  db.prepare('DELETE FROM league_members WHERE league_id = ? AND user_id = ?').run(league.id, req.user.id);
  db.prepare('DELETE FROM league_picks WHERE league_id = ? AND user_id = ?').run(league.id, req.user.id);
  res.json({ message: 'Left the league' });
});

// DELETE /api/leagues/:id
router.delete('/:id', function(req, res) {
  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);
  if (!league) return res.status(404).json({ error: 'League not found' });
  if (league.creator_id !== req.user.id) return res.status(403).json({ error: 'Only the creator can delete this league' });
  db.prepare('DELETE FROM league_picks WHERE league_id = ?').run(league.id);
  db.prepare('DELETE FROM league_members WHERE league_id = ?').run(league.id);
  db.prepare('DELETE FROM leagues WHERE id = ?').run(league.id);
  res.json({ message: 'League deleted' });
});

function getLeagueStatus(start_date, end_date) {
  var now = new Date().toISOString().split('T')[0];
  if (now < start_date) return 'upcoming';
  if (now > end_date) return 'ended';
  return 'active';
}

module.exports = router;
