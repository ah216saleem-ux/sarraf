# SARRAF Institutional Gold Analysis & Telegram Dispatch System (Phase 5B)

SARRAF is a full-stack, institutional-grade XAU/USD (Spot Gold) real-time analysis engine, multi-timeframe liquidity validator ($M15$/$M30$/$H1$ with $H4$/$D1$ context), real Forex Factory news catalyst gate, automated Telegram signal dispatch system, and Google Chat institutional war room collaboration platform.

---

## ⚠️ Critical Deployment Notice: Always-On Host & Persistent Volume

SARRAF tracks live prices second-by-second, builds rolling candle history, manages state machines, and runs a Telegram polling worker **24/7**.

**Free hosting providers that sleep (e.g. Render Free tier, Heroku Eco) or platforms without persistent storage are NOT suitable.**
- If the server sleeps, incoming price ticks and candle consolidation will stop, creating gaps.
- If storage is ephemeral, all candle history, settings audit logs, and signal recovery states will be wiped on every redeploy or restart.
- An always-on container or VPS with a persistent volume mounted to `DATA_DIR` is required.

---

## 🚀 Recommended Deployment Option A: Railway (with Persistent Volume)

Railway provides continuous always-on execution and high-performance persistent NVMe disk mounts.

### Step-by-Step Railway Guide:

1. **Push Repository to GitHub**:
   Ensure your repository contains the code, `Dockerfile`, and `package.json`.

