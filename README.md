# NoBull Picks — Fantasy Stock Competition

A fantasy stock picking competition platform where players pick 3-10 investments (stocks, ETFs, crypto) and compete for the best quarterly and yearly returns.

## Architecture

```
fantasy-stocks/
├── index.html              ← Frontend (standalone demo, no backend needed)
├── public/                 ← Frontend (API-connected, served by backend)
│   └── index.html          ← Full app with login/register + real API calls
├── server/
│   ├── index.js            ← Express server entry point
│   ├── database.js         ← SQLite schema & connection
│   ├── seed.js             ← Database seeding script
│   ├── .env.example        ← Environment config template
│   ├── package.json        ← Node.js dependencies
│   ├── middleware/
│   │   └── auth.js         ← JWT authentication
│   ├── routes/
│   │   ├── auth.js         ← Registration & login
│   │   ├── competitions.js ← Competition CRUD & leaderboard
│   │   └── picks.js        ← Stock pick management
│   └── jobs/
│       └── fetchPrices.js  ← Yahoo Finance price fetcher
└── README.md               ← This file
```

## Quick Start

```bash
# 1. Navigate to server directory
cd server

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env
# Edit .env with your own JWT_SECRET

# 4. Seed the database with demo data
npm run seed

# 5. Start the server
npm start        # production
npm run dev      # development (auto-reload)
```

Server runs at `http://localhost:3000`

## API Reference

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/register` | POST | No | Create account |
| `/api/auth/login` | POST | No | Get JWT token |
| `/api/auth/me` | GET | Yes | Current user info |

**Register:**
```json
POST /api/auth/register
{
  "username": "warren",
  "password": "buffett123",
  "display_name": "Warren B.",
  "invite_code": "NOBULL2026"
}
```

**Login:**
```json
POST /api/auth/login
{ "username": "warren", "password": "buffett123" }

→ { "token": "eyJ...", "user": { "id": 1, "display_name": "Warren B." } }
```

### Competitions

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/competitions` | GET | No | List all competitions |
| `/api/competitions/active` | GET | No | Current competition |
| `/api/competitions/:id` | GET | No | Competition details |
| `/api/competitions/:id/leaderboard` | GET | No | Full leaderboard |
| `/api/competitions` | POST | Admin | Create competition |
| `/api/competitions/:id/status` | PATCH | Admin | Update status |

**Leaderboard response:**
```json
{
  "leaderboard": [
    {
      "rank": 1,
      "display_name": "Mike T.",
      "pick_count": 7,
      "avg_return": 8.42,
      "best_pick": "NVDA +22.3%"
    }
  ]
}
```

### Picks

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/picks` | GET | Yes | My picks (active comp) |
| `/api/picks` | POST | Yes | Add a pick |
| `/api/picks/:id` | DELETE | Yes | Remove a pick |
| `/api/picks/portfolio` | GET | Yes | Portfolio summary |
| `/api/picks/user/:id` | GET | Yes | View another player's locked picks |

**Add pick:**
```json
POST /api/picks
Authorization: Bearer <token>
{
  "symbol": "NVDA",
  "name": "NVIDIA Corp.",
  "type": "stock",
  "competition_id": 1
}
```

## Competition Lifecycle

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Upcoming │───▶│ Drafting  │───▶│  Active  │───▶│  Ended   │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                 1 month          Prices locked    Winner
                 Add/remove       Returns tracked  crowned
                 picks freely     No changes
```

**Automatic transitions:**
- `upcoming → drafting`: When `draft_start` date is reached
- `drafting → active`: When `lock_date` is reached (picks locked, entry prices set)
- `active → ended`: When `end_date` is reached

## Scoring

- **Equal-weighted average %** return across all picks
- Each pick counts equally (e.g., 5 picks = 20% each)
- **Tie breaker**: Fewer picks wins (more concentrated = more conviction)
- **Minimum 3 picks** required (players with <3 are removed at lock)

## Price Updates

- **Stocks & ETFs**: Fetched every 5 minutes during market hours (M-F 9:30-4:00 ET)
- **Crypto**: Fetched every 15 minutes including weekends
- Uses [Yahoo Finance API](https://www.npmjs.com/package/yahoo-finance2)
- Price history stored for sparkline charts

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3) — zero config, single file
- **Auth**: JWT tokens, bcrypt password hashing
- **Prices**: yahoo-finance2 npm package
- **Scheduling**: node-cron for price fetches and status transitions
- **Security**: helmet, cors, express-rate-limit
- **Frontend**: Vanilla HTML/CSS/JS (no build step)

## Deployment

Works great on:
- **Railway** / **Render** / **Fly.io** — just set env vars
- **VPS** — run with PM2: `pm2 start server/index.js`
- **Docker** — Dockerfile coming soon

The SQLite database file is stored at `./data/nobullpicks.db`. Back it up periodically.

## Future Enhancements

- [ ] WebSocket for real-time leaderboard updates
- [ ] Email notifications (picks locked, competition ended)
- [ ] Player profiles with historical performance
- [ ] Yearly championship auto-calculation
- [ ] Social features (trash talk / comments)
- [ ] Mobile app (React Native)
- [ ] Public API for custom integrations
