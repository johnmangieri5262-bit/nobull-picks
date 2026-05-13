# Deployment Guide — NoBull Picks

## Option 1: Docker (Recommended)

### One-command local deploy:
```bash
# Clone/copy the project, then:
docker compose up -d --build

# Seed the database with demo data:
docker compose exec app node seed.js

# View logs:
docker compose logs -f app
```

App runs at **http://localhost:3000**

### Stop / Restart:
```bash
docker compose down      # stop
docker compose up -d     # restart (data persists)
docker compose down -v   # stop AND delete database
```

---

## Option 2: Railway (Free tier available)

1. Push code to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set environment variables:
   ```
   JWT_SECRET=[REDACTED_PASSWORD]
   INVITE_CODE=NOBULL2026
   PORT=3000
   ```
4. Railway auto-detects the Dockerfile and deploys
5. Run the seed: Railway Dashboard → your service → Settings → run `node seed.js`

---

## Option 3: Render

1. Push to GitHub
2. [render.com](https://render.com) → New Web Service → connect repo
3. Settings:
   - **Build command:** `cd server && npm ci`
   - **Start command:** `cd server && node index.js`
   - **Environment:** Node
4. Add env vars (same as Railway above)
5. Add a **Disk** mount at `/app/server/data` for SQLite persistence

---

## Option 4: Fly.io

```bash
# Install flyctl, then:
fly launch --name nobull-picks
fly secrets set JWT_SECRET=[REDACTED_PASSWORD]
fly secrets set INVITE_CODE=NOBULL2026
fly volumes create data --size 1

# Add to fly.toml:
# [mounts]
#   source = "data"
#   destination = "/app/server/data"

fly deploy
fly ssh console -C "node /app/server/seed.js"
```

---

## Option 5: VPS (DigitalOcean, Linode, etc.)

```bash
# SSH into your server
git clone <your-repo> /opt/nobull-picks
cd /opt/nobull-picks/server

# Install Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install deps & seed
npm ci --production
cp .env.example .env
# Edit .env with your JWT_SECRET
node seed.js

# Run with PM2
npm install -g pm2
pm2 start index.js --name nobull-picks
pm2 save
pm2 startup

# Nginx reverse proxy (optional but recommended)
sudo apt install nginx
```

**Nginx config** (`/etc/nginx/sites-available/nobull-picks`):
```nginx
server {
    listen 80;
    server_name picks.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then enable HTTPS with Certbot:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d picks.yourdomain.com
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port |
| `JWT_SECRET` | **Yes** | - | Secret for signing tokens (use a long random string) |
| `INVITE_CODE` | No | NOBULL2026 | Default invite code |
| `DB_PATH` | No | ./data/nobullpicks.db | SQLite database path |
| `PRICE_CRON` | No | */5 9-16 * * 1-5 | Price fetch schedule |
| `CORS_ORIGIN` | No | * | Allowed CORS origins |

---

## Post-Deploy Checklist

- [ ] Set a strong `JWT_SECRET` (e.g. `openssl rand -base64 32`)
- [ ] Run `node seed.js` to create initial data
- [ ] Change admin password (default: admin / admin123)
- [ ] Create your first real invite code via admin API
- [ ] Test registration flow
- [ ] Verify price fetching is running (check logs)
- [ ] Set up database backups (copy the .db file periodically)

---

## Database Backup

SQLite is a single file. Back it up with:
```bash
# Docker:
docker compose exec app cp data/nobullpicks.db data/backup-$(date +%Y%m%d).db

# VPS:
cp /opt/nobull-picks/server/data/nobullpicks.db ~/backups/nobullpicks-$(date +%Y%m%d).db
```

Set up a daily cron:
```bash
0 2 * * * cp /opt/nobull-picks/server/data/nobullpicks.db /backups/nobullpicks-$(date +\%Y\%m\%d).db
```
