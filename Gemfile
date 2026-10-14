source "https://rubygems.org"

# Ruby 3.4.x or 4.x — both are supported by every gem we use.  Render's
# default Ruby build image updates independently of this file, so we
# accept anything >= 3.4 to stay forward-compatible.
ruby ">= 3.4.0"

gem "rails", "~> 8.1.4"
gem "puma", ">= 5.0"

gem "tzinfo-data", platforms: %i[ windows jruby ]
gem "rack-cors"

# Loads .env from the project root before the rest of the app boots, so
# ENV["FINNHUB_API_KEY"] / FINNHUB_DEMO / BIND / PORT are available
# without exporting them in every shell.
gem "dotenv-rails", groups: [:development, :test]

group :development, :test do
  gem "debug", platforms: %i[ mri windows ]
end
