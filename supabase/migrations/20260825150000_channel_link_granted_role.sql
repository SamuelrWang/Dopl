-- LINK-CARRIED ROLE — the granted role a bound claim confers (M2 of the
-- guest-role feature; CLOSES F-319).
--
-- Before this, `home/server/repository-containers.ts › insertContainerMember`
-- hardcodes the claimer's role as `admin`, so anyone who claims a bound link
-- lands as a workspace ADMIN — full workspace-scoped reach plus the hard-delete
-- path, which is the measured hole F-319 names. M0/M1 added the `guest` role and
-- the per-route enforcement floor but NOT the grant: until the link CARRIES a
-- role and the claim writes it, every claimer is still an admin.
--
-- This adds `channel_links.granted_role`: the role the claim confers on the
-- person who claims that link.
--
--   * DEFAULT 'guest' — an OPEN bound link with no explicit grant confers the
--     FLOOR role, which backfills every link already minted. Fail-closed: a link
--     minted before this column existed grants the least privilege, not the most.
--   * CHECK (granted_role IN ('guest','viewer','member')) — the CEILING is
--     `member`. `admin`/`owner`-via-link is UNREPRESENTABLE at the database, so
--     no mint bug, schema drift or hand-written insert can reintroduce the
--     admin-claimer hole this migration closes. `guest` is the default and the
--     floor; `viewer` is schema-valid but the picker keeps it hidden (Samuel's
--     ruling); `member` is the full-channel grant.
--
-- ⚠ SCOPE — this column governs the BOUND claim only. The LEGACY UNBOUND claim
-- (`workspace_id IS NULL`) keeps its hardcoded `admin` claimer on purpose:
-- honoring granted_role there would silently downgrade links already in the
-- wild (INVARIANTS §4A, plan §4.3). Those tokens predate this column and are
-- never re-minted, so they carry the DEFAULT 'guest' here but the unbound path
-- never reads it.
--
-- ⚠ NEW FILE — never an edit to an applied migration. An applied migration is
-- history.
--
-- DTO ORDER TRAP (plan §4.1): `granted_role` is added to `dto.ts ›
-- CHANNEL_LINK_COLS` and `ChannelLinkRow` only AFTER this applies. Naming a
-- nonexistent column in a PostgREST `select` is a 42703 500 on EVERY link read,
-- so the column must exist first.
--
-- ROLLBACK (prose): `ALTER TABLE public.channel_links DROP COLUMN granted_role;`
-- after reverting the DTO and claim wiring. No data depends on it once the claim
-- path stops reading it.

-- 1. The column: default guest (backfills open links), ceiling member.
ALTER TABLE public.channel_links
  ADD COLUMN granted_role text NOT NULL DEFAULT 'guest'
    CHECK (granted_role IN ('guest','viewer','member'));

-- 2. Verification read (INVARIANTS §12) — the commands to confirm this applied.
DO $$
DECLARE
  v_default text;
  v_notnull boolean;
  v_check   text;
BEGIN
  SELECT column_default, (is_nullable = 'NO')
    INTO v_default, v_notnull
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'channel_links'
    AND column_name  = 'granted_role';

  SELECT pg_get_constraintdef(con.oid) INTO v_check
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'channel_links'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%granted_role%';

  IF v_default IS NULL OR position('guest' IN v_default) = 0 THEN
    RAISE EXCEPTION 'channel_links.granted_role default is not guest: %', v_default;
  END IF;
  IF NOT v_notnull THEN
    RAISE EXCEPTION 'channel_links.granted_role is nullable — expected NOT NULL';
  END IF;
  IF v_check IS NULL
     OR position('guest' IN v_check) = 0
     OR position('viewer' IN v_check) = 0
     OR position('member' IN v_check) = 0
     OR position('admin' IN v_check) <> 0 THEN
    RAISE EXCEPTION 'granted_role CHECK is not (guest,viewer,member): %', v_check;
  END IF;

  RAISE NOTICE 'granted_role migration verified: DEFAULT=% NOT NULL, CHECK=%',
    v_default, v_check;
  RAISE NOTICE 'admin/owner-via-link is now unrepresentable — F-319 ceiling is member.';
END $$;
