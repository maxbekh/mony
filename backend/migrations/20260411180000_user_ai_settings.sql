-- Add personal AI settings to users
ALTER TABLE auth_user ADD COLUMN ai_settings JSONB NOT NULL DEFAULT '{}'::JSONB;

-- Example structure for ai_settings:
-- {
--   "gemini_api_key": "sk-...",
--   "google_oauth_token": "...",
--   "preferred_provider": "gemini"
-- }
