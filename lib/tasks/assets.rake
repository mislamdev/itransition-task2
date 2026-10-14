# Stock Chart has no asset pipeline — but Render runs
# `rake assets:precompile` and `rake assets:clean` automatically after a
# successful build. Define no-op tasks so those hooks succeed instead
# of aborting with "Don't know how to build task".
#
# Our static assets (CSS/JS) are kept under app/assets/ and copied into
# public/assets/ at boot by start.sh (locally) and by the build
# command's `cp` step (on Render).

namespace :assets do
  desc "No-op: Stock Chart has no asset pipeline; see `cp` in render.yaml"
  task :precompile do
    puts "Stock Chart: assets:precompile is a no-op (assets are static, copied in build step)."
  end

  desc "No-op: Stock Chart has no asset pipeline"
  task :clean do
    puts "Stock Chart: assets:clean is a no-op."
  end

  desc "No-op: compile equivalent (alias for precompile)"
  task :compile => :precompile
end
