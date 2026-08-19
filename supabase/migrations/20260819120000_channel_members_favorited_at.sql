-- FAVOURITING A CHANNEL OR DM — a PER-MEMBER preference on `channel_members`.
--
-- Samuel's ruling, 2026-08-19: the sidebar's Favorites section goes REAL. It was
-- the last piece of hardcoded design furniture with a plausible backing store
-- (`channels-v2/fixtures.ts › HARDCODED_FAVORITE_ROWS`, deleted in the same
-- change); the rest of the furniture — the activity heatmap, Linked threads, the
-- Assistant / Drafts / Saved-items nav rows — stays hardcoded.
--
-- ── WHY A COLUMN HERE, NOT A TABLE (and why that is not the obvious answer) ──
--
-- The immediately preceding per-user favourite in this schema went the OTHER way:
-- `20260812130000_knowledge_base_stars.sql` is a join table, and its own header
-- argues at length that a column on `knowledge_bases` would have been wrong. That
-- argument does not transfer, and the difference is the referent:
--
--   * A knowledge-base star has NO row to hang off. `knowledge_bases` is a
--     WORKSPACE-wide row; a star on it would be a workspace-wide fact and the
--     first star would reorder the grid for everybody. A join table was the only
--     way to key it to one person.
--   * A channel favourite ALREADY HAS a per-(user, channel) row —
--     `channel_members` — and that row is exactly "this person's relationship to
--     this channel". `last_read_at` and `agent_tool_profile` already live on it.
--     A second table keyed `(user_id, channel_id)` would duplicate the primary
--     key of a table that is already read on the channel-list path.
--
-- The read is the deciding argument. `service-reads.ts › listChannels` already
-- loads the caller's OWN membership row for every channel it returns
-- (`repo.listMyMemberships`) and layers `role` / `last_read_at` /
-- `agent_tool_profile` onto the DTO from it. A column here rides that read for
-- free: **the sidebar's Favorites section costs ZERO new queries and ZERO new
-- endpoints.** A join table would have added a read to the hottest channels
-- path to answer a question the row already in hand can answer.
--
-- ⚠ COUNTER-PRECEDENT, NAMED, BECAUSE IT ARGUES THE OTHER WAY AND WAS RIGHT TO.
-- `20260818140000_channel_mention_reads.sql` deliberately did NOT add a column
-- here, and one of its stated reasons was keeping `channel_members` from growing
-- a per-member setting and the two-edit rule (INVARIANTS §2) that comes with one.
-- That reasoning holds and it is honoured, not dodged: this file pays the second
-- edit below. The reason `channel_mention_reads` could not be a column at all is
-- separate and still true — its natural key is `(user_id, MESSAGE_id)`, and there
-- is no per-(user, message) row anywhere to put it on. A favourite's key is
-- `(user_id, channel_id)`, which is this table's primary key already.
--
-- ── NULLABLE TIMESTAMP, NOT A BOOLEAN ──────────────────────────────────────
--
-- `NULL` = not favourited; a timestamp = when. Same reasoning as
-- `knowledge_base_stars.created_at`: "when did I favourite this" is the only
-- question this fact could ever be asked that a boolean cannot answer, and adding
-- the timestamp later means backfilling rows whose real answer is gone. No
-- surface orders by it today — the sidebar sorts favourites by NAME, because a
-- shortcut list is used by pointing and alphabetical is the only order that never
-- reorders under traffic.
--
-- ── ⚠ THE SECOND EDIT, WHICH IS THE ONE THAT BINDS (INVARIANTS §2) ─────────
--
-- Per-member settings on this table are private BY COLUMN PRIVILEGE, not by
-- policy and not by the DTO: `20260810120000_channel_members_column_privileges.sql`
-- revoked table-wide SELECT from `anon`/`authenticated` and handed back a named
-- list of public columns. A new column added by `ALTER TABLE` inherits NOTHING
-- from that list — it is simply absent from every column grant — so
-- `favorited_at` is service_role-only the moment it exists, and this file adds no
-- GRANT. That is deliberate and it is the half of the rule that actually binds:
-- the DTO scrub in `server/dto.ts › mapMemberRow` shapes the API RESPONSE (the
-- server reads as service_role, where a column privilege redacts nothing), and
-- this absence binds PostgREST and Realtime CDC.
--
-- The assertion block at the bottom proves it rather than trusting it, because
-- the failure mode is silent in exactly one direction: a future
-- `GRANT SELECT ON public.channel_members TO authenticated` — the documented
-- ROLLBACK of `20260810120000` — would restore table-wide SELECT and hand this
-- column out with it, along with `agent_tool_profile`.
--
-- ── REALTIME (INVARIANTS §7 / §12) ─────────────────────────────────────────
--
-- `channel_members` IS in the `supabase_realtime` publication and stays in it;
-- adding a column changes no publication membership and this file touches neither
-- the publication nor the SELECT policy. Two things were checked rather than
-- assumed:
--
--   1. REPLICA IDENTITY is unchanged and does not need to change. It is
--      `USING INDEX channel_members_replica_identity_idx (workspace_id,
--      channel_id, user_id)` (`20260807150000`), and it exists so DELETE frames
--      carry `workspace_id` for the subscribers' `workspace_id=eq.<id>` filter.
--      A favourite toggle is an UPDATE, whose filter is evaluated against the NEW
--      record, so the identity is not on this write's path at all. Widening it to
--      carry `favorited_at` would buy nothing and cost WAL on every roster write.
--   2. THE DOORBELL STILL RINGS FOR A COLUMN THE SUBSCRIBER CANNOT READ. An event
--      is a DOORBELL, NEVER CONTENT (§7): the subscriber refetches through the
--      service, which reads as service_role. `apply_rls` drops columns the
--      subscribing role lacks SELECT on from the frame; it does not drop the
--      frame. The other window's channel-list refetch is the whole delivery path,
--      and it sees the new value.
--
-- No refetch-loop risk of the `last_read_at` kind (`repository.ts ›
-- updateLastRead`, whose monotonic guard exists to stop exactly that): this
-- column is written only by an explicit human click, never by a read.
--
-- ── INDEX: NONE, DELIBERATELY (INVARIANTS §12) ─────────────────────────────
--
-- "An index exists only if a named statement uses it." No query filters or orders
-- by `favorited_at`. The only read is `listMyMemberships` — `WHERE workspace_id =
-- $1 AND user_id = $2` — which returns the caller's rows whole and lets the client
-- partition them. A partial index with no query behind it is debt.

