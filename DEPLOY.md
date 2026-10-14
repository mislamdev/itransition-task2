# Deploying Stock Chart on Render

This is a step-by-step walkthrough for taking the local Git repository to
a live `https://stock-chart.onrender.com` (or your custom domain).

The repository ships with a `render.yaml` Blueprint and a `Procfile`, so the
fastest path is **one-click Blueprint deploy**.  A manual Web-Service setup
is included as a fallback.

---

## 1. Prerequisites

| What                       | Where                                                  |
| -------------------------- | ------------------------------------------------------ |
| GitHub account             | <https://github.com/>                                  |
| Render account             | <https://dashboard.render.com/register>                |
| Finnhub API key            | <https://finnhub.io/dashboard> (free tier works)       |
| `master.key` from this repo | `cat stock_chart/config/master.key` (or just `cat config/master.key` after the recent flatten) |

You'll also be pasting these into Render:

| Key                  | Source                                                                |
| -------------------- | --------------------------------------------------------------------- |
| `FINNHUB_API_KEY`   | The key from Finnhub                                                  |
| `RAILS_MASTER_KEY`   | Contents of `config/master.key` (32 hex characters)                   |

---

## 2. One-click Blueprint deploy (recommended)

1. Push this repo to GitHub if it isn't already.
2. Open <https://dashboard.render.com/blueprints> and click **New Blueprint
   Instance**.
3. Pick the GitHub org/owner and the **`itransition-task2`** repository.
4. Render reads `render.yaml` and offers:
   ```
   stock-chart (Web Service)
   ├── Runtime: Ruby
   ├── Plan:    Free  (change to "Starter" for production)
   ├── Branch:  main
   ```
5. Click **Apply**.  Render opens the new service's dashboard and **starts
   the first deploy immediately** (it'll fail because we haven't set secrets
   yet — that's fine, we'll fix it in the next step).
6. Open **Environment** in the left sidebar. Add/replace:
   - `FINNHUB_API_KEY`  → paste your Finnhub key
   - `RAILS_MASTER_KEY` → paste the contents of `config/master.key`
7. Click **Save Changes**.  Render triggers a fresh build with the new env.
8. Watch the **Events** tab.  You should see:
   ```
   ==> Installing Ruby 4.0.5
   ==> bundle install
   ==> bundle exec rake assets:precompile || true
   ==> cp app/assets/*.{css,js} public/assets/
   ==> bundle exec puma -C config/puma.rb -e production
   * Listening on tcp://0.0.0.0:10000
   ```
9. When the green **Live** badge appears in the top-right corner, your app
   is reachable at **`https://stock-chart.onrender.com`**.

---

## 3. Manual Web Service (alternative to Blueprint)

If you prefer to skip the Blueprint and configure the service by hand:

