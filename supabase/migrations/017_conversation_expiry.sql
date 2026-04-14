-- Add auto-expiry and pin support to conversations.
-- Unpinned conversations auto-delete 7 days after the last message.

ALTER TABLE conversations
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN expires_at TIMESTAMPTZ;

-- Backfill: set expires_at for existing rows based on updated_at
UPDATE conversations SET expires_at = updated_at + INTERVAL '7 days' WHERE expires_at IS NULL;

-- Make expires_at NOT NULL after backfill
ALTER TABLE conversations ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE conversations ALTER COLUMN expires_at SET DEFAULT NOW() + INTERVAL '7 days';

CREATE INDEX idx_conversations_expiry ON conversations(expires_at) WHERE NOT pinned;
