-- CHANNEL RESOURCE GRANTS — the (resource, channel) grant table behind HOME
-- KNOWLEDGE PANELS scope A ("shared into a channel"). M0: schema + read model.
--
-- Template: `team_resource_access` (`20260611020000_teams.sql` §3) — the same
-- polymorphic-resource, per-(resource,scope) grant shape, with `channel_id`
-- taking the place of `team_id` and a three-state level of its own.
--
-- ═══ THE MODEL ═══
--
--   * ONE grant per (resource, channel) — that is the PRIMARY KEY. "Not shared"
--     is the ABSENCE of a row; there is no `'none'` level. Deleting the row is
--     how a resource stops being shared into a channel (M1's write path).
--   * `resource_type` is the generalization seam. It ships with EXACTLY ONE
--     value, `'knowledge_base'`; skills/templates widen the CHECK in a later
--     wave (build knowledge only, per the ruling). One value today, so the
--     enforce trigger below only ever resolves against `knowledge_bases`.
--   * `level` is `'agent_only' | 'visible'`. `agent_only` = the operator's own
--     agents may reach the KB in this channel but a human guest may not SEE it;
--     `visible` = a guest reading the channel-scoped lane sees it too. These are
--     two AUDIENCES, not a high/low pair — the read lane (M2) 404s `agent_only`
--     rather than "downgrading" it, so existence never leaks.
--   * `guest_write` lives ON THE GRANT, not on the KB. A KB granted into N
--     channels is N separate audience questions; the KB keeps its own per-KB
--     `agent_write_enabled` (correctly). Default OFF. Only meaningful at
--     `level='visible'` with a guest member present (surfaced in the per-channel
--     grant row UI, M1).
--
-- ═══ 🔒 SAME-WORKSPACE ONLY (the enforce trigger) ═══
--
-- `enforce_channel_resource_grant()` (BEFORE INSERT OR UPDATE) requires
--   knowledge_bases.workspace_id == channels.workspace_id == NEW.workspace_id,
-- with a DISTINCT RAISE per branch. This is the fence that keeps a grant from
-- becoming a cross-tenant read path: a HOME-workspace KB (scope C) granted into
-- a link container would let that container's guest read across tenancy, which
-- the ruling forbids. Consequence, stated plainly: scope-C KBs CANNOT be
-- granted — to share one, create the KB inside the channel's workspace (no
-- move/copy this wave, Samuel's ruling #1).
--
-- ═══ RLS — DEFENSE IN DEPTH ONLY (not the fence) ═══
--
-- Knowledge reads run on the SERVICE-ROLE client (`repository.ts` uses
-- `supabaseAdmin()`), which BYPASSES RLS — the service filter is the real fence
-- (§2). These policies exist for direct user-client / realtime reads. The
-- SELECT policy mirrors `20260826120000_guest_channel_realtime_rls.sql`'s
-- `(A) OR (M AND B')` shape so a guest sees the grants of the ONE channel it
-- belongs to and nothing else:
--   A  = `is_current_workspace_member(workspace_id,'viewer')`      (viewer+)
--   M  = `is_current_workspace_member(workspace_id,'guest')`       (any rank)
--   B' = `is_channel_member(channel_id)`                            (REAL member)
-- B' has no `visibility='public'` arm, on purpose: a lowered floor plus an
-- inherited public arm is how a narrow grant turns into a cross-channel read.
-- WRITE is `is_current_workspace_member(workspace_id,'member')` — a floor; the
-- SERVICE is the true gate (owner-or-admin, mirroring
-- `kb-sharing-section.tsx › canManage`).
-- ⚠ NOT A REALTIME CHANGE (§7): this table is NOT in any publication, no
-- replica identity is set, no column grant is touched. `is_current_workspace_member`
-- and `is_channel_member` are the existing SECURITY DEFINER helpers.
--
-- ═══ INDEXES ═══
--
--   * PK (channel_id, resource_type, resource_id) — its LEADING column covers
--     the `channel_id` FK cascade (the `unindexed_foreign_keys` advisor checks
--     the leading column). So there is deliberately NO `channel_idx`.
--   * `channel_resource_grants_resource_idx (workspace_id, resource_type,
--     resource_id)` — answers "which channels is THIS KB shared into" AND covers
--     the `workspace_id` FK cascade as a leading column. (§12: an index exists
--     only if a named statement uses it — an FK cascade counts.)
--   * `created_by` → auth.users is `ON DELETE SET NULL`, mirroring
--     `team_resource_access`/`teams`, which carry no dedicated created_by index.
--
-- ═══ HARD-DELETE GC (the polymorphic-resource_id leak) ═══
--
-- `resource_id` is POLYMORPHIC and carries NO foreign key (same as
-- `team_resource_access`), so Postgres cannot cascade a grant away when its KB
-- row is DELETED. KB deletes are PERMANENT and IMMEDIATE (`deleteBase` ->
-- `hardDeleteBase`). Every other polymorphic grant table closes exactly this
-- gap with an AFTER DELETE trigger on the resource — `20260807130000_knowledge_
-- base_grant_cleanup.sql` is the precedent, and it says in as many words that
-- "the fix is the one every sibling type already uses". So this migration adds
-- `channel_resource_grants_kb_cleanup` on `knowledge_bases`, matching that
-- pattern, so a hard-deleted KB does not leave orphaned grant rows forever.
-- (Channel deletion and workspace deletion are already covered by the two FK
-- cascades above.) NOT a security hole either way — resolution joins the LIVE
-- base — but unbounded garbage in a table admins read, avoided from birth.
--
-- ═══ APPLY / VERIFY / REPLAY ═══
--
-- Applied via Supabase MCP `apply_migration`, then the catalog read back
-- (pg_get_constraintdef, pg_indexes, pg_trigger, pg_policies.qual) AND
-- behavioural probes in ROLLED-BACK transactions (cross-workspace grant RAISEs;
-- same-workspace succeeds; duplicate (channel,kb) 23505). The in-migration
-- DO $$ block below RAISEs unless the table, PK, both trigger functions, the
-- resource index and both policies exist.
-- ⚠ REPLAY (`supabase db reset` -> exit 0) IS THE GATE (§12) and is OWED, NOT
-- run: Docker is unavailable on this machine, so the local stack cannot start.
-- Recorded, not glossed.
-- ⚠ Join on the NAME, not the filename version — F-304's re-stamp: this file
-- applies under a re-stamped history version. `list_migrations` prints VERSIONS;
-- match on `channel_resource_grants`.
-- ⚠ NEW FILE — never an edit to an applied migration.
--
-- ROLLBACK (prose). `DROP TABLE channel_resource_grants;` then
-- `DROP TRIGGER channel_resource_grants_kb_cleanup ON knowledge_bases;` and its
-- function, `DROP FUNCTION enforce_channel_resource_grant();`. ⚠ ORDERING TRAP:
-- dropping the table while `visible` grants are live SILENTLY BLANKS the guest
-- channel-knowledge lane (every granted KB vanishes from it with no error) — so
-- either announce that the lane will go dark, or revoke the visible grants
-- first. No data loss beyond the grants themselves; a KB is untouched.

-- ── 1. The table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_resource_grants (
  channel_id    UUID NOT NULL REFERENCES channels(id)   ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('knowledge_base')),
  resource_id   UUID NOT NULL,
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  level         TEXT NOT NULL CHECK (level IN ('agent_only','visible')),
  guest_write   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, resource_type, resource_id)
);