1. Go to <https://dashboard.render.com/create> and pick **Web Service**.
2. Connect your GitHub account (if not already) and select the repo.
3. Render shows the **Build & Deploy settings**. Fill in:

   | Field                | Value                                                                |
   | -------------------- | -------------------------------------------------------------------- |
   | **Runtime**          | Ruby                                                                  |
   | **Root Directory**   | _leave blank_ (the repo's `Gemfile` is at the root)                |
   | **Build Command**    | `bundle config set --local without 'development test' && bundle install && bundle exec rake assets:precompile \|\| true && mkdir -p public/assets && cp -f app/assets/stylesheets/application.css public/assets/application.css && cp -f app/assets/javascripts/application.js public/assets/application.js` |
   | **Start Command**    | `bundle exec puma -C config/puma.rb -e production`                    |
   | **Health Check Path**| `/`                                                                   |

4. Pick **Free** plan (or **Starter** for production).
5. Click **Advanced → Add Environment Variable** and add:

   | Key                  | Value                                                |
   | -------------------- | ---------------------------------------------------- |
   | `RAILS_ENV`          | `production`                                         |
   | `RAILS_SERVE_STATIC_FILES` | `true`                                         |
   | `RAILS_LOG_TO_STDOUT` | `true`                                              |
   | `SECRET_KEY_BASE`    | click **Generate** (Render creates a random secret)   |
   | `RAILS_MASTER_KEY`   | paste the contents of `config/master.key`           |
   | `FINNHUB_API_KEY`    | paste your real Finnhub key                          |
   | `FINNHUB_DEMO`       | `0` (default; `1` to force synthetic OHLC)           |

6. Click **Create Web Service**.  Render pulls the repo and runs the build.

---

## 4. After deployment

| Task                         | Where                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| View logs                    | Dashboard → **Logs** tab                                                |
| Tail production logs         | Dashboard → **Logs** → **Connect** for live tail via `journalctl`        |
| Set custom domain            | Dashboard → **Settings** → **Custom Domains**                            |
| Trigger manual deploy         | Dashboard → top-right → **Manual Deploy** → **Deploy latest commit**     |
| Roll back to a previous build| Dashboard → **Events** → click any green build → **Rollback**            |
| View app URL                  | Dashboard → top of page → `https://stock-chart.onrender.com`             |

---

## 5. How the deployment works (under the hood)

`render.yaml` declares:

```yaml
services:
  - type: web
    runtime: ruby
    plan: free
    region: oregon
    branch: main
    buildCommand: |
      bundle config set --local without 'development test' &&
      bundle install &&
      bundle exec rake assets:precompile || true &&
      mkdir -p public/assets &&
      cp -f app/assets/stylesheets/application.css public/assets/application.css &&
      cp -f app/assets/javascripts/application.js  public/assets/application.js
    startCommand: bundle exec puma -C config/puma.rb -e production
    healthCheckPath: /
```

`Procfile` (one line) backs the start command:

```
web: bundle exec puma -C config/puma.rb -e production
```

And `config/puma.rb` binds Puma to `$BIND:$PORT` — Render sets
`PORT` automatically.

---

## 6. Why each build step exists

| Step                                                          | Why                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `bundle config set --local without 'development test'`         | Skip dev-only gems (`debug`) — saves ~5 MB of build time and avoids requiring Ruby dev headers. |
| `bundle install`                                              | Resolve and install all gems into the build image; bundler reads `Gemfile.lock` for exact pins. |
| `bundle exec rake assets:precompile \|\| true`                 | No-op for our app (no asset pipeline); kept so swapping to Sprockets/Propshaft later is one-line. |
| `mkdir -p public/assets && cp -f app/assets/*.{css,js}…`     | Mirrors our canonical `app/assets/*` source to `public/assets/` so Rack's static-file middleware serves them without an asset pipeline. |
| `bundle exec puma -C config/puma.rb -e production`            | Boots Puma in single-mode, 3 threads; binds `tcp://0.0.0.0:$PORT` (Render assigns the port). |

---

## 7. Runtime behaviour on Render's **Free** tier

- The service **spins down after 15 minutes of inactivity** to save resources.
- The first request after a spin-down takes ~30 seconds (cold boot).
- Logs and metrics continue for ~24 hours after spin-down.
- Upgrade to **Starter ($7/month)** to keep the service always-on.

---

## 8. Troubleshooting

| Symptom                                          | Likely cause                                               | Fix                                                            |
| ------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `Could not locate Gemfile`                       | Render build ran at repo root but found no `Gemfile`.      | Make sure your repo is **flat** (Gemfile at root).             |
| `Your Ruby version is X, but your Gemfile specified Y` | `.ruby-version`/`Gemfile` pinned to a version not on Render. | Use `ruby ">= 3.4.0"` in `Gemfile` (Render ships 4.0.x).     |
| `bundler: command not found`                     | Render default Ruby build image strips dev gems.           | Run with `bundle config set --local without 'development test'`. |
| `Missing RAILS_MASTER_KEY`                       | Plaintext credentials file can't be decrypted.             | Set `RAILS_MASTER_KEY` env var to the 32-hex-char contents of `config/master.key`. |
| `favicon.ico` 404                                | Rails default route file doesn't ship one.                  | Harmless; either add one or ignore.                            |
| `No data for XAU.TO on the 1D range.`            | Finnhub free tier blocks intraday resolutions.              | Use `1M+` ranges, or upgrade Finnhub tier.                     |
| Chart shows DEMO data                            | `FINNHUB_DEMO=1` is set in env.                             | Set `FINNHUB_DEMO=0` (or remove it).                          |

---

## 9. To redeploy after a code change

The repo has `autoDeploy: true` in `render.yaml`.  Just push to `main`:

```bash
git add . && git commit -m "describe your change" && git push
```

Render detects the new commit within ~1 minute, queues a build, and
zero-downtime-rolls Puma once it succeeds.

---

## 10. Files relevant to deployment

```
./
├── Procfile               # backup of the start command
├── render.yaml            # Blueprint (one-click deploy)
├── Gemfile                # ruby ">= 3.4.0" + gem set
├── Gemfile.lock           # resolved versions for that constraint
├── .ruby-version          # hint to Render / heroku / asdf etc.
├── config/puma.rb         # binds to tcp://0.0.0.0:$PORT
├── config/environments/production.rb
│                          # config.hosts.clear (Render's hostnames
│                          # don't match our Gemfile's DNS-rebinding
│                          # allowlist)
└── config/master.key      # NOT committed — set as RAILS_MASTER_KEY
                           # env var on Render
```
