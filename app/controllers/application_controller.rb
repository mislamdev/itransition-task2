# Base controller for the app.  All actions are GET-only (the page
# itself and the read-only JSON proxy endpoints), so we skip CSRF
# protection to keep the cross-origin JSON surface clean.
class ApplicationController < ActionController::Base
  # Empty on purpose: CSRF not needed, no before_action.
end
