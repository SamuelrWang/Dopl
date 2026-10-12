-- Per-channel and per-thread message numbers — `channel_seq` and `thread_seq`.
--
-- ⚠ **HELD: WRITTEN, ORDERED, AND DELIBERATELY NOT APPLIED.** Held by Samuel's
-- ruling (2026-10-12), not by an unmet precondition: *"write them, NEVER apply
-- them."* The `20261110140000` / `20261110150000` posture, for the same reason —
-- see `supabase/migrations-held/README.md`. The design this implements is the
-- Dopl knowledge base, `codebase-cleanup` › "Per-Channel Numbering Design".
--
-- ⚠ **NOTHING HERE HAS MET A DATABASE.** Docker is unavailable on this machine
-- and a held file is excluded from the CI replay by construction (the replay
-- reads `supabase/migrations/` and only that), so this SQL has never been
-- executed anywhere. `per-channel-numbering-schema.test.ts` proves what the TEXT
-- says; the behavioural probe inside a rolled-back transaction (the
-- `20260827120000` precedent) is OWED and recorded as owed.
--
--
-- ═══ WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT TOUCH ════════════════
--
-- `channel_seq`  per channel, on EVERY row, NOT NULL. A STABLE IDENTITY — the
--                `#N` a person cites. Gappy after a delete, on purpose.
-- `thread_seq`   per thread, NULL on a row with no `metadata.taskId`. A DENSE
--                COUNT — the `#1, #2, #3` inside one exchange.
--
-- ⚠ **`seq` IS NOT TOUCHED AND MUST NOT BE.** It stays the table-wide IDENTITY
-- cursor that the account-wide read (`repository-account.ts ›
-- listAccountMessagesAfter`) and the workspace-wide hold
-- (`repository-await-workspace.ts`) are legal because of. Renumbering it would
-- also invalidate every persisted desktop cursor, every `last_wake_seq`, and
-- every stored legacy `task-<channelId>-<seq>` thread id. These two columns are
-- PURELY ADDITIVE: no existing column changes meaning, so an older installed
-- desktop that never reads them keeps working unchanged.
--
--
-- ═══ WHY THE ALLOCATION IS RACE-FREE WITH NO NEW LOCK ═══════════════════════
--
-- ⚠ **THE LOCK ALREADY EXISTS, AND THAT IS THE WHOLE DESIGN.**
-- `channel_message_insert` already takes `pg_advisory_xact_lock` on the CHANNEL
-- before the IDENTITY `seq` is assigned (`20260725130000` H1, restated by
-- `20260912120000` §4). Two posts to one channel are therefore already
-- serialized — and a thread belongs to exactly ONE channel, so two posts to one
-- thread are two posts to one channel and are serialized by the same lock.
-- `MAX(...) + 1` inside that function needs NO counter table, NO second lock and
-- NO sequence.
--
-- ⚠ **THE TWO UNIQUE INDEXES ARE NOT DECORATION.** They are the ratchet on the
-- paragraph above: if any future write path ever inserts without going through
-- this RPC, it collides loudly instead of silently handing two messages the same
-- number. An absence is what silently stops being true (the `favorited_at`
-- precedent, INVARIANTS §2), so the closing block ASSERTS rather than trusts.
-- They are also the COVERING INDEXES for the two aggregates above — `(channel_id,
-- channel_seq)` answers `MAX(channel_seq) WHERE channel_id = ?` from the index
-- alone, and the partial one does the same for the thread. No third index.
--
-- ⚠ **NEVER COMPUTE EITHER NUMBER BY COUNTING AT READ TIME.** This tree has
-- already shipped that bug once: `20261008120000_artifact_spans_rpc.sql` lines
-- 18-29 record a derived count taken over a PostgREST select silently clipped at
-- `max_rows = 1000`, which pointed readers at the wrong message. An ordinal
-- computed per page also MOVES on every delete, which destroys the one property
-- a citable number exists to have.
--
--
-- ═══ ROLLBACK ═══════════════════════════════════════════════════════════════
--
--   DROP INDEX IF EXISTS public.channel_messages_thread_no_key;
--   DROP INDEX IF EXISTS public.channel_messages_channel_no_key;
--   ALTER TABLE IF EXISTS public.channel_messages
--     DROP COLUMN IF EXISTS thread_seq,
--     DROP COLUMN IF EXISTS channel_seq;
--   -- then re-apply `20260912120000`'s §4 block verbatim to restore the RPC.
--
-- Dropping the two columns un-numbers every transcript losslessly, because
-- nothing else in the schema references them.
--
--
-- ═══ BEFORE RELEASING THIS FILE ═════════════════════════════════════════════
--
-- Move it into `supabase/migrations/` with a git rename, in the commit that
-- makes its precondition true (README › "Releasing a held file"), and in that
-- same commit:
--
--   1. ⚠ **RE-DERIVE THE RPC BODY BELOW.** It is a `CREATE OR REPLACE` of the
--      whole function, copied from `20260912120000` §4 — the newest definition
--      as of 2026-10-12. If ANY migration applied after that one redefines
--      `channel_message_insert`, releasing this file would silently revert it.
--      Check: `grep -rln channel_message_insert supabase/migrations/`.
--   2. Add `channel_seq` and `thread_seq` to `dto-rows.ts › CHANNEL_MESSAGE_COLS`.
--      ⚠ **NOT BEFORE.** That projection names columns explicitly, so naming one
--      the database does not have turns every page read into a PostgREST 42703
--      (its own docblock, lines 187-196). Until this file is applied the columns
--      do not exist, which is exactly why B2 leaves that list alone.
--   3. Re-generate `src/shared/supabase/types.ts` from the deployed database.
--   4. `npm run build:packages` and commit both `packages/*/dist`.
--   5. Remove this file's row from `migrations-held/README.md` and from the held
--      set in `src/shared/supabase/migrations-held.test.ts`.


