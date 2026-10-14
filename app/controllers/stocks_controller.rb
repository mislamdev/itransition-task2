require "net/http"
require "uri"
require "json"

# Thin Rails controller that proxies a handful of Finnhub endpoints. The
# frontend never sees the API key; it only talks to these routes.
class StocksController < ApplicationController
  # In dev we only require the API key for the proxy endpoints; the page
  # itself should render even if the key is missing so the user can still
  # see the UI.
  before_action :require_api_key!, except: [:index]

  FINNHUB_BASE = "https://finnhub.io/api/v1".freeze

  # GET / -> renders the single-page application.  The corresponding ERB
# template lives in app/views/stocks/index.html.erb.
  def index
  end

  # GET /api/search?q=AAPL
  # -> { count, result: [ { symbol, description, type, displaySymbol } ] }
  def search
    q = params[:q].to_s.strip
    return render(json: { count: 0, result: [] }) if q.length < 1

    json = finnhub_get("/search", q: q)
    render json: json
  end

  # GET /api/quote?symbol=AAPL
  # -> Finnhub /quote payload (current price, change, etc.)
  def quote
    symbol = params[:symbol].to_s.strip.upcase
    return render(json: { error: "symbol required" }, status: :bad_request) if symbol.empty?

    render json: finnhub_get("/quote", symbol: symbol)
  end

  # GET /api/candle?symbol=AAPL&range=1D
  # Translates a friendly range label ("1D".."5Y") into the (from, to,
  # resolution) triple Finnhub expects for /stock/candle, and returns the
  # payload.  Intraday resolutions (1, 5, 15, 30, 60) require a Finnhub
  # premium subscription, so we walk down to the coarsest resolution
  # that returns data — this lets the free tier still draw a "1D" chart
  # (just with daily bars instead of 5-minute bars) instead of an
  # empty chart.
  def candle
    symbol = params[:symbol].to_s.strip.upcase
    range  = params[:range].to_s.strip.upcase
    return render(json: { error: "symbol required" }, status: :bad_request) if symbol.empty?
    return render(json: { error: "range required" }, status: :bad_request) if range.empty?

    now = Time.now.to_i
    window = range_window(range, now)
    return render(json: { error: "unsupported range" }, status: :bad_request) if window.nil?

    from, to, requested_resolution = window
    attempted_resolutions = []

    # Highest-resolution first, falling back to coarser bars if the
    # previous call returned an empty payload (premium-only, symbol
    # unsupported, etc.).  Also stop if Finnhub returns 403 — that
    # generally means the entire `/stock/candle` endpoint is locked on
    # this account tier, and retrying won't help.
    [requested_resolution, *downgrade_resolutions(requested_resolution)].each do |resolution|
      attempted_resolutions << resolution
      payload = finnhub_get("/stock/candle", symbol: symbol, resolution: resolution, from: from, to: to)
      @_last_attempted_payload = payload

      # If Finnhub says we don't have access to the candle endpoint at
      # all, fall back to demo data so the chart still renders — the
      # banner at the top of the page already explains when demo mode
      # is in effect.
      if forbidden_candle_response?(payload)
        return render json: demo_candle_envelope(symbol, range, from, to)
      end

      # The payload may have Symbol-keyed entries (our demo builder) or
      # String-keyed ones (parsed JSON).  Look up either way so we work
      # uniformly.
      status    = (payload[:s]    || payload["s"])
      timestamps = (payload[:t]   || payload["t"])
      closes    = (payload[:c]   || payload["c"])
      opens     = (payload[:o]   || payload["o"])
      highs     = (payload[:h]   || payload["h"])
      lows      = (payload[:l]   || payload["l"])

      next if status != "ok"
      next if !timestamps.is_a?(Array) || timestamps.empty?

      bars = timestamps.length
      # Build the response with string keys (so it can be merged into
      # the render json: pipeline cleanly).
      ok_payload = {
        "s" => "ok",
        "t" => timestamps, "o" => opens, "h" => highs,
        "l" => lows,      "c" => closes,
      }
      ok_payload["v"] = payload[:v] || payload["v"] || []

      return render json: ok_payload.merge(
        "range" => range, "resolution" => resolution,
        "requested_resolution" => requested_resolution,
        "from" => from, "to" => to, "bars" => bars,
        "attempted_resolutions" => attempted_resolutions
      )
    end

    # No resolution returned data — return the last attempted payload
    # verbatim so the client can show a meaningful message.
    last = @_last_attempted_payload || { error: "no data" }
    last["s"] = "no_data"
    last["range"] = range
    last["resolution"] = requested_resolution
    last["from"] = from
    last["to"] = to
    last["attempted_resolutions"] = attempted_resolutions
    render json: last
  end

  # Returns true when the upstream payload looks like a Finnhub 403/
  # forbidden-for-this-plan response (versus a clean empty payload).
  def forbidden_candle_response?(payload)
    return false unless payload.is_a?(Hash)
    msg = (payload[:body] || payload["body"] || "").to_s
    code = (payload[:error] || payload["error"] || "").to_s
    code.include?("403") || msg.include?("don't have access") || msg.include?("premium")
  end

  # Wrap demo candle data into the same envelope we would have built
  # from a real Finnhub response, so the client can render seamlessly.
  def demo_candle_envelope(symbol, range, from, to)
    payload = build_demo_candles(symbol, from, to, range_window(range, to)&.last || "D")
    return { error: "demo unavailable", s: "no_data" } unless payload.is_a?(Hash) && (payload[:s] || payload["s"]) == "ok"

    bar_count = (payload[:t] || payload["t"]).length
    {
      "s" => "demo",
      "t" => payload[:t],
      "o" => payload[:o],
      "h" => payload[:h],
      "l" => payload[:l],
      "c" => payload[:c],
      "v" => payload[:v],
      "range" => range,
      "resolution" => "demo",
      "requested_resolution" => "demo",
      "from" => from, "to" => to, "bars" => bar_count,
      "attempted_resolutions" => ["demo"],
      "demo" => true,
      "demo_reason" => "your Finnhub plan does not include the candle endpoint",
    }
  end

  # GET /api/profile?symbol=AAPL
  # Used to show the company name + currency under the chart.
  def profile
    symbol = params[:symbol].to_s.strip.upcase
    return render(json: {}, status: :bad_request) if symbol.empty?

    render json: finnhub_get("/stock/profile2", symbol: symbol)
  end

  private

  def require_api_key!
    if ENV["FINNHUB_API_KEY"].to_s.strip.empty?
      render json: { error: "FINNHUB_API_KEY not configured on server" }, status: :service_unavailable
    end
  end

  # Performs a GET against Finnhub, returns the parsed JSON body, or an
  # error envelope if anything goes wrong.
  def finnhub_get(path, query = {})
    # Demo mode: synthetic OHLC data so the page renders without a real
    # key.  Activated when FINNHUB_API_KEY is missing or set to "demo".
    if demo_mode? && %w[/stock/candle /quote /search /stock/profile2].include?(path)
      return demo_response(path, query)
    end

    uri = URI.parse("#{FINNHUB_BASE}#{path}")
    uri.query = URI.encode_www_form(query.merge(token: ENV["FINNHUB_API_KEY"]))

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = (uri.scheme == "https")
    http.open_timeout = 5
    http.read_timeout = 10

    response = http.get(uri.request_uri)
    body = response.body.to_s

    return { error: "finnhub #{response.code}", body: body } unless response.is_a?(Net::HTTPSuccess)

    parsed = JSON.parse(body)
    parsed
  rescue JSON::ParserError
    { error: "invalid json from finnhub" }
  rescue Net::OpenTimeout, Net::ReadTimeout, SocketError, Errno::ECONNREFUSED => e
    { error: "network error", message: e.message }
  end

  def demo_mode?
    val = ENV["FINNHUB_DEMO"].to_s.strip.downcase
    %w[1 true yes on].include?(val)
  end

  def demo_response(path, query)
    sym = (query[:symbol] || query["symbol"] || "DEMO").to_s.upcase
    case path
    when "/search"
      q = (query[:q] || query["q"] || "").to_s
      return { count: 0, result: [] } if q.empty?
      { count: 1, result: [{ symbol: sym, description: "#{sym} Inc. (DEMO MODE)", type: "Common Stock", displaySymbol: sym }] }
    when "/quote"
      # Stable pseudo-price based on the symbol hash so each ticker
      # always shows the same place on screen.
      base = 50 + (sym.bytes.sum % 400)
      drift = (Time.now.to_i / 60) % 100 / 100.0
      c = (base + drift).round(2)
      pc = (base - 0.5 + drift).round(2)
      { c: c, h: c + 1.2, l: c - 1.5, o: pc, pc: pc, d: (c - pc).round(4), dp: ((c - pc) / pc * 100).round(3) }
    when "/stock/profile2"
      { ticker: sym, name: "#{sym} Inc.", currency: "USD", exchange: "DEMO", finnhubIndustry: "Demo", country: "US", weburl: "https://example.com/#{sym}" }
    when "/stock/candle"
      from = (query[:from] || query["from"]).to_i
      to   = (query[:to]   || query["to"]).to_i
      resolution = (query[:resolution] || query["resolution"]).to_s
      build_demo_candles(sym, from, to, resolution)
    end
  end

  def build_demo_candles(symbol, from, to, resolution)
    step =
      case resolution
      when "1"  then 60
      when "5"  then 5 * 60
      when "15" then 15 * 60
      when "30" then 30 * 60
      when "60" then 60 * 60
      when "D"  then 24 * 60 * 60
      when "W"  then 7 * 24 * 60 * 60
      when "M"  then 30 * 24 * 60 * 60
      else           24 * 60 * 60
      end
    step = 1 if step < 1

    base = 50 + (symbol.bytes.sum % 400)
    # Deterministic pseudo-random walk so the same range looks identical
    # each refresh.
    rng = Random.new(symbol.bytes.sum)

    t = []; o = []; h = []; l = []; c = []; v = []
    current = base
    pointer = from
    while pointer < to
      change = (rng.rand - 0.5) * 2.0
      open   = current
      close  = [10.0, open + change].max
      high   = [open, close].max + rng.rand * 1.5
      low    = [open, close].min - rng.rand * 1.5
      t << pointer
      o << open.round(2)
      h << high.round(2)
      l << low.round(2)
      c << close.round(2)
      v << (rng.rand * 1_000_000).round
      current = close
      pointer += step
    end
    return { s: "no_data", t: [], o: [], h: [], l: [], c: [], v: [] } if t.empty?
    { s: "ok", t: t, o: o, h: h, l: l, c: c, v: v }
  end

  # Maps a friendly range label to (from, to, resolution).  All values
  # are integer Unix seconds, suitable for passing straight to Finnhub
  # (or our demo builder).
  # resolution: 1, 5, 15, 30, 60 (minutes), D (day), W (week), M (month)
  def range_window(range, now)
    to = now.to_i
    case range
    when "1D"  then [ to - 1.day.to_i,    to, "5"  ]   # 5-minute bars over the last day (premium)
    when "5D"  then [ to - 5.days.to_i,   to, "30" ]   # 30-minute bars (premium)
    when "1W"  then [ to - 7.days.to_i,   to, "60" ]   # 1-hour bars (premium)
    when "1M"  then [ to - 31.days.to_i,  to, "D"  ]   # daily bars (free)
    when "3M"  then [ to - 93.days.to_i,  to, "D"  ]
    when "6M"  then [ to - 186.days.to_i, to, "D"  ]
    when "1Y"  then [ to - 366.days.to_i, to, "D"  ]
    when "5Y"  then [ to - 5.years.to_i,  to, "W"  ]   # weekly bars
    else            [ nil, nil, nil ]
    end
  end

  # When the highest resolution returns nothing (premium-only, or
  # the symbol/exchange doesn't support that granularity), we walk
  # down to progressively coarser bars until something comes back.
  RESOLUTION_DOWNGRADES = {
    "1"  => %w[5 15 30 60 D],
    "5"  => %w[15 30 60 D],
    "15" => %w[30 60 D],
    "30" => %w[60 D],
    "60" => %w[D],
    "D"  => %w[W],
    "W"  => %w[M],
    "M"  => [],
  }.freeze
  private_constant :RESOLUTION_DOWNGRADES

  def downgrade_resolutions(resolution)
    RESOLUTION_DOWNGRADES[resolution] || []
  end
end
