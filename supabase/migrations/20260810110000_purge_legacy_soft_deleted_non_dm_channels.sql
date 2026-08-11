-- ONE-TIME CLEANUP: hard-delete the PRE-SWITCH non-DM channel tombstones
-- (C-15b, Samuel's decision 2026-08-10: "it should be permanently delete").
--
-- ⚠️ WRITTEN, NOT APPLIED, AND IRREVERSIBLE. Run the verification SELECT below
-- first. Apply AFTER `20260810100000_channels_rls_hide_tombstoned.sql`.
--
-- ── PURPOSE ────────────────────────────────────────────────────────────────
-- `20260807110000_purge_soft_deleted_rows.sql` swept every other table's
-- tombstones and DELIBERATELY EXCLUDED `channels`, because at the time
-- `channels.deleted_at` was one column doing two jobs and there was no way to
-- tell a closed DM from a dead channel without a branch that did not exist yet.
--
-- That branch now exists. `repository.hardDeleteChannel` landed 2026-08-08
-- (C-16 / F-173): a non-DM delete removes the row outright, and only a DM
-- soft-deletes. So from 2026-08-08 forward no new non-DM tombstone can be
-- created. What is left is the BACKLOG — every non-DM channel deleted before
-- that switch. Those rows are exactly what F-173's own note described:
-- unreachable in every direction at once (no revive path — `reviveChannel`'s
-- only caller is `reopenDirectChannel`; no restore route; no trash; excluded
-- from the 20260807110000 sweep) while still owning their slug against the
-- non-partial `channels_workspace_slug_key`, and — until
-- `20260810100000` — still serving their full transcript to their former
-- members over direct PostgREST. This sweeps them once.
--
-- ── THE ONE THING THIS MUST NEVER DO ───────────────────────────────────────
-- ⛔ `is_direct = true` ROWS ARE NEVER TOUCHED. A tombstoned DM is LIVE PRODUCT
-- STATE, not garbage: `deleted_at` on a direct channel is the CLOSE half of
-- close/reopen, either side's next open revives the SAME row with its full
-- history, and it is the only exit a non-creator has from an immutable roster
-- (ENGINEERING §7; `repository.softDeleteChannel`). Deleting one destroys a
-- shared transcript for BOTH members on ONE member's unilateral click. The
-- `is_direct = false` predicate is the whole safety story of this file, and the
-- assertion block below re-counts the DM tombstones before and after and ABORTS
-- the transaction if that number moved. `is_direct` is `NOT NULL DEFAULT false`
-- (`20260727140000`), so the predicate has no third case.
--
-- ── THE CASCADE IS THE DELETE, AND ALL SIX FKs WERE RE-VERIFIED ────────────
-- One statement, no RPC — the pattern is atomicity and one `DELETE` already has
-- it (§7). Every FK pointing at `channels(id)` is `ON DELETE CASCADE`, checked
-- in the migration files rather than assumed:
--   channel_members            20260725120000:38
--   channel_messages           20260725120000:57
--   channel_consent_requests   20260726100000:23
--   channel_tasks              20260727150000:9
--   channel_agents             20260731120000:20
--   channel_sessions           20260805120000:29
-- and one transitive hop: `channel_task_participants.task_id -> channel_tasks`
-- is `ON DELETE CASCADE` too (20260731130000:24), so thread participants go
-- with their threads. No other table in the schema references `channels`.
-- There is no `ON DELETE SET NULL` anywhere in that set, so this file needs
-- none of the subtree gymnastics `20260807110000` step 1b needed for
-- `knowledge_entries.folder_id`.
--
-- ── REALTIME: THIS SWEEP RINGS DOORBELLS, ON PURPOSE, ONCE ─────────────────
-- `channels` is `REPLICA IDENTITY DEFAULT`, so its OWN delete frames carry the
-- primary key alone and both subscribers' `workspace_id=eq.…` filter drops them.
-- The cascade's `channel_members` deletes are a different story: that table
-- carries `workspace_id` in its replica identity (`20260807150000`) and
-- `apply_rls` does NOT evaluate RLS for DELETE at all, so every connected
-- client in an affected workspace receives one doorbell per deleted membership
-- row and refetches (coalesced at 250 ms). That is the mechanism
-- `20260807150000`'s header warns about when it says the earlier purge had to
-- sort BEFORE it. Here it is unavoidable and bounded: the row count is the
-- legacy backlog, not the whole database, and the affected channels are ones
-- the app already refuses to show. Read the count from the verification SELECT
-- before applying and, if it is large, apply at a quiet hour.
--
-- ── IDEMPOTENT ─────────────────────────────────────────────────────────────
-- The statement is `DELETE … WHERE deleted_at IS NOT NULL AND is_direct = false`,
-- so a second run matches nothing. Safe to re-apply.
--
-- ── VERIFICATION (RUN THIS BEFORE APPLYING) ────────────────────────────────
--   -- 1. Exactly how many rows this deletes, and what it leaves alone:
--   select is_direct,
--          count(*)                     as tombstoned,
--          min(deleted_at)              as oldest,
--          max(deleted_at)              as newest
--     from public.channels
--    where deleted_at is not null
--    group by is_direct;
--   -- The `is_direct = false` row is what this migration deletes.
--   -- The `is_direct = true` row MUST be unchanged afterwards.
--
--   -- 2. The children that go with them (the realtime doorbell count is the
--   --    channel_members line):
--   select 'channel_members'  as child, count(*) from public.channel_members  m
--     join public.channels c on c.id = m.channel_id
--    where c.deleted_at is not null and c.is_direct = false
--   union all
--   select 'channel_messages', count(*) from public.channel_messages x
--     join public.channels c on c.id = x.channel_id
--    where c.deleted_at is not null and c.is_direct = false
--   union all
--   select 'channel_tasks', count(*) from public.channel_tasks x
--     join public.channels c on c.id = x.channel_id
--    where c.deleted_at is not null and c.is_direct = false
--   union all
--   select 'channel_consent_requests', count(*) from public.channel_consent_requests x
--     join public.channels c on c.id = x.channel_id
--    where c.deleted_at is not null and c.is_direct = false
--   union all
--   select 'channel_agents', count(*) from public.channel_agents x
--     join public.channels c on c.id = x.channel_id
--    where c.deleted_at is not null and c.is_direct = false
--   union all
--   select 'channel_sessions', count(*) from public.channel_sessions x
--     join public.channels c on c.id = x.channel_id
--    where c.deleted_at is not null and c.is_direct = false;
--
--   -- 3. Sanity: nothing tombstoned should be NEWER than the hardDeleteChannel
--   --    switch (2026-08-08) unless it is a DM. A non-DM tombstone dated after
--   --    that means something is still routing non-DMs to softDeleteChannel —
--   --    STOP and fix the service before purging.
--   select id, slug, deleted_at from public.channels
--    where deleted_at > timestamptz '2026-08-08' and is_direct = false;
--
-- ── VERIFICATION (AFTER APPLYING) ──────────────────────────────────────────
--   select count(*) as should_be_zero from public.channels
--    where deleted_at is not null and is_direct = false;
--   select count(*) as dms_preserved from public.channels
--    where deleted_at is not null and is_direct = true;   -- must match step 1
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
-- ⛔ NONE. This is a hard delete of rows and their cascaded children. There is
-- no undo statement; recovery is a point-in-time restore of the project. That
-- is the decision ("permanently deleted means permanently deleted"), and it is
-- why the verification SELECT is above the statement rather than below it. The
-- rows being removed are already unreachable through every application surface,
-- so the practical exposure is limited to anyone who was reading them through
-- raw PostgREST — which is the leak this wave exists to close.

DO $$
DECLARE
  v_dms_before  INTEGER;
  v_dms_after   INTEGER;
  v_deleted     INTEGER;
BEGIN
  SELECT count(*) INTO v_dms_before
    FROM public.channels
   WHERE deleted_at IS NOT NULL AND is_direct = true;

  DELETE FROM public.channels
   WHERE deleted_at IS NOT NULL
     AND is_direct = false;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  SELECT count(*) INTO v_dms_after
    FROM public.channels
   WHERE deleted_at IS NOT NULL AND is_direct = true;

  -- The guard, not a comment: a closed DM is live product state, so if the
  -- predicate ever stops meaning what it says, this aborts the transaction
  -- instead of destroying both members' transcript.
  IF v_dms_after <> v_dms_before THEN
    RAISE EXCEPTION
      'ABORT: closed-DM tombstones changed from % to % — this migration must NEVER touch is_direct = true rows',
      v_dms_before, v_dms_after;
  END IF;

  RAISE NOTICE
    'purge_legacy_soft_deleted_non_dm_channels: deleted % pre-switch non-DM tombstone(s) (with all cascaded children); % closed DM(s) preserved untouched',
    v_deleted, v_dms_after;
END
$$;
