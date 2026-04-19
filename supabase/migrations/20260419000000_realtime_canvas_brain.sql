-- Enable realtime sync from MCP-agent writes to the canvas UI for
-- clusters, brains, and memories. Without this migration the user has
-- to reload the page to see anything an agent did.
--
-- Two parts:
--   1. Denormalize user_id onto cluster_brains and cluster_brain_memories
--      so realtime subscriptions can filter at the source by
--      `user_id=eq.<authed user>`. Without this column we'd have to
--      stream every user's brain edits to every connected client and
--      filter on the client — a security and bandwidth problem.
--   2. Add the three tables to the supabase_realtime publication, and
--      set REPLICA IDENTITY FULL on cluster_brains so UPDATE payloads
--      include the full new instructions text (not just the diffed
--      columns) — the canvas needs the full body to render.

-- ── 1. Denormalize user_id ─────────────────────────────────────────

ALTER TABLE cluster_brains
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Also denormalize cluster_id onto memories. Without this, the realtime
-- event for a memory write only carries `cluster_brain_id`, and the
-- canvas would have to maintain a separate brain_id → cluster_id map
-- (or fetch one per event) to know which cluster's brain panel to
-- update. With cluster_id on the row, the payload is self-describing.
ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE;

-- Backfill from the parent cluster (brains) and parent brain → cluster
-- (memories). Idempotent: the WHERE NULL guard keeps re-runs safe.
UPDATE cluster_brains AS b
SET user_id = c.user_id
FROM clusters AS c
WHERE b.cluster_id = c.id
  AND b.user_id IS NULL;

UPDATE cluster_brain_memories AS m
SET user_id = b.user_id
FROM cluster_brains AS b
WHERE m.cluster_brain_id = b.id
  AND m.user_id IS NULL;

UPDATE cluster_brain_memories AS m
SET cluster_id = b.cluster_id
FROM cluster_brains AS b
WHERE m.cluster_brain_id = b.id
  AND m.cluster_id IS NULL;

-- Lock the column down. New rows must always carry user_id so realtime
-- filtering works for them on day one.
ALTER TABLE cluster_brains
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE cluster_brain_memories
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE cluster_brain_memories
  ALTER COLUMN cluster_id SET NOT NULL;

-- Partial indexes to keep realtime filter (user_id=eq.X) cheap on
-- tables that will see many rows over time.
CREATE INDEX IF NOT EXISTS cluster_brains_user_id_idx
  ON cluster_brains (user_id);

CREATE INDEX IF NOT EXISTS cluster_brain_memories_user_id_idx
  ON cluster_brain_memories (user_id);

CREATE INDEX IF NOT EXISTS cluster_brain_memories_cluster_id_idx
  ON cluster_brain_memories (cluster_id);

-- ── 2. Realtime publication + replica identity ─────────────────────

-- Add the three tables to the supabase_realtime publication. Wrapped
-- in DO blocks because ALTER PUBLICATION raises if the table is
-- already there — we want re-runs to no-op cleanly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'clusters'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE clusters;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cluster_brains'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cluster_brains;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cluster_brain_memories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cluster_brain_memories;
  END IF;
END $$;

-- REPLICA IDENTITY FULL on cluster_brains: when an agent calls
-- update_cluster_brain, the realtime UPDATE payload needs to carry the
-- new `instructions` body so the canvas brain panel can re-render
-- without a follow-up fetch. The default (REPLICA IDENTITY DEFAULT,
-- only the primary key) wouldn't include instructions.
--
-- Memories are short and we refetch the full list on any memory event
-- anyway (canvas state stores memories without IDs), so REPLICA
-- IDENTITY DEFAULT is fine there.
ALTER TABLE cluster_brains REPLICA IDENTITY FULL;
