# Stock Chart — single-page web app (Ruby on Rails)

Task 3.5 (Ruby group). A minimal one-page web application that lets the user
type a stock symbol (or company name) into an autocomplete field and view an
interactive candlestick / area chart with several date ranges.

Built with **Ruby on Rails 8.1**, **lightweight-charts** (TradingView's
open-source charting library), and **Finnhub** as the data source.

---

## Features

- **Autocomplete** ticker / company name search powered by Finnhub
  (`/api/search` → Finnhub `/search`).
- **Interactive chart** with:
  - candlestick view (green up / red down)
  - area (line) view
  - 8 date ranges: **1D, 5D, 1W, 1M, 3M, 6M, 1Y, 5Y**
  - built-in **zoom, pan, drag-to-select** (powered by lightweight-charts)
  - touch-friendly crosshair and tooltip
- Live **quote summary** (current price, day change, % change, currency).
- **Mobile-responsive** layout with a responsive header/controls,
  44 px tap targets, `viewport-fit=cover`.
- **Dark theme** that reads well on desktop and mobile.
- The Finnhub API key is kept **server-side**; the browser only talks to
  `/api/*` proxy endpoints.  The API key never leaks into JavaScript.

---

## Quick start (local)

```bash
# 1. Install Ruby 3.4.x or newer (Homebrew's `ruby` formula ships 4.0.x
#    which is also fine; Render ships 3.4.4 by default).

# 2. Get a free API key from https://finnhub.io/dashboard (free tier:
#    60 calls/min, includes /search and /quote; restricts /stock/candle).

# 3. Configure once via .env (no shell exports needed afterwards):
cp .env.example .env
# Edit .env and set FINNHUB_API_KEY=your_real_key_from_finnhub

# 4. Install gems and boot:
bundle install
./start.sh
# Server is reachable at http://<your-ip>:3000/
```

`start.sh` reads `.env` (using `dotenv-rails`) so you don't have to
export environment variables every time you boot. **Anything you
export in the shell still overrides `.env`.**

`start.sh` accepts a few optional flags:

```bash
./start.sh                   # default: 0.0.0.0:3000
./start.sh --loopback        # bind on 127.0.0.1 only
./start.sh --port 8080       # use a different port
```

### `.env` reference

See `.env.example` for the template.  The real `.env` is git-ignored.

| Variable             | Default      | Notes                                                    |
| -------------------- | ------------ | -------------------------------------------------------- |
| `FINNHUB_API_KEY`    | _(unset)_    | Your Finnhub API key. From https://finnhub.io/dashboard. |
| `FINNHUB_DEMO`       | `0`          | `1` skips Finnhub and serves synthetic OHLC. UI shows a yellow banner. |
| `BIND`               | `0.0.0.0`    | `0.0.0.0` for LAN-reachable, `127.0.0.1` for loopback.    |
| `PORT`               | `3000`       | TCP port.                                                |

### Manual start (without `start.sh`)

```bash
bundle install
bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000
# FINNHUB_API_KEY etc. come from .env automatically (via dotenv-rails).
# Export them in your shell to override.
```

---

## How it works

### Backend (Rails 8.1)

| Route                  | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `GET /`                | Serves the single-page UI (`app/views/stocks/index.html.erb`).        |
| `GET /api/search?q=…`  | Proxy → Finnhub `/search` (autocomplete).                            |
| `GET /api/quote?…`     | Proxy → Finnhub `/quote` (current price + day change).               |
| `GET /api/candle?…`    | Proxy → Finnhub `/stock/candle`. Translates `1D/5D/.../5Y` into the `(from, to, resolution)` Finnhub expects. |
| `GET /api/profile?…`   | Proxy → Finnhub `/stock/profile2` (company name + currency).         |

Static assets (`/assets/application.css`, `/assets/application.js`) are served
directly from `public/assets/`, no asset pipeline required.

The full controller lives in `app/controllers/stocks_controller.rb`.

### Frontend

- `app/views/stocks/index.html.erb` — the single-page layout.
- `app/assets/stylesheets/application.css`  — dark theme, responsive.
- `app/assets/javascripts/application.js`   — autocomplete, chart rendering,
  range / chart-type switching, URL-state persistence.

`lightweight-charts` is loaded from `unpkg.com` — no build step, no bundler.

