// routes/picks.js — Stock pick management
const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { broadcastLeaderboard, broadcastPickChange } = require('../websocket');

const router = express.Router();

// All pick routes require authentication
router.use(authenticate);

// GET /api/picks — get current user's picks for active competition
router.get('/', (req, res) => {
  const compId = req.query.competition_id;
  
  let picks;
  if (compId) {
    picks = db.prepare(`
      SELECT p.*, c.status as comp_status FROM picks p
      JOIN competitions c ON c.id = p.competition_id
      WHERE p.user_id = ? AND p.competition_id = ?
      ORDER BY p.added_at DESC
    `).all(req.user.id, compId);
  } else {
    // Get picks for the active/drafting competition
    picks = db.prepare(`
      SELECT p.*, c.status as comp_status, c.name as comp_name FROM picks p
      JOIN competitions c ON c.id = p.competition_id
      WHERE p.user_id = ? AND c.status IN ('drafting', 'active')
      ORDER BY p.added_at DESC
    `).all(req.user.id);
  }

  res.json({ picks });
});

// GET /api/picks/user/:userId — get another user's picks (public view)
router.get('/user/:userId', (req, res) => {
  const compId = req.query.competition_id;
  
  if (!compId) {
    return res.status(400).json({ error: 'competition_id required' });
  }

  const picks = db.prepare(`
    SELECT p.symbol, p.name, p.type, p.return_pct, p.entry_price, p.current_price
    FROM picks p
    WHERE p.user_id = ? AND p.competition_id = ? AND p.locked = 1
    ORDER BY p.return_pct DESC
  `).all(req.params.userId, compId);

  res.json({ picks });
});

// POST /api/picks — add a pick
router.post('/', (req, res) => {
  const { symbol, name, type, competition_id } = req.body;

  // Validate inputs
  if (!symbol || !name || !type || !competition_id) {
    return res.status(400).json({ error: 'symbol, name, type, and competition_id required' });
  }
  if (!['stock', 'etf', 'crypto'].includes(type)) {
    return res.status(400).json({ error: 'type must be stock, etf, or crypto' });
  }

  // Verify competition is in drafting phase
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(competition_id);
  if (!comp) return res.status(404).json({ error: 'Competition not found' });
  if (comp.status !== 'drafting') {
    return res.status(400).json({ error: 'Competition is not in drafting phase' });
  }

  // Check pick count (max 10)
  const count = db.prepare(
    'SELECT COUNT(*) as cnt FROM picks WHERE user_id = ? AND competition_id = ?'
  ).get(req.user.id, competition_id);
  
  if (count.cnt >= 10) {
    return res.status(400).json({ error: 'Maximum 10 picks allowed' });
  }

  // Check for duplicate
  const exists = db.prepare(
    'SELECT id FROM picks WHERE user_id = ? AND competition_id = ? AND symbol = ?'
  ).get(req.user.id, competition_id, symbol.toUpperCase());
  
  if (exists) {
    return res.status(400).json({ error: `Already picked ${symbol}` });
  }

  // Insert pick
  const result = db.prepare(`
    INSERT INTO picks (user_id, competition_id, symbol, name, type)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, competition_id, symbol.toUpperCase(), name, type);

  // Broadcast to all WebSocket clients
  broadcastPickChange(competition_id, 'added', { symbol: symbol.toUpperCase(), user: req.user.id });
  broadcastLeaderboard(competition_id);

  res.status(201).json({
    pick: {
      id: result.lastInsertRowid,
      symbol: symbol.toUpperCase(),
      name,
      type,
      competition_id,
      return_pct: 0,
      locked: 0
    }
  });
});

// DELETE /api/picks/:id — remove a pick (only during drafting)
router.delete('/:id', (req, res) => {
  const pick = db.prepare(`
    SELECT p.*, c.status as comp_status FROM picks p
    JOIN competitions c ON c.id = p.competition_id
    WHERE p.id = ? AND p.user_id = ?
  `).get(req.params.id, req.user.id);

  if (!pick) return res.status(404).json({ error: 'Pick not found' });
  if (pick.locked) {
    return res.status(400).json({ error: 'Cannot remove locked picks' });
  }
  if (pick.comp_status !== 'drafting') {
    return res.status(400).json({ error: 'Competition is no longer in drafting phase' });
  }

  db.prepare('DELETE FROM picks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

  // Broadcast removal
  broadcastPickChange(pick.competition_id, 'removed', { symbol: pick.symbol, user: req.user.id });
  broadcastLeaderboard(pick.competition_id);

  res.json({ message: `Removed ${pick.symbol}` });
});

// GET /api/picks/portfolio — get portfolio summary for current user
router.get('/portfolio', (req, res) => {
  const compId = req.query.competition_id;
  if (!compId) return res.status(400).json({ error: 'competition_id required' });

  const picks = db.prepare(`
    SELECT * FROM picks WHERE user_id = ? AND competition_id = ?
    ORDER BY return_pct DESC
  `).all(req.user.id, compId);

  if (picks.length === 0) {
    return res.json({ portfolio: { picks: [], avg_return: 0, best: null, worst: null, count: 0 } });
  }

  const totalReturn = picks.reduce((sum, p) => sum + (p.return_pct || 0), 0);
  const avgReturn = totalReturn / picks.length;
  const best = picks[0];
  const worst = picks[picks.length - 1];

  res.json({
    portfolio: {
      picks,
      avg_return: Math.round(avgReturn * 100) / 100,
      best: { symbol: best.symbol, return_pct: best.return_pct },
      worst: { symbol: worst.symbol, return_pct: worst.return_pct },
      count: picks.length
    }
  });
});

module.exports = router;
