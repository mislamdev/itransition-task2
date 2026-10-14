Rails.application.routes.draw do
  # Serves the single-page UI.
  root to: "stocks#index"

  # JSON proxies — the browser never sees the Finnhub API key. The static
  # assets are served directly by Rack from public/assets/ (no Rails
  # routing needed).
  get "/api/search",  to: "stocks#search"
  get "/api/quote",   to: "stocks#quote"
  get "/api/candle",  to: "stocks#candle"
  get "/api/profile", to: "stocks#profile"
end
