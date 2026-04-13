-- Link API keys to user accounts
-- Existing keys (created via admin) will have NULL user_id and still work
ALTER TABLE api_keys ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