2. **Create New Project on Railway**:
   - Navigate to [railway.app](https://railway.app) &rarr; **Dashboard** &rarr; **New Project**.
   - Select **Deploy from GitHub repo** and choose your SARRAF repository.

3. **Attach a Persistent Volume (Mandatory)**:
   - Click on your deployed service in the Railway canvas.
   - Go to **Settings** &rarr; **Volumes** &rarr; **Add Volume**.
   - Set **Mount Path** to: `/app/data`.
   - Railway will automatically mount this volume across all redeploys.

4. **Configure Environment Variables**:
   In Railway Dashboard &rarr; **Variables**, add:
   ```env
   NODE_ENV=production
   PORT=3000
   DATA_DIR=/app/data
   ADMIN_USER=admin@sarraf.gold
   ADMIN_PASS=YourStrongSecurePassword2026!
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   TELEGRAM_CHAT_ID=-1001234567890
   GOOGLE_ALLOWED_EMAILS=a.h216saleem@gmail.com,admin@sarraf.gold
   GEMINI_API_KEY=AIzaSy...
   GEMINI_MODEL=gemini-2.5-flash
   DRY_RUN=true
   DISPLAY_TZ=UTC
   ```

5. **Deploy & Verify Health**:
   - Railway builds the container and starts the server on port `3000`.
   - Test the public minimal health check: `https://your-domain.up.railway.app/api/health` &rarr; returns `{"status":"ok"}`.
   - Log into the dashboard at `https://your-domain.up.railway.app` using your `ADMIN_USER` and `ADMIN_PASS`.

6. **Go-Live Switch**:
   - Open the **GO-LIVE CHECKLIST** tab.
   - Verify all 11 gates are green.
   - Click **SWITCH TO LIVE DISPATCH** (or use admin override with the phrase `CONFIRM INSTITUTIONAL LIVE DISPATCH`).

---

## 🖥️ Recommended Deployment Option B: Ubuntu Linux VPS (PM2 or Docker)

### Option B1: Systemd / PM2 on Ubuntu 22.04 / 24.04 LTS

1. **SSH into your VPS**:
   ```bash
   ssh root@your-server-ip
   ```

2. **Install Node.js 22 & Build Tools**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
   apt-get install -y nodejs git curl
   npm install -g pm2 tsx
   ```

3. **Clone and Build**:
   ```bash
   git clone <your-repo-url> /opt/sarraf
   cd /opt/sarraf
   npm ci
   npm run build
   ```

4. **Configure `.env`**:
   ```bash
   cp .env.example .env
   nano .env
   ```

5. **Start with PM2 (Auto-Restart on Reboot)**:
   ```bash
   pm2 start "npm start" --name sarraf
   pm2 save
   pm2 startup
   ```

### Option B2: Docker & Docker Compose

```bash
docker build -t sarraf:latest .
docker run -d \
  --name sarraf \
  --restart always \
  -p 3000:3000 \
  -v /var/lib/sarraf-data:/app/data \
  --env-file .env \
  sarraf:latest
```

---

## 🔑 Environment Variables Reference

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `PORT` | No | `3000` | HTTP port for the full-stack server. |
| `NODE_ENV` | Yes | `production` | Production mode activates security headers and SPA static serving. |
| `DATA_DIR` | Yes | `./data` | Absolute or relative path to the persistent storage directory. |
| `ADMIN_USER` | Yes | `admin@sarraf.gold` | Admin email login identifier. |
| `ADMIN_PASS` | Yes | `SarrafAdmin2026!` | Admin password (min 12 characters, hashed at rest). |
| `TELEGRAM_BOT_TOKEN` | Yes | _None_ | Telegram Bot Token from `@BotFather`. |
| `TELEGRAM_CHAT_ID` | Yes | _None_ | Target Telegram Channel or Group ID (e.g., `-1001234567890`). |
| `GOOGLE_ALLOWED_EMAILS`| No | _None_ | Comma-separated whitelist of Google accounts for pre-review actions. |
| `GEMINI_API_KEY` | No | _None_ | Google AI Studio Gemini API key for signal validation. |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model alias for validation & macro chat. |
| `DRY_RUN` | No | `true` | `true` logs to outbox without dispatch; `false` sends live Telegram messages. |
| `DISPLAY_TZ` | No | `UTC` | Timezone displayed across dashboard and signal telemetry. |

---

## 🤖 How to Connect the Telegram Bot

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot`, choose a name (e.g. `SARRAF Gold Signal Bot`) and username (e.g. `sarraf_gold_bot`).
3. Copy the HTTP API token into `TELEGRAM_BOT_TOKEN` in your `.env`.
4. Create a **Private Telegram Channel** or Group.
5. Add your new bot as an **Administrator** with *Post Messages* permission.
6. Retrieve your channel ID (starts with `-100...`) and paste into `TELEGRAM_CHAT_ID`.
7. Test the connection from the dashboard via **SEND TEST MESSAGE**.

---

## 🔄 Automated Backups & Restoration Flow

- **Daily Rolling Backups**: The server automatically creates a JSON snapshot in `DATA_DIR/backups/backup_YYYY-MM-DDTHH-mm-ss.json` every 24 hours, retaining the last 7 daily archives.
- **Corrupted File Auto-Fallback**: If a file (`candles.json`, `signals.json`, `settings.json`) is corrupted on restart, the engine automatically extracts the latest valid copy from the backup archives and alerts the admin.
- **Manual Download**: Go to the **GO-LIVE CHECKLIST** tab and click **Download Latest Backup**.
- **Manual Restore**: Click **Restore** next to any archived snapshot to immediately re-hydrate memory and restart candle/signal manager loops cleanly.

---

## 📋 Pre-Flight Go-Live Checklist (11 Gates)

1. [x] **XAU/USD Live Spot Telemetry**: Biquote.io stream active, quote age $< 5$s.
2. [x] **SARRAF Engine Buffers**: $M15$, $M30$, $H1$ stores consolidated & usable.
3. [x] **H4 & D1 Multi-Timeframe Context**: Higher-timeframe market structure aligned.
4. [x] **Forex Factory News Catalyst**: Real news calendar loaded with automated lock gates.
5. [x] **Gemini AI Intelligence Validator**: API key authenticated and prompt checks operational.
6. [x] **Telegram Bot Relay**: Bot connected and outbox idempotency lock active.
7. [x] **DATA_DIR Persistence**: Mounted persistent volume verified.
8. [x] **Automated Rolling Backups**: 7-day rolling snapshots active.
9. [x] **Single-Instance Lease Lock**: Lease exclusivity held by instance ID.
10. [x] **Clock Synchronization**: Server clock drift $< 3000$ms relative to tick stream.
11. [x] **DRY RUN Lifecycle Verification**: At least 5 complete signal lifecycles verified.

---

## ⚖️ Institutional Risk Disclaimer

*Trading foreign exchange and spot commodities on margin carries a high level of risk and may not be suitable for all investors. Signals generated by SARRAF are algorithmic telemetry and do not constitute financial advice. Past performance is not indicative of future results.*
