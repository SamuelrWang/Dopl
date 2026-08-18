-- CHANNELS V2, PHASE 6 — READ-STATE FOR THE TAGS (MENTIONS) INBOX.
--
-- ── WHY A TABLE AND NOT A CURSOR ────────────────────────────────────────────
-- The two shapes on the table were a per-(user, channel) CURSOR column on
-- `channel_members` and a ROW PER READ. The inbox marks INDIVIDUAL mentions
-- read, out of order — you open the one you were asked about, leave the two
-- above it unread — and a cursor cannot express that: any monotonic watermark
-- that covers the row you opened also covers everything older than it. So: the
-- table (docs/CHANNELS-V2-WIRING-PLAN.md Phase 6, design decision 2).
--   ⚠ The cursor shape was also the more expensive one to get wrong. A new
--   per-member column on `channel_members` is a per-member SETTING, which means
--   the DTO scrub AND an omission from that migration's GRANT list (INVARIANTS
--   §2) — two edits where the second is the one that binds. Landing read-state
--   in its own table sidesteps that class entirely, and `channel_members`
--   (which IS published) grows no column.
--
-- ── THE NATURAL KEY IS (user_id, message_id), AND IDEMPOTENCY IS THE PK ─────
-- A message belongs to exactly one channel, so `(user_id, channel_id,
-- message_id)` would carry a redundant third term; `channel_id` is here as a
-- denormalized FILTER for the per-channel projection, not as part of identity.
-- Marking read TWICE is `ON CONFLICT DO NOTHING`, which is what makes the write
-- idempotent and — the half that is easy to lose — keeps the FIRST `read_at`.
-- A second mark must not move the timestamp: the row records when you first saw
-- it, and an upsert that refreshed it would make "read 3 days ago" drift
-- forward every time the list re-rendered.
--
-- ── PUBLICATION: NO. DECIDED, NOT INHERITED (INVARIANTS §7 + §12) ───────────
-- This table is NOT added to `supabase_realtime`, and that is the deliberate
-- answer rather than an omission:
--   (a) THERE IS NO PEER EVENT HERE. Every row is written by the viewer's own
--       client about the viewer's own reading. The only surface that needs to
--       know is the one that just caused it, and it already knows — the badge
--       is client-side arithmetic over the projection (design decision 3).
--   (b) A PUBLISHED TABLE WITH NO SUBSCRIBER COSTS WAL DECODE PLUS A
--       PER-SUBSCRIPTION RLS EVALUATION ON EVERY WRITE, FOREVER (§7). Marking
--       read is a per-click write; this is the wrong table to pay that on.
--   (c) A SUBSCRIBER ON AN UNPUBLISHED TABLE IS WORSE THAN AN ERROR, so the
--       two halves ship together or not at all — `dopl-desktop-app/main/
--       ui-sync.js › SYNC_TABLES` is a PINNED inventory (`ui-sync-tables.test.mjs`
--       pins both directions) and gains nothing here.
--   NEW MENTIONS still arrive live: they are `channel_messages` rows, and that
--   table is already in the publication and already subscribed. Same argument
--   `channel_tasks` stays out on — the doorbell is already paid for.
-- REPLICA IDENTITY stays DEFAULT (primary key). Nothing subscribes, so there is
-- no DELETE frame to deliver, and every delete here is a CASCADE from a message,
-- channel or user that is itself going away — the same exemption reason
-- `channel_messages` carries in `ui-sync-replica-identity.test.mjs ›
-- NO_DELETE_DOORBELL`.
--
-- ── RLS: THE CHANNELS MODEL, NARROWED TO SELF ───────────────────────────────
-- Writes are REVOKEd from `authenticated`/`anon` and go through the feature
-- service on the service-role client, like every other channels table
-- (INVARIANTS §5). The SELECT policy is NARROWER than `channel_tasks`' member
-- read on purpose: when a teammate read their mentions is nobody else's
-- business, so the policy is `user_id = auth.uid()` on top of the workspace
-- fence. The service reads as service_role and is therefore the real fence
-- (§2); this policy binds direct PostgREST.

CREATE TABLE public.channel_mention_reads (
  user_id      UUID NOT NULL REFERENCES auth.users(id)             ON DELETE CASCADE,
  message_id   UUID NOT NULL REFERENCES public.channel_messages(id) ON DELETE CASCADE,
  -- Denormalized FILTER columns, not identity. `channel_id` is what the
  -- per-channel projection joins on; `workspace_id` carries the standard
  -- channels fence and lets the shared child guard apply unchanged.
  channel_id   UUID NOT NULL REFERENCES public.channels(id)        ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id)      ON DELETE CASCADE,
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

