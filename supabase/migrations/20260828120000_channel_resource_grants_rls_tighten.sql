-- CHANNEL RESOURCE GRANTS — RLS TIGHTENING. Two defects found by the adversarial
-- review of the HOME KNOWLEDGE PANELS wave, both in
-- `20260827120000_channel_resource_grants.sql`'s policies.
--
-- ⚠ NEW FILE — never an edit to an applied migration. The original stands as the
-- record of what shipped; this one states what it should have said and why.
--
-- ═══ DEFECT 1 — THE WRITE FLOOR WAS `member`, AND THE PARTY IT BOUNDS COULD
--     WRITE THE ROWS THAT BOUND IT ═══
--
-- `channel_resource_grants_member_write` was
--   ALL USING/WITH CHECK is_current_workspace_member(workspace_id,'member')
-- while the template it says it copies — `team_resource_access_admin_write`
-- (`20260611020000_teams.sql`) — uses `'admin'`. Measured live 2026-08-26:
--   SELECT policyname, cmd, qual::text, with_check::text FROM pg_policies
--    WHERE tablename IN ('channel_resource_grants','team_resource_access');
--
-- The original header's defence was *"the SERVICE is the true gate"*. That is
-- true OF THE API and false of the DATABASE: **PostgREST is a second door**, and
-- a workspace member reaches it with their OWN JWT, where the service's
-- owner-or-admin check does not exist. So the real floor on that door was the
-- policy, at `member`.
--
-- 🔒 AND THAT IS THE PARTY THE AUDIENCE CEILING BOUNDS. A container peer can be
-- granted `member` (`home/schema.ts › grantedRole` ∈ guest|viewer|member;
-- `channel_links.granted_role` CHECK admits the same three). Layer A of the
-- ceiling (`knowledge/server/service-audience.ts`) calls the grant rows
-- "unforgeable DB facts" and reads them to decide what the operator's agent may
-- reach. At a `member` write floor, the peer could INSERT a grant on the
-- operator's KB, set `guest_write=true` on it, or DELETE the grants that fence
-- the agent — i.e. edit the facts the fence is computed from. A fence whose
-- inputs its own subject can write is not a fence.
--
-- ⚠ The enforce trigger did NOT cover this. It constrains WHICH workspace a
-- grant may name (all three ids must agree); it says nothing about WHO may
-- write one. Same-workspace and unauthorised are orthogonal.
--
-- ═══ DEFECT 2 — `agent_only`'s EXISTENCE LEAKED TO EVERY VIEWER+ ═══
--
-- The wave's stated rule is that `agent_only` is *a DIFFERENT AUDIENCE, not a
-- lower level* — the guest lane 404s it so "its existence must not leak"
-- (INVARIANTS §4A). The SELECT policy contradicted that: its viewer+ arm
-- returned EVERY grant row, `agent_only` included, so any workspace viewer could
-- read `(channel_id, resource_id, level, guest_write)` straight off PostgREST
-- and enumerate exactly which KBs the operator had wired to the agent and not to
-- them. A container peer is commonly `viewer` or `member`, so this was not a
-- theoretical audience.
--
-- 🔒 THE NEW SELECT SHAPE, and it is the audience rule restated as SQL:
--   * ADMIN+ sees every row — they are the party that MANAGES grants, and in a
--     container the operator is `owner`.
--   * everybody else sees only `level='visible'` rows, and a `guest` only for a
--     channel they are a REAL member of (the `(A) OR (M AND B')` shape from
--     `20260826120000_guest_channel_realtime_rls.sql`, kept verbatim on that arm
--     — no `visibility='public'` arm, on purpose).
-- So the three states read the same way through this door as through the lane:
-- absent and `agent_only` are ONE answer to anyone who is not managing them.
--
-- ═══ THIS IS STILL DEFENSE IN DEPTH, AND SAYING SO IS NOT A LICENCE ═══
--
-- Knowledge reads run on the SERVICE-ROLE client (`repository.ts` uses
-- `supabaseAdmin()`), which bypasses RLS, so the service filter remains the
-- fence for the APP's own path. These policies are the fence for the OTHER door.
-- The original called them "belt, not the gate" and then set the belt below the
-- gate; a belt is only belt if it is at least as tight.
-- ⚠ NOT A REALTIME CHANGE (§7): this table is in no publication, its replica
-- identity is untouched, no column grant is altered.
--
-- ═══ 🔒 THE ENFORCE TRIGGER'S INSERT ARM — ESTABLISHED, NOT ASSUMED ═══
--
-- `enforce_channel_resource_grant()` has `prosecdef = false` (verified:
--   SELECT proname, prosecdef FROM pg_proc WHERE proname='enforce_channel_resource_grant';
-- ), so its two lookups run as the INVOKING role and are RLS-FILTERED. The
-- review could not probe writes and flagged this as unestablished. It is
-- established below (P3, P7, P8, P13) — and the important half is that the
-- trigger and the policy refuse for DIFFERENT reasons, so neither is silently
-- standing in for the other.
--
-- ═══ THE PROBE SCRIPT — RUN IT, DO NOT TRUST THIS PARAGRAPH ═══
--
-- Behavioural probes, run inside ONE `BEGIN … ROLLBACK` against the live
-- project 2026-08-26, impersonating real principals via
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<user>","role":"authenticated"}';
-- (`is_current_workspace_member` is SECURITY DEFINER over `auth.uid()`, so the
-- claim IS the principal). Thirteen probes; the SHAPES they established, each of
-- which is a sentence this migration would otherwise merely assert:
--
--   P1  a workspace `member` UPDATE of `guest_write`      → 0 rows (RLS filtered)
--   P2  a workspace `member` DELETE of a grant            → 0 rows
--   P3  a `member` INSERT naming a KB it cannot SELECT    → trigger P0001
--   P4  what a `member` SEES                              → `visible` ONLY
--   P5  what an `owner` SEES                              → both levels
--   P6  an `owner` UPDATE                                 → still allowed
--   P7  a channel in ANOTHER workspace                    → trigger RAISE
--   P8  a resource_id that is no live KB                  → trigger RAISE
--   P9  duplicate (channel, kb)                           → 23505
--   P10 `is_current_workspace_member(ws,'admin')` as the member → false
--   P10b the same at `'member'`                           → TRUE  ⟵ the defect
--   P11/P12 rows that member CAN select (4 KBs, 2 channels), so that
--   P13 a `member` INSERT naming a KB **and** a channel it CAN see → **42501,
--       "new row violates row-level security policy"**
--
-- 🔒 P13 IS THE ONE THAT ESTABLISHES THE INSERT ARM, and it is why P11/P12 exist.
-- P3 alone would have been a FALSE PASS: the trigger refused it first (the KB
-- was invisible, so the lookup returned NULL and the NULL branch RAISEd), which
-- proves the trigger fails closed but proves NOTHING about the policy. P13 hands
-- the trigger two rows it can resolve, so the only thing left to refuse is
-- `WITH CHECK` — and it does, at 42501. **The enforce trigger and the write
-- policy refuse for different reasons and neither is standing in for the
-- other.** P10b is the defect in one value: the same principal met the OLD
-- policy's floor.
--
-- ⚠ The RLS-filtered lookups inside `enforce_channel_resource_grant()`
-- (`prosecdef = false`) therefore make it STRICTER under a user client and never
-- looser: an invisible row is indistinguishable from an absent one and both
-- RAISE. It is deliberately NOT made SECURITY DEFINER — that would let the
-- trigger resolve rows the caller cannot see, the only direction this could go
-- wrong. The service-role path is unaffected either way.
--
-- ═══ APPLY / VERIFY / REPLAY ═══
--
-- Applied via Supabase MCP `apply_migration`, then read back from the catalog
-- and probed behaviourally inside ROLLED-BACK transactions. The commands, not
-- their answers (§12, CLAUDE.md doc rule 4):
--   SELECT policyname, cmd, qual::text, with_check::text FROM pg_policies
--    WHERE schemaname='public' AND tablename='channel_resource_grants';
--   SELECT proname, prosecdef FROM pg_proc
--    WHERE proname = 'enforce_channel_resource_grant';
-- ⚠ REPLAY (`supabase db reset` → exit 0) IS THE GATE (§12) and is OWED, NOT
-- run: Docker is unavailable on this machine. Recorded, not glossed — same as
-- the migration this one corrects.
-- ⚠ Join on the NAME, not the filename version (F-304's re-stamp):
-- `list_migrations` prints VERSIONS; match on
-- `channel_resource_grants_rls_tighten`.
--
-- ROLLBACK (prose). Re-create the two policies with the bodies quoted at the top
-- of this file. ⚠ Doing so re-opens both defects; there is no state to restore
-- and no data is touched either way — these are policy definitions only.

-- ── 1. WRITE: member → admin, matching `team_resource_access_admin_write` ─────
DROP POLICY IF EXISTS channel_resource_grants_member_write ON channel_resource_grants;
DROP POLICY IF EXISTS channel_resource_grants_admin_write ON channel_resource_grants;
CREATE POLICY channel_resource_grants_admin_write ON channel_resource_grants
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'admin'))
  WITH CHECK (is_current_workspace_member(workspace_id, 'admin'));

