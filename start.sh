#!/usr/bin/env bash
# Convenience launcher for local development.
#
# Configuration is read from `.env` (created from `.env.example` on first
# run).  Anything you export in the shell BEFORE running this script
# overrides what's in .env — that's how dotenv works.
#
# Typical use:
#   1. cp .env.example .env
#   2. Edit .env and put your real FINNHUB_API_KEY in it.
#   3. ./start.sh           # serves on 0.0.0.0:3000 (LAN-reachable)
#
# Optional flags:
#   ./start.sh --loopback   # bind on 127.0.0.1 only
#   ./start.sh --port 8080  # use a different port
#
# Shell env still wins over .env:
#   PORT=8080 ./start.sh
#   FINNHUB_API_KEY=xxx ./start.sh

set -euo pipefail

# Repository root = directory this script lives in.
APP_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_ROOT"

# Detect a usable Ruby: prefer Homebrew Ruby (>= 3.4 needed for Rails 8),
# fall back to whatever is on PATH.
RUBY=""
if [ -x "/opt/homebrew/opt/ruby/bin/ruby" ]; then
  RUBY="/opt/homebrew/opt/ruby/bin/ruby"
elif command -v ruby >/dev/null 2>&1; then
  RUBY="$(command -v ruby)"
fi
if [ -z "$RUBY" ]; then
  echo "Ruby is required but was not found." >&2
  exit 1
fi

# Make sure Homebrew Ruby is on PATH so its bundled `gem` and the
# user-installed `bundle` are reachable.
export PATH="$(dirname "$RUBY"):$HOME/.gem/ruby/4.0.0/bin:$PATH"

# Copy the current CSS/JS from app/assets/* into public/assets/ so they
# are served by Rack's static-file middleware (Rails 8 minimal — no
# asset pipeline).  Cheap enough to do on every boot.
mkdir -p public/assets
cp -f app/assets/stylesheets/application.css public/assets/application.css
cp -f app/assets/javascripts/application.js  public/assets/application.js

# Friendly defaults if no .env exists yet.
if [ ! -f .env ]; then
  echo "Creating default .env from .env.example.  Edit it to set your Finnhub key." >&2
  cp -n .env.example .env
fi

# Load .env into the current shell so we can show what's configured.
# dotenv-rails does the same inside Rails, but the values printed here
# come from this shell read.
set -a
# shellcheck disable=SC1091
source .env
set +a

# Optional CLI flags.
BIND="${BIND:-0.0.0.0}"
PORT="${PORT:-3000}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --loopback) BIND="127.0.0.1"; shift ;;
    -p|--port)  PORT="$2"; shift 2 ;;
    --port=*)   PORT="${1#*=}"; shift ;;
    -h|--help)
      cat <<EOF
Usage: ./start.sh [--loopback] [--port 3000]

Configuration is read from .env (see .env.example).
Shell env overrides .env values.
EOF
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Status summary.
if [ -n "${FINNHUB_DEMO:-}" ] && [ "${FINNHUB_DEMO}" != "0" ]; then
  echo "==> Demo mode ON — synthetic OHLC data will be served." >&2
fi
if [ -z "${FINNHUB_API_KEY:-}" ] || [ "${FINNHUB_API_KEY}" = "demo" ] || [ "${FINNHUB_API_KEY}" = "your_finnhub_api_key_here" ]; then
  echo "==> FINNHUB_API_KEY is not set (or is the demo placeholder);" >&2
  echo "    live calls will fail until you edit .env." >&2
fi
echo "==> FINNHUB_API_KEY prefix: ${FINNHUB_API_KEY:0:4}****"
echo "==> BIND=$BIND  PORT=$PORT"

exec bundle exec puma -C config/puma.rb -b "tcp://$BIND:$PORT"
