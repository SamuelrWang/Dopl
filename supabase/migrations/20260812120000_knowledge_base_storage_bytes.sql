-- PER-KB STORAGE METERING — one BIGINT per knowledge base, maintained in the
-- same transaction as the entry write that changes it.
--
-- The NUMBERS are not here. Every per-plan byte cap lives in
-- `src/features/billing/kb-storage.ts` (the one retune spot, same contract as
-- `credits.ts`); this migration owns the STORAGE and the ARITHMETIC and never
-- the policy. There is no `p_limit` to pass in because nothing in SQL refuses
-- anything: enforcement is a pre-write check in the knowledge service
-- (`service-storage.ts › assertStorageHeadroom`). Gates FREEZE, never delete —
-- so the DB half must keep counting a shrink, a delete and a cascade whether or
-- not the base is over its cap, and it does.
--
-- WHY A TRIGGER AND NOT WRITER-SIDE ARITHMETIC. Entry writes in this codebase
-- are single `supabase-js` statements (`repository-entries.ts › insertEntry /
-- updateEntryRow / hardDeleteEntry`); there is no application transaction to
-- enlist a second statement into. A writer-side `read old, compute delta,
-- UPDATE the base` is therefore TWO round trips that can be interrupted between
-- them, and the counter it skews is not self-correcting. Three write paths also
-- never reach the entry writer at all:
--   * `hardDeleteFolder` — the folder's entries leave by FK CASCADE,
--   * `hardDeleteBase`   — the whole subtree leaves by FK CASCADE,
--   * `service-seed.ts › insertEntries` — one batch statement, N rows.
-- A row-level trigger is the same transaction by construction and sees all
-- three. INVARIANTS §12 already puts the `updated_at` stamp here for the same
-- reason: "stamped by a TRIGGER, not by the writer".
--
-- OCTET_LENGTH IS THE UNIT, and it agrees with the writer's own arithmetic:
-- the database is UTF-8, so `octet_length(body)` and
-- `Buffer.byteLength(body, "utf8")` are the same number. That is what lets the
-- service pre-compute a delta for the GATE without re-reading the counter's
-- definition.
--
-- ⚠ THE COUNTER IS A METER, NOT A LEDGER. It is advisory: `knowledge_bases`
-- still carries client `UPDATE` grants for editors (§5 below narrows exactly
-- that), and any drift — from a manual admin SQL write, or from a restore —
-- is corrected by re-running the §4 backfill. A nightly re-sum cron is the
-- planned insurance policy and is NOT built here.

-- ════════════════════════════════════════════════════════════════════
-- 1. The column
-- ════════════════════════════════════════════════════════════════════
--
-- BIGINT, not INTEGER: the per-entry body cap is 1 MB
-- (`knowledge/schema.ts › MAX_BODY_BYTES`) and nothing caps entry COUNT, so a
-- large base can exceed INT4 without anything being wrong. NOT NULL DEFAULT 0
-- because "no entries" is a real, knowable zero — the UNKNOWN case lives in the
-- API layer (a stats read that failed), never in this column.

ALTER TABLE public.knowledge_bases
  ADD COLUMN IF NOT EXISTS storage_bytes BIGINT NOT NULL DEFAULT 0;

-- ════════════════════════════════════════════════════════════════════
-- 2. Keep `knowledge_bases.updated_at` meaning what it has always meant
-- ════════════════════════════════════════════════════════════════════
--
-- `knowledge_bases_touch_updated_at` (20260501000000) stamps `updated_at` on
-- EVERY update, and §3 now issues updates the application never asked for. Left
-- alone, that breaks two live contracts at once:
--
--   1. THE OPTIMISTIC-CONCURRENCY CAS. `repository-bases.ts › updateBaseRow`
--      compares `updated_at` to the client's `expectedUpdatedAt`. If typing in
--      any file moved the parent base's stamp, every base rename racing an
--      entry autosave would 412 with `KNOWLEDGE_STALE_VERSION` for no reason.
--   2. THE CONTENT-vs-ROW FRESHNESS SPLIT that `types.ts › KnowledgeBaseStats`
--      spells out: `lastEntryUpdatedAt` is the newest CONTENT write and
--      `KnowledgeBase.updatedAt` "stands still while an agent fills the base
--      with files". §3 would have collapsed the two into one number.
--
-- The WHEN clause is the whole fix, and it is precise in both directions: no
-- application write ever sets `storage_bytes` (it is absent from
-- `UpdateBasePatch`), so those always stamp; §3's writes always change it (a
-- zero delta returns early), so those never do.

DROP TRIGGER IF EXISTS knowledge_bases_touch_updated_at ON public.knowledge_bases;
CREATE TRIGGER knowledge_bases_touch_updated_at
  BEFORE UPDATE ON public.knowledge_bases
  FOR EACH ROW
  WHEN (OLD.storage_bytes IS NOT DISTINCT FROM NEW.storage_bytes)
  EXECUTE FUNCTION public.touch_knowledge_updated_at();

