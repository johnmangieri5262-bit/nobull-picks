// routes/leagues.js - Custom League management

const express = require('express');

const https = require('https');

const bcrypt = require('bcrypt');

const db = require('../database');

const { authenticate } = require('../middleware/auth');

const { broadcastLeaderboard } = require('../websocket');



const router = express.Router();



// All league routes require authentication

router.use(authenticate);



// Crypto symbol map for Yahoo Finance

const CRYPTO_MAP = {

  'BTC': 'BTC-USD', 'ETH': 'ETH-USD', 'SOL': 'SOL-USD',

  'ADA': 'ADA-USD', 'DOGE': 'DOGE-USD', 'XRP': 'XRP-USD',

  'AVAX': 'AVAX-USD', 'DOT': 'DOT-USD', 'LINK': 'LINK-USD',

  'MATIC': 'MATIC-USD', 'BNB': 'BNB-USD', 'SHIB': 'SHIB-USD',

  'UNI': 'UNI-USD', 'ATOM': 'ATOM-USD', 'LTC': 'LTC-USD',

  'FIL': 'FIL-USD', 'APT': 'APT-USD', 'ARB': 'ARB-USD',

  'OP': 'OP-USD', 'NEAR': 'NEAR-USD', 'ICP': 'ICP-USD',

  'IMX': 'IMX-USD', 'AAVE': 'AAVE-USD', 'MKR': 'MKR-USD',

  'PEPE': 'PEPE-USD'

};



// Fetch price using raw HTTPS to Yahoo Finance

function fetchYahooPrice(symbol, type) {

  return new Promise(function(resolve, reject) {

    var yahooSymbol = type === 'crypto'

      ? (CRYPTO_MAP[symbol] || symbol + '-USD')

      : symbol;

    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(yahooSymbol) + '?interval=1d&range=1d';

    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {

      var data = '';

      res.on('data', function(chunk) { data += chunk; });

      res.on('end', function() {

        try {

          var json = JSON.parse(data);

          var meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;

          if (meta && meta.regularMarketPrice) {

            resolve(meta.regularMarketPrice);

          } else {

            reject(new Error('No price in response'));

          }

        } catch (e) {

          reject(new Error('Parse error'));

        }

      });

    }).on('error', reject);

  });

}



// POST /api/leagues - create a new league

router.post('/', async function(req, res) {

  try {

    var name = req.body.name;

    var leaguePw = req.body.league_code;

    var max_players = req.body.max_players || 20;

    var start_date = req.body.start_date;

    var end_date = req.body.end_date;

    var max_picks = req.body.max_picks || 10;

    var min_picks = req.body.min_picks || 3;



    if (!name || !leaguePw || !start_date || !end_date) {

      return res.status(400).json({ error: 'name, league_password, start_date, and end_date required' });

    }

    if (name.length > 40) {

      return res.status(400).json({ error: 'League name must be 40 characters or less' });

    }

    if (leaguePw.length < 4) {

      return res.status(400).json({ error: 'League code must be at least 4 characters' });

    }

    if (max_players < 2 || max_players > 100) {

      return res.status(400).json({ error: 'max_players must be between 2 and 100' });

    }

    if (new Date(end_date) <= new Date(start_date)) {

      return res.status(400).json({ error: 'end_date must be after start_date' });

    }



    var hashed = await bcrypt.hash(leaguePw, 10);



    var result = db.prepare(

      'INSERT INTO leagues (name, password_hash, creator_id, max_players, start_date, end_date, max_picks, min_picks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'

    ).run(name, hashed, req.user.id, max_players, start_date, end_date, max_picks, min_picks);



    var leagueId = result.lastInsertRowid;



    // Auto-join the creator

    db.prepare('INSERT INTO league_members (league_id, user_id) VALUES (?, ?)').run(leagueId, req.user.id);



    res.status(201).json({

      league: {

        id: leagueId,

        name: name,

        creator_id: req.user.id,

        max_players: max_players,

        start_date: start_date,

        end_date: end_date,

        max_picks: max_picks,

        min_picks: min_picks,

        player_count: 1,

        status: getLeagueStatus(start_date, end_date)

      }

    });

  } catch (err) {

    console.error('Create league error:', err);

    res.status(500).json({ error: 'Server error' });

  }

});



// POST /api/leagues/join - join a league by ID + code

