// websocket.js — WebSocket server for real-time leaderboard & price updates
const { WebSocketServer } = require('ws');
const db = require('./database');

let wss = null;
const clients = new Map(); // ws → { userId, competitionId }

function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    console.log('[WS] Client connected');

    // Track client
    clients.set(ws, { userId: null, competitionId: null });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(ws, msg);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log('[WS] Client disconnected. Active:', clients.size);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });

    // Send initial connection acknowledgment
    ws.send(JSON.stringify({ type: 'connected', clients: clients.size }));
  });

  console.log('[WS] WebSocket server initialized at /ws');
  return wss;
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'subscribe':
      // Client subscribes to a competition's updates
      const info = clients.get(ws);
      if (info) {
        info.userId = msg.userId || null;
        info.competitionId = msg.competitionId || null;
      }
      ws.send(JSON.stringify({ type: 'subscribed', competitionId: msg.competitionId }));
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    default:
      break;
  }
}

// Broadcast leaderboard update to all clients watching a competition
function broadcastLeaderboard(competitionId) {
  if (!wss) return;

  const leaderboard = getLeaderboard(competitionId);
  const payload = JSON.stringify({
    type: 'leaderboard_update',
    competitionId: competitionId,
    leaderboard: leaderboard,
    timestamp: Date.now()
  });

  let sent = 0;
  clients.forEach((info, ws) => {
    if (ws.readyState === 1 && info.competitionId === competitionId) {
      ws.send(payload);
      sent++;
    }
  });

  if (sent > 0) console.log(`[WS] Broadcast leaderboard to ${sent} clients (comp ${competitionId})`);
}

// Broadcast price updates
function broadcastPriceUpdate(symbols) {
  if (!wss) return;

  const payload = JSON.stringify({
    type: 'price_update',
    symbols: symbols,
    timestamp: Date.now()
  });

  let sent = 0;
  clients.forEach((info, ws) => {
    if (ws.readyState === 1 && info.competitionId) {
      ws.send(payload);
      sent++;
    }
  });

  if (sent > 0) console.log(`[WS] Broadcast price update to ${sent} clients`);
}

// Broadcast when a new pick is added/removed
function broadcastPickChange(competitionId, action, data) {
  if (!wss) return;

  const payload = JSON.stringify({
    type: 'pick_change',
    competitionId: competitionId,
    action: action, // 'added' or 'removed'
    data: data,
    timestamp: Date.now()
  });

  clients.forEach((info, ws) => {
    if (ws.readyState === 1 && info.competitionId === competitionId) {
      ws.send(payload);
    }
  });
}

// Broadcast competition status change
function broadcastStatusChange(competitionId, newStatus) {
  if (!wss) return;

  const payload = JSON.stringify({
    type: 'competition_status',
    competitionId: competitionId,
    status: newStatus,
    timestamp: Date.now()
  });

  // Broadcast to ALL connected clients
  clients.forEach((info, ws) => {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  });
}

// Helper: compute leaderboard from DB
function getLeaderboard(competitionId) {
  const players = db.prepare(`
    SELECT 
      u.id as user_id,
      u.display_name,
      COUNT(p.id) as pick_count,
      AVG(p.return_pct) as avg_return,
      MAX(p.return_pct) as best_return
    FROM users u
    JOIN picks p ON p.user_id = u.id AND p.competition_id = ?
    GROUP BY u.id
    HAVING pick_count >= 1
    ORDER BY avg_return DESC
  `).all(competitionId);

  return players.map((p, idx) => ({
    rank: idx + 1,
    user_id: p.user_id,
    display_name: p.display_name,
    pick_count: p.pick_count,
    avg_return: Math.round(p.avg_return * 100) / 100,
    best_return: Math.round(p.best_return * 100) / 100
  }));
}

// Get connection stats
function getStats() {
  return {
    total_connections: clients.size,
    subscriptions: Array.from(clients.values()).filter(c => c.competitionId).length
  };
}

module.exports = {
  initWebSocket,
  broadcastLeaderboard,
  broadcastPriceUpdate,
  broadcastPickChange,
  broadcastStatusChange,
  getStats
};
