-- GUEST ROLE — DB layer (M0 of the guest-role feature; closes part of F-319).
--
-- Adds `guest`, the link-granted FLOOR role below `viewer`, to two places the
-- database owns:
--
--   1. The CHECK on `workspace_members.role`. Today it is
--      CHECK (role IN ('owner','admin','member','viewer')), so `role='guest'`
--      is rejected on EVERY client including the service-role one. Until this
--      widens, no membership can carry the role at all. Constraint name resolved
--      from information_schema at write time:
--        SELECT con.conname FROM pg_constraint con
--          JOIN pg_class c ON c.oid=con.conrelid
--          JOIN pg_namespace n ON n.oid=c.relnamespace
--        WHERE n.nspname='public' AND c.relname='workspace_members'
--          AND con.contype='c';
--      → `workspace_members_role_check` (measured 2026-08-25 on project
--        mrefkedvdehahjejreae).
--
--   2. The rank CASE inside `public.is_workspace_member`, the SECURITY DEFINER
--      function behind every workspace RLS policy. Today a `guest` role falls to
--      `ELSE -1`, so it is ALREADY fail-closed for a `>= 'viewer'` policy (which
--      is what `is_current_workspace_member(workspace_id,'viewer')` on the
--      channel tables passes). This makes that implicit `-1` EXPLICIT.
--
-- SCHEME CHOICE (recorded per the plan's §1.3 requirement): KEEP the existing
-- numeric scheme (viewer 0, member 1, admin 2, owner 3) and give guest the new
-- floor at -1, rather than re-basing every rank to match the TypeScript
-- ROLE_RANK (guest 0, viewer 1, …). Reasons:
--   * Every existing rank number is UNCHANGED, so no RLS policy that passes a
--     literal min-role ('viewer', 'member', 'admin', 'owner', legacy 'editor')
--     needs to be rewritten — the blast radius is one function body.
--   * Relative order still matches TypeScript exactly (guest < viewer < member
--     < admin < owner), which is all `meetsMinRole` / any policy compares.
--   * The absolute numbers never cross a system boundary — there is no join on
--     the numeric value, only on the role NAME — so a scheme mismatch with the
--     TS scale is immaterial, and `scripts/check-role-drift.ts` guards the role
--     SET, not the numbers.
--
-- RLS REACH (verified against the live project 2026-08-25): the guest-reachable
-- CHANNEL reads all run through `src/features/channels/server/repository.ts`,
-- which uses the service-role admin client (RLS-BYPASSING, per its own
-- docblock). So this function is NOT consulted on the guest's API read path —
-- the change is pure defense-in-depth (and covers direct user-client / realtime
-- reads, where a guest is correctly denied a `>= 'viewer'` policy). No
-- channel_members-based RLS arm is required.
--
-- ⚠ NEW FILE — never an edit to an applied migration. An applied migration is
-- history.
--
-- ROLLBACK (prose, no ordering trap on its own): narrow the CHECK back to the
-- four-role set ONLY after every `role='guest'` row is gone (a surviving guest
-- row would fail the narrowed CHECK on its next UPDATE), and re-drop the guest
-- arm from the function (harmless — it re-collapses into `ELSE -1`).

-- 1. Widen the role CHECK to admit 'guest'.
ALTER TABLE public.workspace_members
  DROP CONSTRAINT workspace_members_role_check;

ALTER TABLE public.workspace_members
  ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner','admin','member','viewer','guest'));

-- 2. Make the guest floor explicit in the rank function. Body is IDENTICAL to
--    the live definition except for the two `WHEN 'guest' THEN -1` arms.
CREATE OR REPLACE FUNCTION public.is_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_min_role text DEFAULT 'viewer'::text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id      = p_user_id
      AND m.status       = 'active'
      AND CASE m.role
            WHEN 'owner'  THEN 3
            WHEN 'admin'  THEN 2
            WHEN 'member' THEN 1
            WHEN 'viewer' THEN 0
            WHEN 'guest'  THEN -1
            ELSE -1
          END
        >=
          CASE p_min_role
            WHEN 'owner'  THEN 3
            WHEN 'admin'  THEN 2
            WHEN 'member' THEN 1
            WHEN 'editor' THEN 1
            WHEN 'viewer' THEN 0
            WHEN 'guest'  THEN -1
            ELSE -1
          END
  );
$$;

-- 3. Verification read (INVARIANTS §12) — the commands to confirm this applied.
DO $$
DECLARE
  v_check text;
  v_fn    text;
BEGIN
  SELECT pg_get_constraintdef(con.oid) INTO v_check
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'workspace_members'
    AND con.conname = 'workspace_members_role_check';

  SELECT pg_get_functiondef('public.is_workspace_member(uuid,uuid,text)'::regprocedure)
  INTO v_fn;

  IF position('guest' IN v_check) = 0 THEN
    RAISE EXCEPTION 'guest missing from workspace_members_role_check: %', v_check;
  END IF;
  IF position('guest' IN v_fn) = 0 THEN
    RAISE EXCEPTION 'guest arm missing from is_workspace_member';
  END IF;

  RAISE NOTICE 'guest-role migration verified: CHECK=% ', v_check;
  RAISE NOTICE 'is_workspace_member now carries a guest arm (rank -1, below viewer 0).';
END $$;
