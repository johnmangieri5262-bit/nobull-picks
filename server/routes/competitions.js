// routes/competitions.js — Competition management
const express = require('express');
const db = require('../database');
const { authenticate, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/competitions — list all competitions
router.get('/', (req, res) => {
  const competitions = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(DISTINCT p.user_id) FROM picks p WHERE p.competition_id = c.id) as player_count,
      (SELECT COUNT(*) FROM picks p WHERE p.competition_id = c.id) as total_picks
    FROM competitions c
    ORDER BY c.year DESC, c.lock_date DESC
  `).all();
  res.json({ competitions });
});

// GET /api/competitions/active — get current active/drafting competition
router.get('/active', (req, res) => {
  const comp = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(DISTINCT p.user_id) FROM picks p WHERE p.competition_id = c.id) as player_count,
      (SELECT COUNT(*) FROM picks p WHERE p.competition_id = c.id) as total_picks
    FROM competitions c
    WHERE c.status IN ('drafting', 'active')
    ORDER BY c.lock_date ASC
    LIMIT 1
  `).get();
  
  if (!comp) {
    return res.status(404).json({ error: 'No active competition' });
  }
  res.json({ competition: comp });
});

// GET /api/competitions/:id — get competition details
router.get('/:id', (req, res) => {
  const comp = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(DISTINCT p.user_id) FROM picks p WHERE p.competition_id = c.id) as player_count,
      (SELECT COUNT(*) FROM picks p WHERE p.competition_id = c.id) as total_picks
    FROM competitions c WHERE c.id = ?
  `).get(req.params.id);
  
  if (!comp) return res.status(404).json({ error: 'Competition not found' });
  res.json({ competition: comp });
});

// GET /api/competitions/:id/leaderboard — full leaderboard
router.get('/:id/leaderboard', (req, res) => {
  const compId = req.params.id;
  
  // Get all users with their picks for this competition
  const players = db.prepare(`
    SELECT 
      u.id as user_id,
      u.display_name,
      COUNT(p.id) as pick_count,
      AVG(p.return_pct) as avg_return,
      MAX(p.return_pct) as best_return,
      MIN(p.return_pct) as worst_return,
      GROUP_CONCAT(p.symbol || ':' || ROUND(p.return_pct, 2), ',') as picks_detail
    FROM users u
    JOIN picks p ON p.user_id = u.id AND p.competition_id = ?
    GROUP BY u.id
    HAVING pick_count >= 1
    ORDER BY avg_return DESC
  `).all(compId);

  // Find best pick per player
  const leaderboard = players.map((player, idx) => {
    const picksArr = player.picks_detail ? player.picks_detail.split(',') : [];
    let bestPick = { symbol: '-', returnPct: 0 };
    picksArr.forEach(p => {
      const [sym, ret] = p.split(':');
      if (parseFloat(ret) > bestPick.returnPct) {
        bestPick = { symbol: sym, returnPct: parseFloat(ret) };
      }
    });

    return {
      rank: idx + 1,
      user_id: player.user_id,
      display_name: player.display_name,
      pick_count: player.pick_count,
      avg_return: Math.round(player.avg_return * 100) / 100,
      best_return: Math.round(player.best_return * 100) / 100,
      worst_return: Math.round(player.worst_return * 100) / 100,
      best_pick: bestPick.symbol + ' ' + (bestPick.returnPct >= 0 ? '+' : '') + bestPick.returnPct.toFixed(1) + '%'
    };
  });

  res.json({ leaderboard, competition_id: parseInt(compId) });
});

// POST /api/competitions — create competition (admin only)
router.post('/', authenticate, adminOnly, (req, res) => {
  const { name, type, quarter, year, draft_start, lock_date, end_date } = req.body;

  if (!name || !type || !year || !draft_start || !lock_date || !end_date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = db.prepare(`
    INSERT INTO competitions (name, type, quarter, year, draft_start, lock_date, end_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'upcoming')
  `).run(name, type, quarter || null, year, draft_start, lock_date, end_date);

  res.status(201).json({ id: result.lastInsertRowid, message: 'Competition created' });
});

// PATCH /api/competitions/:id/status — update competition status (admin only)
router.patch('/:id/status', authenticate, adminOnly, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['upcoming', 'drafting', 'active', 'ended'];
  
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  // If transitioning to "active", lock all picks and record entry prices
  if (status === 'active') {
    const unlocked = db.prepare(`
      SELECT p.* FROM picks p WHERE p.competition_id = ? AND p.locked = 0
    `).all(req.params.id);

    // Lock picks - entry_price should already be set from the price fetcher
    db.prepare(`
      UPDATE picks SET locked = 1, entry_price = COALESCE(entry_price, current_price) 
      WHERE competition_id = ? AND locked = 0
    `).run(req.params.id);

    // Remove players with fewer than 3 picks
    const underMin = db.prepare(`
      SELECT user_id, COUNT(*) as cnt FROM picks 
      WHERE competition_id = ? GROUP BY user_id HAVING cnt < 3
    `).all(req.params.id);

    for (const u of underMin) {
      db.prepare('DELETE FROM picks WHERE competition_id = ? AND user_id = ?').run(req.params.id, u.user_id);
    }
  }

  db.prepare('UPDATE competitions SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ message: `Competition status updated to ${status}` });
});

module.exports = router;