-- ════════════════════════════════════════════════════════════════════
-- 3. Maintenance — byte delta, same transaction as the entry write
-- ════════════════════════════════════════════════════════════════════
--
-- `GREATEST(0, ...)` clamps the floor. The counter has no business going
-- negative, and if drift ever pushes it there the honest reading is "we do not
-- know, assume empty" — an under-count frees the cap, which is the direction
-- that never blocks a paying customer over a bookkeeping bug.
--
-- ZERO-DELTA WRITES DO NOT TOUCH THE BASE ROW AT ALL, and that early return
-- carries real weight: `knowledge_bases` is in `supabase_realtime`
-- (20260501030000) with a `(workspace_id, id)` replica identity, so every base
-- UPDATE is a doorbell frame to every subscriber in the workspace (§7). A
-- title-only rename, a reposition or a folder move must not ring it. The
-- trigger's `UPDATE OF` column list is the first line of that defence — the
-- function is not even entered for those — and this check is the second, for a
-- body rewritten to the same length.
--
-- A BODY WRITE DOES ring it, on purpose: that is the signal the home grid's
-- usage bar refreshes on. It costs one extra frame per body write on a table
-- that was already published.
--
-- THE CROSS-BASE BRANCH IS DEFENCE, NOT A FEATURE. `service-entries.ts ›
-- moveEntry` and `service-paths.ts › moveByPath` both refuse a cross-base move
-- (`KnowledgeBaseMismatchError`), so `knowledge_base_id` never changes in
-- practice. If some future path allows it, the bytes MOVE rather than being
-- stranded on the old base forever.

-- SECURITY DEFINER with a pinned `search_path`, for the same reason
-- `consume_workspace_credits` (20260811130000) is: §5 takes the `UPDATE` grant
-- on `knowledge_bases` away from the client roles, and a trigger running as the
-- INVOKER would then fail with "permission denied" on any entry write that ever
-- arrived as `authenticated` — turning a hardening step into an outage on a
-- path nobody meant to touch. Definer decouples the counter from whoever wrote
-- the entry, which is what a counter should be.

CREATE OR REPLACE FUNCTION public.knowledge_entry_storage_delta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old      BIGINT := 0;
  v_new      BIGINT := 0;
  v_old_base UUID;
  v_new_base UUID;
BEGIN
  -- ⚠ EVERY `OLD`/`NEW` REFERENCE IS INSIDE A NESTED BLOCK, NOT BEHIND AN
  -- `AND`. In an INSERT trigger `OLD` is an UNASSIGNED record, and plpgsql
  -- raises `record "old" is not assigned yet` when it binds the parameters for
  -- an expression that mentions it — BEFORE evaluating it, so a
  -- `TG_OP <> 'INSERT' AND OLD.x` guard does NOT save you. Same for `NEW` on
  -- DELETE. Nesting is what makes the reference unreachable rather than merely
  -- false.
  --
  -- Same "live rows only" rule as the §4 backfill: a tombstoned row weighs
  -- nothing, so tombstoning is a subtraction and (were one ever written) an
  -- un-tombstoning is an addition, with no special case anywhere.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old_base := OLD.knowledge_base_id;
    IF OLD.deleted_at IS NULL THEN
      v_old := COALESCE(octet_length(OLD.body), 0);
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_base := NEW.knowledge_base_id;
    IF NEW.deleted_at IS NULL THEN
      v_new := COALESCE(octet_length(NEW.body), 0);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_new_base IS DISTINCT FROM v_old_base THEN
    UPDATE public.knowledge_bases
       SET storage_bytes = GREATEST(0, storage_bytes - v_old)
     WHERE id = v_old_base;
    UPDATE public.knowledge_bases
       SET storage_bytes = GREATEST(0, storage_bytes + v_new)
     WHERE id = v_new_base;
    RETURN NULL;
  END IF;

  IF v_new = v_old THEN
    RETURN NULL;
  END IF;

  -- On a base hard delete the parent tuple is already gone when the FK cascade
  -- fires these row deletes, so this UPDATE matches zero rows and is a no-op.
  -- That is exactly right: the counter dies with the row it counted.
  UPDATE public.knowledge_bases
     SET storage_bytes = GREATEST(0, storage_bytes + (v_new - v_old))
   WHERE id = COALESCE(v_new_base, v_old_base);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_entries_storage_delta ON public.knowledge_entries;
CREATE TRIGGER knowledge_entries_storage_delta
  AFTER INSERT OR DELETE
     OR UPDATE OF body, deleted_at, knowledge_base_id
  ON public.knowledge_entries
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_entry_storage_delta();

