-- Chat conversation persistence
-- Each chat panel's conversation is stored per-user for cross-session persistence.

CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  panel_id   TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT 'New Chat',
  messages   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, panel_id)
);

CREATE INDEX idx_conversations_user ON conversations(user_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_select_own ON conversations
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY conversations_insert_own ON conversations
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY conversations_update_own ON conversations
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY conversations_delete_own ON conversations
  FOR DELETE USING (user_id = auth.uid());
