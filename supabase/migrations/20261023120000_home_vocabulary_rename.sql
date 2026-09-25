-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE HOME SPACE IS HOME — the storage half of the `personal` → `home` rename (Samuel, 2026-09-24)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠ WRITTEN, NOT APPLIED — §12's standing gate. Apply BY NAME (`home_vocabulary_rename`),
-- together with the server deploy that speaks the new names.
--
-- ── WHAT SAMUEL ASKED FOR ───────────────────────────────────────────────────────────────────
--
-- Verbatim: *"a personal workspace just means the hjome space? So that doesn't make sense. And it
-- seems like a channel can be created as a personal but outside the home space. that doesn't make
-- sense. We should just cut that layer no?"* — then, to the plan: *"yeah do that"*. This file is
-- the one place outside applied history that must still SPELL the old names.
--
-- ── WHAT MOVES ──────────────────────────────────────────────────────────────────────────────
--
--   workspaces.kind 'personal'                  → 'home'   (and workspaces_kind_check with it)
--   workspaces.slug 'personal' on those rows    → 'home'   (MCP keeps a one-release alias)
--   workspaces_personal_owner_uidx              → workspaces_home_owner_uidx (re-created: a
--                                                  partial index predicate cannot be altered)
--   ensure_personal_container(uuid, text)       → ensure_home_container(uuid, text)
--   personal_container_origin_of(uuid)          → home_container_origin_of(uuid)
--   enforce_personal_container_permanent()      → enforce_home_container_permanent()
--   trigger workspaces_enforce_personal_permanent → workspaces_enforce_home_permanent
--   the four column/table comments that spell the old kind
--
-- ── WHAT IS ADDED ───────────────────────────────────────────────────────────────────────────
--
--   channels_reject_home_space — the Home space holds no channels. Each home channel is its own
--   kind='link' container; the service refuses first (CHANNEL_IN_HOME_SPACE) and this trigger is
--   the backstop. It fires on INSERT and on a workspace_id move only, so the one soft-deleted
--   channel an MCP agent filed there before the fence (2026-09-25) is untouched, not rewritten.
--   DMs are covered too: the Home space has exactly one member, so no DM there has a peer.
--
-- ── WHAT STAYS ──────────────────────────────────────────────────────────────────────────────
--
--   The PERSONAL WALLET: credit_usage_events.wallet 'personal', consume_user_credits and
--   user_credit_usage. A wallet belongs to a person, not to a container kind; it is English.
--
-- ⚠ IDEMPOTENT. Every rename is guarded, every function is DROP IF EXISTS / CREATE OR REPLACE,
-- and the row updates are no-ops on a second run.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────
-- A NEW migration that runs every step below in reverse: widen the kind check to both values,
-- move the rows and slugs back, re-create the old index, functions and trigger under their old
-- names, and drop the channel trigger. Written as prose because the desktop's replica-identity
-- suite regexes this directory without stripping comments.

BEGIN;

-- ===========================================================================
-- 1. The kind value, the check and the slug
-- ===========================================================================

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_kind_check;

UPDATE public.workspaces SET kind = 'home' WHERE kind = 'personal';
UPDATE public.workspaces SET slug = 'home' WHERE kind = 'home' AND slug = 'personal';

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('standard', 'link', 'home'));

-- ===========================================================================
-- 2. One Home space per user
-- ===========================================================================

DROP INDEX IF EXISTS public.workspaces_personal_owner_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_home_owner_uidx
  ON public.workspaces (owner_id) WHERE kind = 'home';

