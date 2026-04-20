-- Create the cluster brain + memory tables AND enable realtime sync
-- for canvas live updates.
--
-- Root cause note: `cluster_brains` and `cluster_brain_memories` have
-- never existed in the database — they were referenced throughout the
-- backend (brain/route.ts, memories/route.ts, chat/route.ts) but never
-- created by any migration. That explains why `update_cluster_brain`
-- has been silently 500-ing forever. This migration creates them,
-- denormalizes user_id + cluster_id for realtime filtering, and adds
-- them to the supabase_realtime publication.
--
-- Safe to re-run: all CREATE / ALTER statements use IF NOT EXISTS or
-- conditional DO blocks.

-- ── 1. Create the missing tables ───────────────────────────────────
--
-- Shape derived from the code that reads/writes them:
--   - brain/route.ts: id, cluster_id, instructions, created_at, updated_at
--   - memories/route.ts: id, cluster_brain_id, content, created_at
--
-- One brain per cluster (enforced by UNIQUE on cluster_id). Memories
-- cascade with their brain, which cascades with its cluster.
--
-- `user_id` and (for memories) `cluster_id` are denormalized from the
-- parents so realtime subscriptions can filter server-side by user.

CREATE TABLE IF NOT EXISTS cluster_brains (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id    UUID NOT NULL UNIQUE REFERENCES clusters(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instructions  TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cluster_brain_memories (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_brain_id   UUID NOT NULL REFERENCES cluster_brains(id) ON DELETE CASCADE,
  cluster_id         UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content            TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful lookup indexes. The cluster_id on brains is already unique
-- (indexed by the constraint), so we only need one for memories'
-- cluster_brain_id join path.
CREATE INDEX IF NOT EXISTS cluster_brain_memories_brain_id_idx
  ON cluster_brain_memories (cluster_brain_id);

-- ── 2. Backfill + NOT NULL guards for pre-existing rows ─────────────
--
-- These blocks handle the hypothetical case where the tables existed
-- in some environment without user_id / cluster_id populated. On a
-- fresh install the UPDATE statements touch zero rows. Kept here for
-- defensive consistency — same migration file works across envs.

-- `ADD COLUMN IF NOT EXISTS` is a no-op when the tables are freshly
-- created above (columns already present with NOT NULL). Re-running on
-- an environment that predated those columns adds them nullable so the
-- backfill can run, then we tighten them back to NOT NULL.
ALTER TABLE cluster_brains
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE cluster_brain_memories
  ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE;

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

-- `SET NOT NULL` is safe here — the columns are already NOT NULL on
-- fresh tables; on pre-existing envs the backfill above filled any
-- nulls. If a stray null remains the statement will raise, which is
-- what we want (the row is corrupt and the user needs to look at it).
ALTER TABLE cluster_brains
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE cluster_brain_memories
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE cluster_brain_memories
  ALTER COLUMN cluster_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS cluster_brains_user_id_idx
  ON cluster_brains (user_id);

CREATE INDEX IF NOT EXISTS cluster_brain_memories_user_id_idx
  ON cluster_brain_memories (user_id);

CREATE INDEX IF NOT EXISTS cluster_brain_memories_cluster_id_idx
  ON cluster_brain_memories (cluster_id);

-- ── 3. RLS ─────────────────────────────────────────────────────────
--
-- Enable RLS so realtime subscriptions (which use the visitor's JWT,
-- not the service role) can only see rows the user owns. Backend
-- writes go through `supabaseAdmin()` which uses the service role and
-- bypasses RLS, so these policies don't affect server code.

ALTER TABLE cluster_brains ENABLE ROW LEVEL SECURITY;
ALTER TABLE cluster_brain_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cluster_brains_owner_select ON cluster_brains;
CREATE POLICY cluster_brains_owner_select ON cluster_brains
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS cluster_brain_memories_owner_select ON cluster_brain_memories;
CREATE POLICY cluster_brain_memories_owner_select ON cluster_brain_memories
  FOR SELECT
  USING (user_id = auth.uid());

-- ── 4. Realtime publication + replica identity ─────────────────────

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