-- ═══ 1. THE COLUMNS ════════════════════════════════════════════════════════
--
-- ⚠ `ALTER TABLE IF EXISTS` is REQUIRED of a held file, not a style choice:
-- `migrations-held.test.ts` › "a held file is ORDER-PROOF" fails the build
-- without it, because a released held file replays by filename and may run
-- before a table it names exists.
--
-- ⚠ **NO `GRANT` IS NEEDED HERE, AND THAT IS MEASURED, NOT ASSUMED.** The
-- `favorited_at` rule (a column added by `ALTER TABLE` inherits nothing from a
-- per-column GRANT list) is about `profiles`, where `20260810120000` REVOKEd
-- table-wide SELECT. `channel_messages` never had it revoked: `authenticated`
-- and `anon` hold TABLE-level SELECT, which covers columns added later.
-- Measured against production 2026-10-12 via `information_schema.table_privileges`.
-- Section 6 asserts the outcome anyway, because that is the half that would stop
-- being true silently.
ALTER TABLE IF EXISTS public.channel_messages
  ADD COLUMN IF NOT EXISTS channel_seq BIGINT,
  ADD COLUMN IF NOT EXISTS thread_seq  BIGINT;


-- ═══ 2. THE BACKFILL ═══════════════════════════════════════════════════════
--
-- ⚠ **THE `CASE` IS LOAD-BEARING AND THE OBVIOUS VERSION IS WRONG.** Dry-run
-- read-only against production 2026-10-12: without it,
-- `PARTITION BY (channel_id, metadata->>'taskId')` collapses every UNTAGGED row
-- into ONE null partition and numbers the main room 1…1,941 — the Dopl channel's
-- newest message came back `thread_seq = 1941` while belonging to no thread at
-- all. A main-room row must be NULL here, never numbered.
--
-- ⚠ **`ORDER BY seq`, NEVER `created_at`.** `created_at` can tie, and
-- `scripts/seed-channels-demo.sql` deliberately backdates it; `seq` is the
-- authoritative arrival order (INVARIANTS §5).
--
-- Cost: one statement. 3,712 rows / 4,080 kB heap across 17 channels (production,
-- 2026-10-12) — sub-second, no batching, no downtime window needed. Re-measure
-- before releasing: `SELECT count(*) FROM channel_messages;`
WITH numbered AS (
  SELECT id,
         row_number() OVER (PARTITION BY channel_id ORDER BY seq) AS channel_no,
         CASE
           WHEN metadata ? 'taskId'
           THEN row_number() OVER (
                  PARTITION BY channel_id, metadata ->> 'taskId'
                  ORDER BY seq
                )
         END AS thread_no
    FROM public.channel_messages
)
UPDATE public.channel_messages AS m
   SET channel_seq = numbered.channel_no,
       thread_seq  = numbered.thread_no
  FROM numbered
 WHERE numbered.id = m.id;