-- "Which channels is this KB shared into" + the workspace_id FK cascade cover.
CREATE INDEX IF NOT EXISTS channel_resource_grants_resource_idx
  ON channel_resource_grants (workspace_id, resource_type, resource_id);

-- ── 2. RLS (defense in depth; the service is the fence) ──────────────────────
ALTER TABLE channel_resource_grants ENABLE ROW LEVEL SECURITY;

-- SELECT: viewer+ workspace member, OR a guest that is a REAL member of the
-- channel the grant is on (the `20260826120000` (A) OR (M AND B') shape).
CREATE POLICY channel_resource_grants_member_select ON channel_resource_grants
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer')
    OR (
      is_current_workspace_member(workspace_id, 'guest')
      AND is_channel_member(channel_id)
    )
  );

-- WRITE: member+ floor. The SERVICE enforces owner-or-admin — this is the
-- belt, not the gate.
CREATE POLICY channel_resource_grants_member_write ON channel_resource_grants
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'member'))
  WITH CHECK (is_current_workspace_member(workspace_id, 'member'));

-- ── 3. updated_at, via the existing knowledge touch trigger fn ───────────────
DROP TRIGGER IF EXISTS channel_resource_grants_touch_updated_at ON channel_resource_grants;
CREATE TRIGGER channel_resource_grants_touch_updated_at
  BEFORE UPDATE ON channel_resource_grants
  FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();

-- ── 4. Validity trigger — 🔒 same-workspace only ─────────────────────────────
-- kb.workspace_id == channel.workspace_id == NEW.workspace_id. Distinct RAISE
-- per branch. Pattern: `assert_team_grant_workspace` (20260611020000 §7), plus
-- the channel lookup. Not SECURITY DEFINER — writes run as service role, as
-- with the teams triggers.
CREATE OR REPLACE FUNCTION enforce_channel_resource_grant() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  channel_ws UUID;
  res_ws     UUID;
