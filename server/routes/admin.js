// routes/admin.js — Admin-only endpoints
const express = require('express');
const db = require('../database');
const { authenticate, adminOnly } = require('../middleware/auth');
const { fetchPrices } = require('../jobs/fetchPrices');

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticate);
router.use(adminOnly);

// GET /api/admin/stats — overall platform stats
router.get('/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const picks = db.prepare('SELECT COUNT(*) as count FROM picks').get().count;
  const comps = db.prepare('SELECT COUNT(*) as count FROM competitions').get().count;
  const activeComps = db.prepare("SELECT COUNT(*) as count FROM competitions WHERE status IN ('drafting', 'active')").get().count;

  res.json({ users, picks, competitions: comps, active_competitions: activeComps });
});

// GET /api/admin/users — list all users with their pick counts
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.is_admin, u.created_at,
      (SELECT COUNT(*) FROM picks p WHERE p.user_id = u.id) as pick_count
    FROM users u
    ORDER BY u.created_at DESC
  `).all();
  res.json({ users });
});

// PATCH /api/admin/users/:id — update user (toggle admin, etc.)
router.patch('/users/:id', (req, res) => {
  const { is_admin } = req.body;
  if (is_admin !== undefined) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, req.params.id);
  }
  res.json({ message: 'User updated' });
});

// DELETE /api/admin/users/:id — delete user and their picks
router.delete('/users/:id', (req, res) => {
  const userId = req.params.id;
  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  db.prepare('DELETE FROM picks WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ message: 'User deleted' });
});

// GET /api/admin/invites — list all invite codes
router.get('/invites', (req, res) => {
  const invites = db.prepare(`
    SELECT ic.*, u.display_name as created_by_name
    FROM invite_codes ic
    LEFT JOIN users u ON u.id = ic.created_by
    ORDER BY ic.created_at DESC
  `).all();
  res.json({ invites });
});

// POST /api/admin/invites — create invite code
router.post('/invites', (req, res) => {
  const { code, max_uses } = req.body;
  if (!code) return res.status(400).json({ error: 'Code required' });

  const existing = db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code.toUpperCase());
  if (existing) return res.status(400).json({ error: 'Code already exists' });

  db.prepare('INSERT INTO invite_codes (code, max_uses, created_by, active) VALUES (?, ?, ?, 1)')
    .run(code.toUpperCase(), max_uses || 0, req.user.id);
  
  res.status(201).json({ message: 'Invite code created', code: code.toUpperCase() });
});

// PATCH /api/admin/invites/:id — enable/disable invite code
router.patch('/invites/:id', (req, res) => {
  const { active } = req.body;
  if (active === undefined) return res.status(400).json({ error: 'active field required' });
  db.prepare('UPDATE invite_codes SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
  res.json({ message: 'Invite code updated' });
});

// DELETE /api/admin/invites/:id — delete invite code
router.delete('/invites/:id', (req, res) => {
  db.prepare('DELETE FROM invite_codes WHERE id = ?').run(req.params.id);
  res.json({ message: 'Invite code deleted' });
});

// GET /api/admin/tracked-symbols — symbols currently being tracked
router.get('/tracked-symbols', (req, res) => {
  const symbols = db.prepare(`
    SELECT DISTINCT p.symbol, p.type, p.current_price,
      (SELECT ph.recorded_at FROM price_history ph WHERE ph.symbol = p.symbol ORDER BY ph.recorded_at DESC LIMIT 1) as last_updated
    FROM picks p
    JOIN competitions c ON c.id = p.competition_id
    WHERE c.status IN ('drafting', 'active')
    ORDER BY p.type, p.symbol
  `).all();
  res.json({ symbols });
});

// POST /api/admin/fetch-prices — trigger manual price fetch
router.post('/fetch-prices', async (req, res) => {
  try {
    await fetchPrices();
    const updated = db.prepare(`
      SELECT COUNT(DISTINCT symbol) as count FROM picks
      JOIN competitions ON competitions.id = picks.competition_id
      WHERE competitions.status IN ('drafting', 'active')
    `).get().count;
    res.json({ message: 'Prices fetched', updated });
  } catch (err) {
    res.status(500).json({ error: 'Price fetch failed: ' + err.message });
  }
});

module.exports = router;