-- ── 2. SELECT: `agent_only` is visible to the managers and to nobody else ────
DROP POLICY IF EXISTS channel_resource_grants_member_select ON channel_resource_grants;
CREATE POLICY channel_resource_grants_member_select ON channel_resource_grants
  FOR SELECT
  USING (
    -- The managing audience: admin+ sees every row, including `agent_only`.
    is_current_workspace_member(workspace_id, 'admin')
    OR (
      -- Everyone else sees only what is SHARED WITH PEOPLE.
      level = 'visible'
      AND (
        is_current_workspace_member(workspace_id, 'viewer')
        OR (
          is_current_workspace_member(workspace_id, 'guest')
          AND is_channel_member(channel_id)
        )
      )
    )
  );

-- ── 3. Verification read (INVARIANTS §12) ────────────────────────────────────
DO $$
DECLARE
  v_write_qual text;
  v_select_qual text;
BEGIN
  SELECT qual::text INTO v_write_qual FROM pg_policies
   WHERE schemaname='public' AND tablename='channel_resource_grants'
     AND policyname='channel_resource_grants_admin_write';
  IF v_write_qual IS NULL THEN
    RAISE EXCEPTION 'admin write policy missing';
  END IF;
  IF v_write_qual NOT LIKE '%''admin''%' THEN
    RAISE EXCEPTION 'write policy is not at the admin floor: %', v_write_qual;
  END IF;

  -- The old member-floored policy must be GONE, not merely shadowed: RLS
  -- policies are OR-ed, so leaving it in place would keep the member floor live.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='channel_resource_grants'
       AND policyname='channel_resource_grants_member_write'
  ) THEN
    RAISE EXCEPTION 'the member-floored write policy is still present';
  END IF;

  SELECT qual::text INTO v_select_qual FROM pg_policies
   WHERE schemaname='public' AND tablename='channel_resource_grants'
     AND policyname='channel_resource_grants_member_select';
  IF v_select_qual IS NULL THEN
    RAISE EXCEPTION 'select policy missing';
  END IF;
  IF v_select_qual NOT LIKE '%visible%' THEN
    RAISE EXCEPTION 'select policy no longer filters on level: %', v_select_qual;
  END IF;
  IF v_select_qual NOT LIKE '%''guest''%' THEN
    RAISE EXCEPTION 'select policy lost its guest arm: %', v_select_qual;
  END IF;

  IF (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='channel_resource_grants') <> 2 THEN
    RAISE EXCEPTION 'expected exactly two RLS policies';
  END IF;

  RAISE NOTICE 'channel_resource_grants RLS tightened: write=admin, select hides agent_only below admin';
END $$;