BEGIN
  SELECT workspace_id INTO channel_ws FROM channels WHERE id = NEW.channel_id;
  IF channel_ws IS NULL THEN
    RAISE EXCEPTION 'channel_resource_grants: channel % does not exist', NEW.channel_id;
  END IF;

  -- resource_type has exactly one value today; resolve against knowledge_bases.
  IF NEW.resource_type = 'knowledge_base' THEN
    SELECT workspace_id INTO res_ws FROM knowledge_bases WHERE id = NEW.resource_id;
  ELSE
    RAISE EXCEPTION 'channel_resource_grants: unsupported resource_type %', NEW.resource_type;
  END IF;
  IF res_ws IS NULL THEN
    RAISE EXCEPTION 'channel_resource_grants: % % does not exist', NEW.resource_type, NEW.resource_id;
  END IF;

  IF channel_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'channel_resource_grants: channel workspace mismatch (grant=%, channel=%)', NEW.workspace_id, channel_ws;
  END IF;
  IF res_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'channel_resource_grants: resource workspace mismatch (grant=%, resource=%)', NEW.workspace_id, res_ws;
  END IF;

  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS channel_resource_grant_workspace_check ON channel_resource_grants;
CREATE TRIGGER channel_resource_grant_workspace_check
  BEFORE INSERT OR UPDATE ON channel_resource_grants
  FOR EACH ROW EXECUTE FUNCTION enforce_channel_resource_grant();

-- ── 5. Hard-delete GC — purge grants when their KB is permanently deleted ────
-- The polymorphic resource_id has no FK, so nothing cascades. Mirrors
-- `drop_knowledge_base_grants` (20260807130000) for team_resource_access. No
-- one-time sweep: the table is created empty in this same migration.
CREATE OR REPLACE FUNCTION drop_channel_resource_grants_for_kb() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM channel_resource_grants
   WHERE resource_type = 'knowledge_base' AND resource_id = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS channel_resource_grants_kb_cleanup ON knowledge_bases;
CREATE TRIGGER channel_resource_grants_kb_cleanup AFTER DELETE ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION drop_channel_resource_grants_for_kb();

-- ── 6. Trigger fns never need direct EXECUTE from API roles (advisor 0028/0029)
REVOKE EXECUTE ON FUNCTION public.enforce_channel_resource_grant() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.drop_channel_resource_grants_for_kb() FROM anon, authenticated;

-- ── 7. Verification read (INVARIANTS §12) ────────────────────────────────────
-- Commands that confirm this applied:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid='public.channel_resource_grants'::regclass;
--   SELECT indexname FROM pg_indexes
--     WHERE tablename='channel_resource_grants';
--   SELECT tgname FROM pg_trigger
--     WHERE tgrelid='public.channel_resource_grants'::regclass AND NOT tgisinternal;
--   SELECT policyname, qual FROM pg_policies
--     WHERE tablename='channel_resource_grants';
DO $$
DECLARE
  v_pk_cols text;
BEGIN
  IF to_regclass('public.channel_resource_grants') IS NULL THEN
    RAISE EXCEPTION 'channel_resource_grants table missing';
  END IF;

  -- PK is exactly (channel_id, resource_type, resource_id).
  SELECT string_agg(a.attname, ',' ORDER BY array_position(con.conkey, a.attnum))
    INTO v_pk_cols
  FROM pg_constraint con
  JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
  WHERE con.conrelid = 'public.channel_resource_grants'::regclass
    AND con.contype = 'p';
  IF v_pk_cols <> 'channel_id,resource_type,resource_id' THEN
    RAISE EXCEPTION 'unexpected PK columns: %', v_pk_cols;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='channel_resource_grants'
      AND indexname='channel_resource_grants_resource_idx'
  ) THEN
    RAISE EXCEPTION 'resource_idx missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.channel_resource_grants'::regclass
      AND tgname='channel_resource_grant_workspace_check'
  ) THEN
    RAISE EXCEPTION 'validity trigger missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.channel_resource_grants'::regclass
      AND tgname='channel_resource_grants_touch_updated_at'
  ) THEN
    RAISE EXCEPTION 'touch trigger missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.knowledge_bases'::regclass
      AND tgname='channel_resource_grants_kb_cleanup'
  ) THEN
    RAISE EXCEPTION 'kb-cleanup trigger missing';
  END IF;

  IF (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='channel_resource_grants') <> 2 THEN
    RAISE EXCEPTION 'expected exactly two RLS policies';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='channel_resource_grants'
      AND policyname='channel_resource_grants_member_select'
      AND qual::text LIKE '%''guest''%'
  ) THEN
    RAISE EXCEPTION 'select policy missing its guest arm';
  END IF;

  RAISE NOTICE 'channel_resource_grants verified: PK=(%), resource_idx, 2 triggers on grants + kb cleanup, 2 RLS policies with a guest select arm', v_pk_cols;
END $$;