router.post('/join', async function(req, res) {

  try {

    var league_id = req.body.league_id;

    var leaguePw = req.body.league_code;



    if (!league_id || !leaguePw) {

      return res.status(400).json({ error: 'league_id and league_password required' });

    }



    var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(league_id);

    if (!league) return res.status(404).json({ error: 'League not found' });



    // Check code

    var valid = await bcrypt.compare(leaguePw, league.password_hash);

    if (!valid) return res.status(401).json({ error: 'Wrong league code' });



    // Check if already a member

    var existing = db.prepare('SELECT id FROM league_members WHERE league_id = ? AND user_id = ?').get(league_id, req.user.id);

    if (existing) return res.status(400).json({ error: 'Already in this league' });



    // Check max players

    var count = db.prepare('SELECT COUNT(*) as cnt FROM league_members WHERE league_id = ?').get(league_id);

    if (count.cnt >= league.max_players) {

      return res.status(400).json({ error: 'League is full' });

    }



    db.prepare('INSERT INTO league_members (league_id, user_id) VALUES (?, ?)').run(league_id, req.user.id);



    res.json({ message: 'Joined ' + league.name + '!', league_id: league_id });

  } catch (err) {

    console.error('Join league error:', err);

    res.status(500).json({ error: 'Server error' });

  }

});



// GET /api/leagues - list leagues the user is in

router.get('/', function(req, res) {

  var leagues = db.prepare(

    'SELECT l.*, (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as player_count FROM leagues l JOIN league_members lm ON lm.league_id = l.id WHERE lm.user_id = ? ORDER BY l.created_at DESC'

  ).all(req.user.id);



  leagues.forEach(function(l) {

    l.status = getLeagueStatus(l.start_date, l.end_date);

  });



  res.json({ leagues: leagues });

});



// GET /api/leagues/browse - list all leagues (for discovering)

router.get('/browse', function(req, res) {

  var leagues = db.prepare(

    'SELECT l.id, l.name, l.max_players, l.start_date, l.end_date, l.max_picks, l.min_picks, l.creator_id, l.created_at, (SELECT COUNT(*) FROM league_members WHERE league_id = l.id) as player_count, (SELECT display_name FROM users WHERE id = l.creator_id) as creator_name FROM leagues l ORDER BY l.created_at DESC LIMIT 50'

  ).all();



  leagues.forEach(function(l) {

    l.status = getLeagueStatus(l.start_date, l.end_date);

  });



  res.json({ leagues: leagues });

});



// GET /api/leagues/:id - get league details + members

router.get('/:id', function(req, res) {

  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);

  if (!league) return res.status(404).json({ error: 'League not found' });



  var members = db.prepare(

    'SELECT u.id, u.display_name, lm.joined_at FROM league_members lm JOIN users u ON u.id = lm.user_id WHERE lm.league_id = ? ORDER BY lm.joined_at'

  ).all(req.params.id);



  var isMember = members.some(function(m) { return m.id === req.user.id; });



  league.status = getLeagueStatus(league.start_date, league.end_date);

  league.player_count = members.length;



  res.json({ league: league, members: members, is_member: isMember });

});



// GET /api/leagues/:id/leaderboard - league leaderboard

router.get('/:id/leaderboard', function(req, res) {

  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);

  if (!league) return res.status(404).json({ error: 'League not found' });



  var leaderboard = db.prepare(

    'SELECT u.id, u.display_name, COUNT(lp.id) as pick_count, COALESCE(AVG(lp.return_pct), 0) as avg_return FROM league_members lm JOIN users u ON u.id = lm.user_id LEFT JOIN league_picks lp ON lp.league_id = lm.league_id AND lp.user_id = lm.user_id WHERE lm.league_id = ? GROUP BY u.id ORDER BY avg_return DESC'

  ).all(req.params.id);



  leaderboard.forEach(function(p, i) {

    p.rank = i + 1;

    p.avg_return = Math.round(p.avg_return * 100) / 100;

  });



  res.json({ leaderboard: leaderboard });

});



// POST /api/leagues/:id/picks - add a pick to a league

