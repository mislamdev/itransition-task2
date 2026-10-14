# Be sure to restart your server when you modify this file.

# Open CORS by default so the same Rails app can serve the static page
# AND be called directly from external frontends / apps. Tighten
# `origins` for production deployments.
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins "*"
    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head]
  end
end