ALTER TABLE public.channel_members
  ADD COLUMN IF NOT EXISTS favorited_at TIMESTAMPTZ;

COMMENT ON COLUMN public.channel_members.favorited_at IS
  'PER-MEMBER PREFERENCE, service_role-only: when this member favourited this channel; NULL = not favourited. Deliberately absent from the anon/authenticated column GRANTs in 20260810120000 — see INVARIANTS §2. Written only through channels/server/service-writes-members.ts › updateMyMemberSettings, which always targets ctx.userId.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Assert the privilege outcome instead of trusting it.
-- ═══════════════════════════════════════════════════════════════════════════
-- The whole point of adding no GRANT is that the column is unreadable to the
-- client roles. That is an ABSENCE, and an absence is what silently stops being
-- true — restoring the table-wide grant (the documented rollback of
-- 20260810120000) would hand this column out with no error anywhere.
DO $$
BEGIN
  IF has_column_privilege('authenticated', 'public.channel_members', 'favorited_at', 'SELECT')
     OR has_column_privilege('anon', 'public.channel_members', 'favorited_at', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: channel_members.favorited_at is SELECT-able by anon/authenticated — a table-wide GRANT is back (see 20260810120000 ROLLBACK) and it is handing out agent_tool_profile too; fix that before shipping this column';
  END IF;

  IF NOT has_column_privilege('service_role', 'public.channel_members', 'favorited_at', 'SELECT') THEN
    RAISE EXCEPTION
      'ABORT: service_role cannot SELECT channel_members.favorited_at — every repository select("*") on this table would 42501';
  END IF;

  RAISE NOTICE
    'channel_members.favorited_at added: service_role-only, no index, publication and replica identity unchanged';
END
$$;

-- ── VERIFICATION (run on the target database after applying) ───────────────
--
--   -- (a) The column is private to the client roles:
--   SELECT grantee, column_name FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'channel_members'
--      AND privilege_type = 'SELECT' AND grantee IN ('anon','authenticated')
--    ORDER BY grantee, column_name;
--   -- Expect exactly: added_by, channel_id, joined_at, last_read_at, role,
--   -- user_id, workspace_id. NOT favorited_at, NOT agent_tool_profile.
--
--   -- (b) The publication and the replica identity are untouched:
--   SELECT 1 FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'channel_members'; -- 1 row
--   SELECT relreplident FROM pg_class
--    WHERE oid = 'public.channel_members'::regclass;                        -- 'i'
--
--   -- (c) CDC still delivers the roster doorbell — favourite a channel in one
--   --     window and watch a second window's sidebar pick it up. `favorited_at`
--   --     must be ABSENT from the frame's `record` while the frame arrives.