router.post('/:id/picks', function(req, res) {

  var leagueId = parseInt(req.params.id);

  var symbol = req.body.symbol;

  var name = req.body.name;

  var type = req.body.type;



  if (!symbol || !name || !type) {

    return res.status(400).json({ error: 'symbol, name, and type required' });

  }

  if (['stock', 'etf', 'crypto'].indexOf(type) === -1) {

    return res.status(400).json({ error: 'type must be stock, etf, or crypto' });

  }



  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);

  if (!league) return res.status(404).json({ error: 'League not found' });



  var member = db.prepare('SELECT id FROM league_members WHERE league_id = ? AND user_id = ?').get(leagueId, req.user.id);

  if (!member) return res.status(403).json({ error: 'Not a member of this league' });



  var status = getLeagueStatus(league.start_date, league.end_date);

  if (status === 'ended') return res.status(400).json({ error: 'League has ended' });



  var count = db.prepare('SELECT COUNT(*) as cnt FROM league_picks WHERE league_id = ? AND user_id = ?').get(leagueId, req.user.id);

  if (count.cnt >= league.max_picks) {

    return res.status(400).json({ error: 'Maximum ' + league.max_picks + ' picks allowed in this league' });

  }



  var exists = db.prepare('SELECT id FROM league_picks WHERE league_id = ? AND user_id = ? AND symbol = ?').get(leagueId, req.user.id, symbol.toUpperCase());

  if (exists) return res.status(400).json({ error: 'Already picked ' + symbol + ' in this league' });



  fetchYahooPrice(symbol.toUpperCase(), type).then(function(entryPrice) {

    var result = db.prepare(

      'INSERT INTO league_picks (league_id, user_id, symbol, name, type, entry_price, current_price) VALUES (?, ?, ?, ?, ?, ?, ?)'

    ).run(leagueId, req.user.id, symbol.toUpperCase(), name, type, entryPrice, entryPrice);



    res.status(201).json({

      pick: {

        id: result.lastInsertRowid,

        symbol: symbol.toUpperCase(),

        name: name,

        type: type,

        entry_price: entryPrice,

        current_price: entryPrice,

        return_pct: 0

      }

    });

  }).catch(function(err) {

    console.error('League pick price error:', err.message);

    res.status(400).json({ error: 'Could not get price for ' + symbol + '. Try again.' });

  });

});



// GET /api/leagues/:id/picks - get user picks in a league

router.get('/:id/picks', function(req, res) {

  var leagueId = parseInt(req.params.id);

  var userId = req.query.user_id || req.user.id;



  var picks = db.prepare(

    'SELECT * FROM league_picks WHERE league_id = ? AND user_id = ? ORDER BY added_at DESC'

  ).all(leagueId, userId);



  res.json({ picks: picks });

});



// DELETE /api/leagues/:id/picks/:pickId - remove a pick

router.delete('/:id/picks/:pickId', function(req, res) {

  var leagueId = parseInt(req.params.id);

  var pickId = parseInt(req.params.pickId);



  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);

  if (!league) return res.status(404).json({ error: 'League not found' });



  var status = getLeagueStatus(league.start_date, league.end_date);

  if (status === 'ended') return res.status(400).json({ error: 'League has ended' });



  var pick = db.prepare('SELECT * FROM league_picks WHERE id = ? AND league_id = ? AND user_id = ?').get(pickId, leagueId, req.user.id);

  if (!pick) return res.status(404).json({ error: 'Pick not found' });



  db.prepare('DELETE FROM league_picks WHERE id = ?').run(pickId);

  res.json({ message: 'Removed ' + pick.symbol });

});



// DELETE /api/leagues/:id/leave - leave a league

router.delete('/:id/leave', function(req, res) {

  var leagueId = parseInt(req.params.id);

  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(leagueId);

  if (!league) return res.status(404).json({ error: 'League not found' });



  if (league.creator_id === req.user.id) {

    return res.status(400).json({ error: 'Creator cannot leave. Delete the league instead.' });

  }



  db.prepare('DELETE FROM league_members WHERE league_id = ? AND user_id = ?').run(leagueId, req.user.id);

  db.prepare('DELETE FROM league_picks WHERE league_id = ? AND user_id = ?').run(leagueId, req.user.id);



  res.json({ message: 'Left the league' });

});



// DELETE /api/leagues/:id - delete a league (creator only)

router.delete('/:id', function(req, res) {

  var league = db.prepare('SELECT * FROM leagues WHERE id = ?').get(req.params.id);

  if (!league) return res.status(404).json({ error: 'League not found' });

  if (league.creator_id !== req.user.id) {

    return res.status(403).json({ error: 'Only the creator can delete this league' });

  }



  db.prepare('DELETE FROM league_picks WHERE league_id = ?').run(league.id);

  db.prepare('DELETE FROM league_members WHERE league_id = ?').run(league.id);

  db.prepare('DELETE FROM leagues WHERE id = ?').run(league.id);



  res.json({ message: 'League deleted' });

});



// Helper: determine league status from dates

function getLeagueStatus(start_date, end_date) {

  var now = new Date().toISOString().split('T')[0];

  if (now < start_date) return 'upcoming';

  if (now > end_date) return 'ended';

  return 'active';

}



module.exports = router;