### Modes

- **Default** (no `FINNHUB_DEMO`) goes to real Finnhub and surfaces upstream
  errors verbatim. If the user's account tier blocks `/stock/candle` (403),
  the controller transparently falls back to synthetic demo data so the
  chart still draws, with a status line that explains the fallback.
- **`FINNHUB_DEMO=1`** forces synthetic data for every endpoint; the page
  shows a yellow **"Demo mode active"** banner so it's never mistaken for
  live data.

### Intraday resolution auto-downgrade

Finnhub's free tier doesn't include 1/5/15/30/60-minute data for any
symbol.  When the controller requests intraday bars and gets nothing back,
it walks down to daily bars (then weekly, then monthly) until it finds
something.  The status line under the chart tells the user which resolution
actually rendered.

---

## Deploying on Render

The repository ships with a `render.yaml` blueprint so you can stand up
the service in a single click.

### One-shot Blueprint deploy (recommended)

1. Go to <https://dashboard.render.com/select-repo> and connect this repo.
2. Render finds `render.yaml` and shows what to provision:
   ```
   stock-chart (Web Service)
   ├── Runtime:  Ruby 3.4
   ├── Plan:     Free
   ├── Branch:   main
   ```
   Apply. Render opens the service dashboard.
3. **Environment → set the two secret env vars** (the rest are auto-set):
   - `FINNHUB_API_KEY`  — your real Finnhub key
   - `RAILS_MASTER_KEY` — paste contents of `config/master.key` (32 hex chars)
4. Render triggers a fresh deploy. Watch the **Events** tab for:
   ```
   ==> Installing Ruby 3.4.4
   ==> bundle install
   ==> bundle exec rake assets:precompile || true
   ==> cp app/assets/*.{css,js} public/assets/
   ==> bundle exec puma -C config/puma.rb -e production
   * Listening on tcp://0.0.0.0:10000
   ```
5. Once the **Live** badge appears, your app is reachable at
   **`https://stock-chart.onrender.com`**.

### Manual Web Service (alternative)

If you skipped the Blueprint:

| Setting          | Value                                                                |
| ---------------- | -------------------------------------------------------------------- |
| Runtime          | **Ruby**                                                             |
| Build command    | `bundle config set --local without 'development test' && bundle install && bundle exec rake assets:precompile \|\| true && mkdir -p public/assets && cp -f app/assets/stylesheets/application.css public/assets/application.css && cp -f app/assets/javascripts/application.js public/assets/application.js` |
| Start command    | `bundle exec puma -C config/puma.rb -e production`                    |
| Health check path| `/`                                                                   |
| Env vars         | `RAILS_ENV=production`, `RAILS_SERVE_STATIC_FILES=true`, `RAILS_LOG_TO_STDOUT=true`, `RAILS_MASTER_KEY=<contents of master.key>`, `FINNHUB_API_KEY=<your key>`, `FINNHUB_DEMO=0` |

### Notes

- **No database** — the app is stateless, so no Postgres to add.
- **Free tier behavior** — Render spins down the service after ~15 min of
  inactivity. The first request after that takes ~30s to wake up. Upgrade to
  the `starter` plan ($7/mo) to keep it always-on.
- **Custom domain** — Render auto-provisions `https://<service-name>.onrender.com`;
  bring your own via the Custom Domains tab.

---

## Project layout

```
./
├── .env.example              # Template — copy to .env and edit
├── .gitignore                # Excludes .env, logs, tmp, generated assets, etc.
├── README.md                 # This file
├── start.sh                  # Local launcher with .env loading
├── render.yaml               # Render Blueprint (one-click deploy)
├── Gemfile + Gemfile.lock    # Ruby 3.4.4 + Rails 8.1
├── Procfile                  # Render / Heroku start command
├── app/
│   ├── controllers/
│   │   ├── application_controller.rb
│   │   └── stocks_controller.rb   # The proxy + helper methods
│   ├── views/stocks/index.html.erb
│   └── assets/
│       ├── stylesheets/application.css
│       └── javascripts/application.js
├── public/assets/             # Mirrored from app/assets/* on each start.sh boot
├── config/                    # application.rb, routes.rb, puma.rb, cors.rb, environments, etc.
└── log/, tmp/, storage/       # Standard Rails runtime dirs (gitignored)
```
