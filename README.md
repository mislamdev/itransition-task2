# Stock Chart — single-page web app (Ruby on Rails)

Task 3.5 (Ruby group). A minimal one-page web application that lets the user
type a stock symbol (or company name) into an autocomplete field and view an
interactive candlestick / area chart with several date ranges.

Built with **Ruby on Rails 8.1**, **ApexCharts** (CDN), and **Finnhub** as the
data source.

---

## Features

- **Autocomplete** ticker / company name search powered by Finnhub
  (`/api/search` → Finnhub `/search`).
- **Interactive chart** with:
  - candlestick view (green up / red down)
  - area (line) view
  - 8 date ranges: **1D, 5D, 1W, 1M, 3M, 6M, 1Y, 5Y**
  - built-in **zoom, pan, drag-to-select** (powered by ApexCharts)
  - **crosshair**, tooltips, range-reset toolbar
- Live **quote summary** (current price, day change, % change, currency).
- **Mobile-friendly** layout with a responsive header/controls,
  44 px tap targets, `viewport-fit=cover`, and touch-friendly chart.
- **Dark theme** that reads well on desktop and mobile.
- The Finnhub API key is kept **server-side**; the browser only talks to
  `/api/*` proxy endpoints. The API key never leaks into JavaScript.

---

## Quick start

```bash
# 1. Install Ruby (any 3.x or newer) and Bundler.

# 2. Get a free API key from https://finnhub.io/dashboard

# 3. Configure once via .env (no shell exports needed afterwards):
cp stock_chart/.env.example stock_chart/.env
# Edit stock_chart/.env and set FINNHUB_API_KEY=your_real_key

# 4. Install gems and boot:
cd stock_chart
bundle install
../start.sh
# Server is reachable at http://<your-ip>:3000/
```

`start.sh` reads `stock_chart/.env` (using `dotenv-rails`) so you don't
have to export environment variables every time you boot. **Anything you
export in the shell still overrides `.env`.** The script also prints a
quick status summary so you know which mode the server is in.

`start.sh` accepts a few optional flags:

```bash
./start.sh                   # default: 0.0.0.0:3000
./start.sh --loopback        # bind on 127.0.0.1 only
./start.sh --port 8080       # use a different port
```

### `.env` reference

The `.env` file lives at `stock_chart/.env` (git-ignored).  See
`stock_chart/.env.example` for the template.

| Variable             | Default      | Notes                                                    |
| -------------------- | ------------ | -------------------------------------------------------- |
| `FINNHUB_API_KEY`    | _(unset)_    | Your Finnhub API key. From https://finnhub.io/dashboard. |
| `FINNHUB_DEMO`       | `0`          | `1` skips Finnhub and serves synthetic OHLC. UI shows a yellow banner. |
| `BIND`               | `0.0.0.0`    | `0.0.0.0` for LAN-reachable, `127.0.0.1` for loopback.    |
| `PORT`               | `3000`       | TCP port.                                                |

### Manual start (without `start.sh`)

```bash
cd stock_chart
bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000
# FINNHUB_API_KEY etc. come from .env automatically (via dotenv-rails)
# or you can export them in your shell to override.
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

The full controller lives in `stock_chart/app/controllers/stocks_controller.rb`.

### Frontend

- `app/views/stocks/index.html.erb` — the single-page layout.
- `public/assets/application.css`  — all styling (dark theme, responsive).
- `public/assets/application.js`   — autocompletion, chart rendering,
  range / chart-type switching, URL-state persistence.

ApexCharts is loaded from `cdn.jsdelivr.net` — no build step, no bundler.

### Errors / failure modes

- **Missing or invalid API key** → upstream JSON has `{"error":"Invalid API
  key."}`; the chart shows the message under it instead of failing silently.
- **Ticker with no data on the chosen range** → the chart shows "No data
  available for SYMBOL on the RANGE range" and the empty-state hint returns.
- **Network errors** → status line under the chart names the error.

### Demo mode (no API key required for trying it out)

If `FINNHUB_API_KEY` is unset or set to `"demo"`, the app **does not call
Finnhub at all** — it returns a small set of synthetic, deterministic
OHLC + quote data so the chart, autocomplete, and quote summary are all
fully functional. The synthetic walk is the same for every symbol on the
same minute, which makes it ideal for trying the UI quickly without
signing up for an API key.

To **enable real data**, set `FINNHUB_API_KEY` to your real key from
https://finnhub.io:

```bash
FINNHUB_API_KEY=xxxxxxxxxxxxxxxxxxxx ./start.sh
```

With a real key on the **free tier**, intraday resolutions (1D, 5D, 1W)
may come back empty because Finnhub reserves 1/5/15/30/60-minute data
for paid customers. The app handles this automatically — if a finer
resolution returns no data it falls back to a coarser one (daily, then
weekly, etc.) and the status line under the chart tells you which
resolution was used.

---

## Deployment notes

- `RAILS_ENV=production` works out of the box once you have a real
  `RAILS_MASTER_KEY` (already provisioned), or you can run in development.
- For HTTPS / real hosting, put the app behind any standard reverse proxy
  (nginx, Caddy, fly.io's proxy, etc.). Override `PORT` and `BIND` via env.
- A free-tier **Finnhub** key allows 60 API calls / minute and is plenty
  for a demo. If you hit the limit the upstream will reply with 429 and
  the chart status line will show "Too Many Requests".

---

## Project layout

```
./
├── start.sh                          # Convenience launcher
├── README.md                         # This file
└── stock_chart/                      # Rails application
    ├── Gemfile
    ├── config/
    │   ├── application.rb           # api_only = false so we can render ERB
    │   ├── routes.rb                # routes root + /api/*
    │   ├── puma.rb                  # binds on $BIND:$PORT (default 0.0.0.0:3000)
    │   └── initializers/cors.rb     # permissive CORS for the JSON API
    ├── app/
    │   ├── controllers/
    │   │   ├── application_controller.rb
    │   │   └── stocks_controller.rb  # The proxy + asset-serving actions
    │   └── views/
    │       └── stocks/
    │           └── index.html.erb   # The single page
    ├── public/
    │   └── assets/
    │       ├── application.css
    │       └── application.js
    └── ...
```