-- ═══ 3. NOT NULL ON THE IDENTITY ═══════════════════════════════════════════
--
-- Every row gets a `channel_seq` — including the lifecycle kinds the web channel
-- view hides (`view-model-rows.ts › isLifecycleKind`) and the thread-tagged rows
-- it folds into a single card. That is deliberate: this number is an IDENTITY,
-- not a count of what is on screen, and a row with no number could never be
-- cited. `thread_seq` stays nullable because "not in a thread" is a real state.
ALTER TABLE IF EXISTS public.channel_messages
  ALTER COLUMN channel_seq SET NOT NULL;


-- ═══ 4. THE UNIQUE INDEXES (= the covering indexes) ════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS channel_messages_channel_no_key
  ON public.channel_messages (channel_id, channel_seq);

-- Partial: uniqueness is a claim about TAGGED rows only. Every main-room row
-- holds NULL here and NULLs do not collide, but a partial index says so in the
-- index rather than relying on that.
CREATE UNIQUE INDEX IF NOT EXISTS channel_messages_thread_no_key
  ON public.channel_messages (channel_id, (metadata ->> 'taskId'), thread_seq)
  WHERE thread_seq IS NOT NULL;


-- ═══ 5. THE RPC ALLOCATES BOTH, UNDER THE LOCK IT ALREADY HOLDS ════════════
--
-- ⚠ **`CREATE OR REPLACE` WITH THE SIGNATURE UNCHANGED — NO `DROP`, AND NO
-- RE-GRANT.** `20260912120000` had to drop-then-create because it ADDED four
-- parameters, and a `CREATE OR REPLACE` with extra parameters creates a SECOND
-- overload rather than replacing the first. This file adds NO parameter: both
-- numbers are derived inside the function from arguments it already receives, so
-- `REPLACE` keeps the identity of the function and `service_role`'s EXECUTE
-- grant survives untouched. Nothing to re-state, and re-stating it would be the
-- more dangerous choice.
--
-- ⚠ **ORDER INSIDE THE BODY IS THE CORRECTNESS ARGUMENT**: the advisory lock is
-- taken FIRST, both aggregates are read under it, and the INSERT happens under
-- it too. Move the lock below either `SELECT` and two concurrent posters can read
-- the same `MAX` — which is precisely what the unique indexes in section 4 would
-- then catch, loudly. `per-channel-numbering-schema.test.ts` pins this ordering.
--
-- ⚠ `RETURNS public.channel_messages` is the TABLE ROWTYPE, so `RETURNING *`
-- picks both new columns up with no change to the return clause, and the
-- repository's `ChannelMessageRow` sees them the moment the projection asks.
CREATE OR REPLACE FUNCTION public.channel_message_insert(
  p_channel_id          uuid,
  p_workspace_id        uuid,
  p_author_user_id      uuid,
  p_author_kind         text,
  p_kind                text,
  p_body                text,
  p_metadata            jsonb,
  p_client_msg_id       text,
  p_wake_verdict        text    DEFAULT NULL,
  p_recipient_user_ids  uuid[]  DEFAULT NULL,
  p_recipient_agent_ids text[]  DEFAULT NULL,
  p_delivery            text    DEFAULT NULL
)
  RETURNS public.channel_messages
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
DECLARE
  result        public.channel_messages;
  v_channel_seq bigint;
  v_thread_seq  bigint;
  v_thread_tag  text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_channel_id::text, 0));

  -- Index-only on `channel_messages_channel_no_key`.
  SELECT COALESCE(MAX(channel_seq), 0) + 1
    INTO v_channel_seq
    FROM public.channel_messages
   WHERE channel_id = p_channel_id;

  -- ⚠ Read off `p_metadata`, which is already the FINAL tag. The service resolves
  -- thread inheritance before it calls this function (`service-writes-metadata.ts`
  -- can adopt an untagged DM post into an open thread), so the caller's metadata
  -- is authoritative here and no second lookup is honest.
  v_thread_tag := p_metadata ->> 'taskId';

  IF v_thread_tag IS NOT NULL THEN
    -- Index-only on `channel_messages_thread_no_key`. Keyed on the RAW TEXT tag,
    -- never on a join to `channel_tasks`: 43 of 96 distinct tags in production
    -- have no row there (31 legacy `task-<channelId>-<seq>` ids that installed
    -- desktops still mint, 12 UUIDs whose thread row is gone — measured
    -- 2026-10-12), and an FK-keyed counter would silently skip all of them.
    SELECT COALESCE(MAX(thread_seq), 0) + 1
      INTO v_thread_seq
      FROM public.channel_messages
     WHERE channel_id = p_channel_id
       AND metadata ->> 'taskId' = v_thread_tag;
  END IF;

  INSERT INTO public.channel_messages (
    channel_id, workspace_id, author_user_id, author_kind,
    kind, body, metadata, client_msg_id,
    wake_verdict, recipient_user_ids, recipient_agent_ids, delivery,
    channel_seq, thread_seq
  ) VALUES (
    p_channel_id, p_workspace_id, p_author_user_id, p_author_kind,
    p_kind, p_body, p_metadata, p_client_msg_id,
    p_wake_verdict, p_recipient_user_ids, p_recipient_agent_ids, p_delivery,
    v_channel_seq, v_thread_seq
  )
  RETURNING * INTO result;

  RETURN result;
