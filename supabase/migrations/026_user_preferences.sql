-- Generic key-value store for per-user preferences.
-- Used for onboarding state, bookmarks, and future user settings.

CREATE TABLE user_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_preferences_select_own ON user_preferences
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_preferences_insert_own ON user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY user_preferences_update_own ON user_preferences
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY user_preferences_delete_own ON user_preferences
  FOR DELETE USING (user_id = auth.uid());