-- THE PROJECTION'S INDEX, and the `channel_id` FK cascade's cover in one:
-- `(channel_id, user_id)` leads with the FK column (INVARIANTS §12 — an FK
-- cascade counts as a named statement) and answers the only read this table
-- has, "which of THIS channel's mentions have I read".
CREATE INDEX channel_mention_reads_channel_user_idx
  ON public.channel_mention_reads (channel_id, user_id);

-- The remaining two FK columns, each as a LEADING column. `user_id` already
-- leads the primary key, so it needs no index of its own.
CREATE INDEX channel_mention_reads_message_idx
  ON public.channel_mention_reads (message_id);
CREATE INDEX channel_mention_reads_workspace_idx
  ON public.channel_mention_reads (workspace_id);

-- Reuse the v1 workspace-consistency guard (compares NEW.workspace_id to the
-- parent channel's). ⚠ INSERT only — nothing UPDATEs this table, and naming
-- columns that never move would be a claim about a write path that does not
-- exist.
DROP TRIGGER IF EXISTS channel_mention_reads_workspace_guard
  ON public.channel_mention_reads;
CREATE TRIGGER channel_mention_reads_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, channel_id
  ON public.channel_mention_reads
  FOR EACH ROW EXECUTE FUNCTION public.channel_child_workspace_guard();

ALTER TABLE public.channel_mention_reads ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.channel_mention_reads
  FROM authenticated, anon;

CREATE POLICY channel_mention_reads_self_select ON public.channel_mention_reads
  FOR SELECT
  USING (
    user_id = (select auth.uid())
    AND is_current_workspace_member(workspace_id, 'viewer'::text)
  );

COMMENT ON TABLE public.channel_mention_reads IS
  'Row per (member, message) marking a mention read. Service-role writes only; deliberately OUT of supabase_realtime (no peer event, and new mentions ride the channel_messages doorbell).';

-- ════════════════════════════════════════════════════════════════════
-- The projection's index on `channel_messages`
-- ════════════════════════════════════════════════════════════════════
--
-- "Which of this channel's messages tag ME" is
-- `metadata -> 'mentionedUserIds' @> '["<uid>"]'`, and without an index that is
-- a scan of the channel's whole transcript per open of the Tags row.
--
-- ⚠ GIN ON THE EXPRESSION, NOT ON `metadata`. A GIN over the whole `metadata`
-- column would index every key of every post on the hottest table in the schema
-- — a real tax on the write path for a question a reader asks (INVARIANTS §12).
-- Indexing `metadata -> 'mentionedUserIds'` instead means rows WITHOUT the key
-- produce a NULL expression, and GIN stores no entries for NULL — so this is a
-- partial index in effect, with none of the predicate-implication fragility a
-- literal `WHERE metadata ? '…'` would bring (the planner must PROVE the
-- predicate to use a partial index, and it does not prove that one from `@>`).
--
-- `jsonb_path_ops` because `@>` is the only operator this index answers:
-- smaller than the default opclass and faster for containment. It cannot answer
-- key-existence (`?`), which nothing here asks.
CREATE INDEX channel_messages_mentions_idx
  ON public.channel_messages
  USING GIN ((metadata -> 'mentionedUserIds') jsonb_path_ops);

-- Verify after applying (read-only; safe on prod):
--   -- One member's mentions in one channel, newest first — the projection.
--   SELECT seq, author_user_id, created_at, left(body, 60)
--   FROM channel_messages
--   WHERE channel_id = '<a channel uuid>'
--     AND metadata -> 'mentionedUserIds' @> '["<a user uuid>"]'::jsonb
--   ORDER BY seq DESC
--   LIMIT 50;
--
--   -- The index is used (expect a Bitmap Index Scan on
--   -- channel_messages_mentions_idx, not a Seq Scan):
--   EXPLAIN SELECT 1 FROM channel_messages
--   WHERE metadata -> 'mentionedUserIds' @> '["<a user uuid>"]'::jsonb;
--
-- ROLLBACK is `DROP TABLE public.channel_mention_reads;` plus
-- `DROP INDEX public.channel_messages_mentions_idx;` in a NEW migration, and the
-- read/write paths must be reverted in the same release — every mention row is
-- read-state and nothing reconstructs it.