END;
$function$;


-- ═══ 6. ASSERT THE OUTCOME, DO NOT TRUST IT ════════════════════════════════
--
-- Each block below is something that would fail SILENTLY: a column that exists
-- but is unreadable by `authenticated`, a backfill that numbered the main room
-- as one giant thread, an index that did not get created because a duplicate
-- already existed.
DO $$
DECLARE
  n integer;
BEGIN
  -- 6a. Both columns exist, and `channel_seq` is NOT NULL.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_messages'
       AND column_name = 'channel_seq' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'channel_seq is missing or still nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'channel_messages'
       AND column_name = 'thread_seq'
  ) THEN
    RAISE EXCEPTION 'thread_seq is missing';
  END IF;

  -- 6b. ⚠ READABLE BY `authenticated`. The columns are inherited from a
  -- table-level grant rather than granted here, so this is the assertion that
  -- catches a future per-column REVOKE sweep taking them out silently.
  IF NOT has_column_privilege('authenticated', 'public.channel_messages', 'channel_seq', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.channel_messages', 'thread_seq', 'SELECT')
  THEN
    RAISE EXCEPTION 'authenticated cannot SELECT the new numbering columns';
  END IF;

  -- 6c. `channel_seq` is DENSE and 1-BASED within every channel.
  SELECT count(*) INTO n FROM (
    SELECT channel_id
      FROM public.channel_messages
     GROUP BY channel_id
    HAVING min(channel_seq) <> 1
        OR max(channel_seq) <> count(*)
  ) bad;
  IF n > 0 THEN
    RAISE EXCEPTION 'channel_seq is not a dense 1..n run in % channel(s)', n;
  END IF;

  -- 6d. ⚠ THE BACKFILL TRAP. A row with no `taskId` must hold NULL. If the
  -- `CASE` were dropped this is the assertion that fires.
  SELECT count(*) INTO n
    FROM public.channel_messages
   WHERE NOT (metadata ? 'taskId') AND thread_seq IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% untagged row(s) carry a thread_seq — the CASE was lost', n;
  END IF;

  -- 6e. A row WITH a `taskId` must hold one, and it must be dense per thread.
  SELECT count(*) INTO n
    FROM public.channel_messages
   WHERE (metadata ? 'taskId') AND thread_seq IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '% thread-tagged row(s) have no thread_seq', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT channel_id, metadata ->> 'taskId' AS tag
      FROM public.channel_messages
     WHERE metadata ? 'taskId'
     GROUP BY channel_id, metadata ->> 'taskId'
    HAVING min(thread_seq) <> 1
        OR max(thread_seq) <> count(*)
  ) bad;
  IF n > 0 THEN
    RAISE EXCEPTION 'thread_seq is not a dense 1..n run in % thread(s)', n;
  END IF;

  -- 6f. Both indexes exist under the names the RPC's aggregates rely on.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'channel_messages'
       AND indexname = 'channel_messages_channel_no_key'
  ) THEN
    RAISE EXCEPTION 'channel_messages_channel_no_key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'channel_messages'
       AND indexname = 'channel_messages_thread_no_key'
  ) THEN
    RAISE EXCEPTION 'channel_messages_thread_no_key is missing';
  END IF;
END $$;
