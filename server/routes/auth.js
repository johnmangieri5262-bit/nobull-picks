// routes/auth.js — Registration & Login
const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../database');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password, display_name, invite_code } = req.body;

    // Validate inputs
    if (!username || !password || !display_name || !invite_code) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (display_name.length > 20) {
      return res.status(400).json({ error: 'Display name must be 20 characters or less' });
    }

    // Validate invite code
    const invite = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND active = 1').get(invite_code.toUpperCase());
    if (!invite) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }
    if (invite.max_uses > 0 && invite.use_count >= invite.max_uses) {
      return res.status(400).json({ error: 'Invite code has been used up' });
    }

    // Check if username exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
    if (existing) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    // Create user
    const password_hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)'
    ).run(username.toLowerCase(), password_hash, display_name);

    // Increment invite code usage
    db.prepare('UPDATE invite_codes SET use_count = use_count + 1 WHERE id = ?').run(invite.id);

    const user = { id: result.lastInsertRowid, username: username.toLowerCase(), is_admin: 0 };
    const token = generateToken(user);

    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, display_name, is_admin: 0 }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me — get current user info
router.get('/me', (req, res) => {
  // This route requires auth middleware to be applied at the router level
  const { authenticate } = require('../middleware/auth');
  authenticate(req, res, () => {
    const user = db.prepare('SELECT id, username, display_name, is_admin, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  });
});

module.exports = router;