-- ===========================================================================
-- 3. The mint and its origin lookup (same logic, same ACLs, new names)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.home_container_origin_of(p_owner_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT id FROM public.workspaces
   WHERE owner_id = p_owner_id AND kind = 'standard'
   ORDER BY (slug = 'default') DESC, created_at ASC
   LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_home_container(p_owner_id uuid, p_public_id text)
 RETURNS TABLE(id uuid, owner_id uuid, name text, slug text, public_id text, description text, icon_url text, kind text, created_at timestamp with time zone, updated_at timestamp with time zone, created boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
  w public.workspaces%rowtype;
  origin public.workspaces%rowtype;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ensure_home_container:' || p_owner_id::text, 0));

  SELECT * INTO w FROM public.workspaces
   WHERE workspaces.owner_id = p_owner_id AND workspaces.kind = 'home'
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT w.id, w.owner_id, w.name, w.slug, w.public_id,
      w.description, w.icon_url, w.kind, w.created_at, w.updated_at, false;
    RETURN;
  END IF;

  SELECT * INTO origin FROM public.workspaces WHERE workspaces.id = public.home_container_origin_of(p_owner_id);

  -- 'Personal' is the onboarding PLACEHOLDER display name (service.ts › HOME_CONTAINER_PLACEHOLDER_NAME),
  -- a stored English label, not the kind.
  INSERT INTO public.workspaces (owner_id, name, slug, public_id, description, kind, created_at)
    VALUES (
      p_owner_id,
      COALESCE(origin.name, 'Personal'),
      'home',
      p_public_id,
      NULL,
      'home',
      COALESCE(origin.created_at, now())
    )
    RETURNING * INTO w;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status, joined_at)
    VALUES (w.id, p_owner_id, 'owner', 'active', now());

  RETURN QUERY SELECT w.id, w.owner_id, w.name, w.slug, w.public_id,
    w.description, w.icon_url, w.kind, w.created_at, w.updated_at, true;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_home_container(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_home_container(uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.ensure_personal_container(uuid, text);
DROP FUNCTION IF EXISTS public.personal_container_origin_of(uuid);

-- ===========================================================================
-- 4. Permanence: the Home space cannot be deleted
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.enforce_home_container_permanent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Cascade-driven teardown (account deletion through
  -- `workspaces.owner_id -> auth.users ON DELETE CASCADE`) runs at depth >= 2.
  -- Never block it: the home space is permanent for the life of the ACCOUNT.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF OLD.kind = 'home' THEN
    RAISE EXCEPTION
      'workspace % is the home space and cannot be deleted', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_home_container_permanent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_home_container_permanent() TO service_role;

DROP TRIGGER IF EXISTS workspaces_enforce_personal_permanent ON public.workspaces;
DROP TRIGGER IF EXISTS workspaces_enforce_home_permanent ON public.workspaces;
CREATE TRIGGER workspaces_enforce_home_permanent
  BEFORE DELETE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.enforce_home_container_permanent();

DROP FUNCTION IF EXISTS public.enforce_personal_container_permanent();

-- ===========================================================================
-- 5. The Home space holds no channels (backstop to createChannel's fence)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.reject_channel_in_home_space()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = NEW.workspace_id AND kind = 'home') THEN
    RAISE EXCEPTION
      'workspace % is the home space and holds no channels; create a home channel instead', NEW.workspace_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_channel_in_home_space() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_channel_in_home_space() TO service_role;

DROP TRIGGER IF EXISTS channels_reject_home_space ON public.channels;
CREATE TRIGGER channels_reject_home_space
  BEFORE INSERT OR UPDATE OF workspace_id ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.reject_channel_in_home_space();

-- ===========================================================================
-- 6. Comments that spelled the old kind
-- ===========================================================================

COMMENT ON COLUMN public.workspaces.kind IS
  'standard = a real user-facing workspace. link = a hidden container minted by a home-channel claim: one channel, N members, never in the rail. home = the owner''s Home space, exactly one per user, one member, never in the rail, holds no channels, and never a default-resolution candidate; it holds the rows that used to be marked home_scoped.';

COMMENT ON COLUMN public.workspace_billing.plan IS
  'Billing plan for THIS container. free = no live subscription. team = $8.99 per active seat, standard workspaces only. pro = $8.99 flat on a kind=''home'' container (added 2026-09-08). solo = legacy $5.99 flat single-member standard workspace, RETIRED FROM SALE 2026-09-07, live rows honoured. Entitlement is the VERDICT (src/features/billing/server/entitlements.ts > entitledPlanFor), never this column raw.';

COMMENT ON COLUMN public.agent_identities.home_scoped IS
  'Unused: read and written by nothing. The home shelf is the caller''s kind=home container. Dropped by migrations-held/20260923120000_drop_home_scoped.sql.';

COMMENT ON TABLE public.user_credit_usage IS
  'THE PERSONAL WALLET counter: one row per (user, period). Pays for every MCP call made in that user''s HOME SPACE — their kind=''home'' container and every kind=''link'' container they OWN, whoever made the call. Allowance lives in src/features/billing/credits.ts (PERSONAL_MONTHLY_CREDITS), never here. Written ONLY by consume_user_credits.';

-- ===========================================================================
-- 7. Verification — abort on any leftover of the old KIND (the wallet word is legitimate)
-- ===========================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE kind = 'personal' OR (kind = 'home' AND slug = 'personal')) THEN
    RAISE EXCEPTION 'ABORT: a workspace row still carries the old kind or slug';
  END IF;

  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'workspaces_kind_check'))
       NOT LIKE '%''home''%'
     OR pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'workspaces_kind_check'))
       LIKE '%personal%' THEN
    RAISE EXCEPTION 'ABORT: workspaces_kind_check does not hold exactly the new vocabulary';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE pronamespace = 'public'::regnamespace
                AND (proname LIKE '%personal%'
                     OR replace(prosrc, ' ', '') LIKE '%kind=''personal''%'
                     OR prosrc LIKE '%personal_container%')) THEN
    RAISE EXCEPTION 'ABORT: a function name or body still carries the old kind';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE '%personal%')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%personal%')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conname LIKE '%personal%')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND (policyname LIKE '%personal%'
                      OR replace(coalesce(qual, '') || coalesce(with_check, ''), ' ', '') LIKE '%kind=''personal''%')) THEN
    RAISE EXCEPTION 'ABORT: an index, trigger, constraint or policy still carries the old kind';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_description d
               JOIN pg_class c ON c.oid = d.objoid AND d.classoid = 'pg_class'::regclass
              WHERE c.relnamespace = 'public'::regnamespace
                AND (replace(d.description, '''', '') LIKE '%kind=personal%'
                     OR d.description LIKE '%personal container%')) THEN
    RAISE EXCEPTION 'ABORT: a comment still names the old kind';
  END IF;

  IF (SELECT count(*) FROM pg_trigger
       WHERE NOT tgisinternal
         AND tgname IN ('workspaces_enforce_home_permanent', 'channels_reject_home_space')) <> 2 THEN
    RAISE EXCEPTION 'ABORT: a Home-space trigger is missing';
  END IF;

  IF to_regclass('public.workspaces_home_owner_uidx') IS NULL THEN
    RAISE EXCEPTION 'ABORT: the one-Home-per-user index is missing';
  END IF;

  IF has_function_privilege('authenticated', 'public.ensure_home_container(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ensure_home_container(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: the Home mint is callable by a role that must not call it';
  END IF;

  RAISE NOTICE 'home_vocabulary_rename: kind and slug moved, 3 functions + 1 trigger + 1 index renamed, 4 comments restated, channel backstop added.';
END
$$;

COMMIT;