-- ════════════════════════════════════════════════════════════════════
-- 4. Backfill — an ABSOLUTE re-sum, which is what makes it idempotent
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠ THE BACKFILL RUNS AFTER §3, NOT BEFORE IT, and the order is the whole
-- reason there is no window to worry about. Arm the trigger first and every
-- write from that instant forward is counted; the absolute re-sum below then
-- reconciles whatever the trigger already applied, because it SETS rather than
-- ADDS. The other order leaves a gap between "summed" and "armed" in which an
-- entry write is silently uncounted forever.
--
-- It also runs after §2, which is what keeps it from stamping `updated_at` on
-- every knowledge base in the database — a bulk touch that would have reset
-- every "Last Updated" line and invalidated every CAS snapshot in flight.
--
-- `SET storage_bytes = <sum>`, never `= storage_bytes + <sum>`: a second run
-- computes the same value and changes nothing, and this same statement is the
-- drift-correction the cron will eventually run on a schedule.
--
-- LIVE ENTRIES ONLY (`deleted_at IS NULL`), and that is a decision, not an
-- oversight. The rule asked for is "count a row only if a restore would
-- resurrect its bytes". THERE IS NO RESTORE. Deletes have been permanent since
-- 2026-08-07 (`service.ts` header; `repository-entries.ts › hardDeleteEntry`),
-- `20260807110000_purge_soft_deleted_rows.sql` swept the rows tombstoned before
-- that switch, and the surviving `deleted_at IS NULL` filters exist only to hide
-- anything that migration missed. A tombstoned row can never come back, so its
-- bytes must not be charged. The trigger in §3 applies the identical rule, so
-- the backfill and the maintenance path can never disagree about what counts.
--
-- The `LEFT JOIN`/`COALESCE` shape is load-bearing: a base with zero entries has
-- no row in the aggregate and must be reset to 0, not skipped. Skipping it is
-- how a re-run would preserve a stale non-zero value on an emptied base.

UPDATE public.knowledge_bases b
   SET storage_bytes = COALESCE(sums.total, 0)
  FROM (
    SELECT b2.id AS base_id,
           (SELECT COALESCE(SUM(octet_length(e.body)), 0)
              FROM public.knowledge_entries e
             WHERE e.knowledge_base_id = b2.id
               AND e.deleted_at IS NULL) AS total
      FROM public.knowledge_bases b2
  ) AS sums
 WHERE sums.base_id = b.id
   AND b.storage_bytes IS DISTINCT FROM COALESCE(sums.total, 0);

-- ════════════════════════════════════════════════════════════════════
-- 5. Keep the client off the counter
-- ════════════════════════════════════════════════════════════════════
--
-- ⚠ THE ONE CHANGE HERE THAT IS NOT ABOUT METERING. `knowledge_bases` has an
-- editor `UPDATE` policy (`knowledge_bases_editor_update`), and PostgREST needs
-- a table GRANT on top of it — so before this line an editor could PATCH their
-- own `storage_bytes` to 0 and walk through the cap.
--
-- REVOKING THE WHOLE `UPDATE` GRANT IS SAFE HERE, verified against the tree:
-- every knowledge write in the product goes through the service-role client
-- (`grep -rn 'from("knowledge_bases")' src apps packages dopl-desktop-app` →
-- `features/knowledge/server/repository-bases.ts` only, which builds its client
-- with `supabaseAdmin()`). No browser, SPA or Electron path issues a PostgREST
-- UPDATE against this table. This is the channels-hardening shape
-- (20260725130000) applied to the ONE verb that could forge a billing counter;
-- INSERT/DELETE are deliberately left alone, being outside this change.
--
-- A column-level revoke would NOT have worked: a table-level GRANT supersedes a
-- column-level REVOKE in Postgres, so the alternative was re-granting UPDATE
-- column-by-column — a list that silently loses every column added after it.
--
-- It cannot break §3 either: that trigger is SECURITY DEFINER precisely so the
-- counter's own UPDATE does not inherit the entry writer's (now narrower)
-- rights.
--
-- ROLLBACK is one line:
--   GRANT UPDATE ON public.knowledge_bases TO anon, authenticated;

REVOKE UPDATE ON public.knowledge_bases FROM anon, authenticated;

-- ── VERIFICATION (run on the target database after applying) ────────────────
--
--   -- (a) No base may disagree with the live sum of its entries. Zero rows.
--   SELECT b.id, b.storage_bytes, COALESCE(s.total, 0) AS actual
--     FROM knowledge_bases b
--     LEFT JOIN (SELECT knowledge_base_id, SUM(octet_length(body)) AS total
--                  FROM knowledge_entries WHERE deleted_at IS NULL
--                 GROUP BY knowledge_base_id) s
--       ON s.knowledge_base_id = b.id
--    WHERE b.storage_bytes IS DISTINCT FROM COALESCE(s.total, 0);
--
--   -- (b) The trigger is armed on the three verbs and nothing else:
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid = 'public.knowledge_entries'::regclass AND NOT tgisinternal;
--
--   -- (c) No client role may still write the counter:
--   SELECT grantee, privilege_type FROM information_schema.table_privileges
--    WHERE table_name = 'knowledge_bases' AND privilege_type = 'UPDATE';
