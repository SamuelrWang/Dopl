-- `workspaces.kind = 'personal'` — ONE CONTAINER PER USER (2026-09-02, wave B B11).
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY HAS NEVER RUN** (Docker was down for all of
-- wave A and all of wave B batch 1). Deploy state is a MEASUREMENT: re-derive
-- with `supabase migration list` / the MCP `list_migrations`, and **JOIN ON THE
-- NAME** — `20260823150000` applied as `20260823205007` and `20260823160000` as
-- `20260823205026`, so a filename prefix is not an applied version
-- (INVARIANTS §12, F-304). Nine batch-1 migrations are pending ahead of this
-- one; apply them first, in filename order.
--
-- ⚠⚠ **APPLYING THIS FILE HAS A CODE PRECONDITION, AND IT IS NOT OPTIONAL
-- (F-564).** A set of sites derive "this is a home channel" from
-- `!isStandardWorkspace(w)` — the LISTING predicate's negation — rather than
-- from `kind === "link"`.
--
-- 🔒 **THE PRECONDITION IS A GATE NOW, NOT THIS PARAGRAPH** (2026-09-02, in
-- review):
--
--   npx vitest run src/features/workspaces/home-channel-derivation.test.ts
--
-- ⚠ **AND THE PARAGRAPH IT REPLACES WAS WRONG IN A WAY THAT MATTERS.** It said
-- EIGHT sites and told the reader to `grep -rn '!isStandardWorkspace'`, which
-- answers FOUR — because half of them are the ELSE BRANCH of a ternary
-- (`isStandardWorkspace(w) ? "workspace" : "home channel"`) or an early return,
-- and a negation grep cannot see either shape. So the count and the command
-- under it disagreed, and the precondition on an unapplied migration was prose
-- with no way to check it. The gate scans all three shapes across all three
-- trees, holds the disposition of each FILE (which slice repoints or deletes
-- it), and fails in BOTH directions — a new site, or a fixed one whose record
-- did not leave with it.
--
-- **WHEN THAT SET IS EMPTY, THIS FILE MAY BE APPLIED.** Deleting the gate's map
-- IS the sign-off; there is no second place to look.
--
-- Today those sites are correct by accident: `standard` and `link` are the only
-- kinds, so "not standard" IS "link". THIS MIGRATION MAKES THAT FALSE for every
-- user at once — each of them would advertise a `personal` container as a home
-- channel. It is a MISLABEL rather than a leak (the container is the caller's
-- own, listed to its only member), which is why it does not block the code
-- landing; it blocks the migration RUNNING.
--
-- ⚠ THE FIX IS EITHER DIRECTION AND BOTH ARE BATCH 3: each site asks
-- `kind === "link"` (`workspaces/server/shared-publish.ts` states the rule in
-- as many words), or B13/B15 DELETE the surface — `dopl_home`, `home-scopes.ts`
-- and `copy-target.ts` go with the `workspace=` and copy retirements.
-- ⚠ Deleting a surface closes it too, **but only if the deletion actually lands
-- before this file does.** `confirm-token.ts` is in no slice's Owns column and
-- needs assigning before either half can be called finished.
--
-- ── WHAT THIS IS (Samuel's ruling B10 + #18) ───────────────────────────────
--
--   > Every user has exactly one `kind='personal'` container. When nothing is
--   > named, the answer is that container.
--
-- The PERSONAL SHELF stops being a `WHERE` (`home_scoped = true` inside
-- whichever standard workspace a lookup called "the default") and becomes a
-- TENANCY: one hidden container per person, spanning home and every workspace
-- they are in. A personal template or KB is then usable from any container the
-- user belongs to, and sharing it is a GRANT (`resource_grants`, B1) rather than
-- a copy. That is what supersedes INVARIANTS:643 — *"a home-workspace template
-- cannot launch into a home channel, and no grant table could fix it"* — which
-- was true of a workspace-KEYED read and stopped being true when A12/B2 made an
-- id resolve its own container.
--
-- ⚠ **THERE IS NO `is_default` COLUMN ANYWHERE IN THE TREE** (verified across
-- `*.sql`, `*.ts`, `*.tsx`). "The default workspace" is entirely DERIVED — the
-- legacy `slug='default'` row, else the oldest owned `kind='standard'` one — so
-- removing the concept costs no data and this migration adds no column to
-- replace it. The only new rows are the containers themselves.
--
-- ── THE THREE ORDERED STEPS, AND WHY THIS IS ONLY THE FIRST ────────────────
--
--   1. THIS FILE — additive. Widen the kind CHECK, add
--      `ensure_personal_container`, mint one container per user, move the
--      `home_scoped` rows into it, add the one-per-owner unique index.
--   2. A DUAL-WRITE RELEASE — `TENANCY_PERSONAL_CONTAINER` (default OFF).
--      `home_scoped` keeps carrying the truth while the container carries the
--      address; the flag decides which one a read prefers. See
--      `src/shared/tenancy/personal-container.ts` for the 2x2 this file is one
--      axis of.
--   3. `20260923120000_drop_home_scoped.sql` (batch 3, B15) — drop both
--      `home_scoped` columns, `ensure_default_workspace`, the
--      `default_workspace_kind_guard` body and the `slug='default'` relic.
--      That step is the irreversible one and lands a RELEASE later.
--
-- ── ROLLBACK — MOVE THE ROWS BACK **BEFORE** DELETING THE CONTAINERS ───────
--
-- 🔒 ⚠ `knowledge_bases.workspace_id` and `agent_templates.workspace_id` are
-- `ON DELETE CASCADE`, so a bare `DELETE FROM workspaces WHERE kind='personal'`
-- **DESTROYS EVERY PERSONAL BASE AND TEMPLATE IT HOLDS**. The revert is two
-- statements and an order, not one statement:
--
--     -- 1. put the shelf back where the pre-B11 read looks for it
--     UPDATE public.knowledge_bases k SET workspace_id = public.default_workspace_of(k.created_by)
--       WHERE k.workspace_id IN (SELECT id FROM public.workspaces WHERE kind = 'personal');
--     UPDATE public.agent_templates t SET workspace_id = public.default_workspace_of(t.created_by)
--       WHERE t.workspace_id IN (SELECT id FROM public.workspaces WHERE kind = 'personal');
--     -- 2. only now
--     DELETE FROM public.workspaces WHERE kind = 'personal';
--     DROP FUNCTION IF EXISTS public.ensure_personal_container(uuid, text);
--     DROP FUNCTION IF EXISTS public.default_workspace_of(uuid);
--     ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_kind_check;
--     ALTER TABLE public.workspaces
--       ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('standard','link'));
--
-- **THE REVERT IS EXACT** because `default_workspace_of()` — the same helper the
-- mint uses — is the one derivation of "today's default", and `home_scoped`
-- still carries the truth until step 3. Its one precondition: the origin
-- workspace must still exist. If an owner's last standard workspace was deleted
-- in between, `default_workspace_of` answers NULL and the UPDATE would violate
-- `NOT NULL` — which FAILS THE REVERT rather than silently filing the row
-- somewhere. That is the correct direction: **rollback fails CLOSED, never
-- open.** No state in between exposes a personal row to another member, because
-- a personal container has exactly one member at every moment of both
-- directions.
--
-- ── WHAT DOES *NOT* CHANGE HERE, AND WHY EACH IS ALREADY SAFE ──────────────
--
--   * **`ensure_default_workspace` and its kind guard are untouched.**
--     `20260823160000` already selects `kind = 'standard'` POSITIVELY, so a
--     personal container can never be returned or created as somebody's
--     default. The guard has nothing left to guard once the default goes, which
--     is why the spec RETIRES it in step 3 rather than repointing it now.
--   * **`isStandardWorkspace` needs no arm.** It is `(kind ?? 'standard') ===
--     'standard'` in all three copies (INVARIANTS §4A, F-295), so `personal` is
--     excluded from the rail, the switcher, `list_workspaces` and default
--     resolution the moment the value exists. A negative spelling
--     (`!== 'link'`) would have admitted it silently — this is that rule paying
--     for itself.
--   * **`resource_grants` needs no arm.** `enforce_resource_grant()`
--     (`20260914120000`) fences a grant on the GRANTOR being a non-guest member
--     of the resource's container AND of the scope's container — never on the
--     two containers being the same, and never on `kind`. The owner of a
--     personal container is a member of both by construction, so lending a
--     personal KB into a workspace channel already works.
--   * **Billing already reroutes.** `credits-service.ts › resolveBillingTarget`
--     branches on `isStandardWorkspace(caller.workspaceKind)`, so a burn inside
--     a personal container takes the container path and lands on the owner's
--     standard workspace — the same answer §7 of the spec picks as default (a).
--
-- ── WHAT IS DELIBERATELY *NOT* SEEDED ──────────────────────────────────────
--
-- No starter corpus, no channel, no billing row. A personal container is a
-- SHELF, not a workspace: `seedNewWorkspace` would put the "Getting started"
-- bases on it, which is the one surface that must show only what its owner put
-- there.

-- ===========================================================================
-- 1. The kind set gains a third value
-- ===========================================================================
-- Idempotent by drop-then-add: `20260823150000` created this constraint with
-- two values and there is no ALTER that widens a CHECK in place.
ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_kind_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('standard', 'link', 'personal'));

COMMENT ON COLUMN public.workspaces.kind IS
  'standard = a real user-facing workspace. link = a hidden container minted by a home-channel claim: one channel, N members, never in the rail. personal = the owner''s own shelf, exactly one per user, one member, never in the rail and never a default-resolution candidate; it holds the rows that used to be marked home_scoped.';

-- 🔒 ONE PER OWNER, ENFORCED BY THE DATABASE. The advisory lock below
-- SERIALIZES the mint; this index is what makes a second container
-- UNREPRESENTABLE even if a future code path forgets the function. Partial, so
-- it costs nothing on the standard/link rows.
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_personal_owner_uidx
  ON public.workspaces (owner_id) WHERE kind = 'personal';

-- ===========================================================================
-- 2. `default_workspace_of` — TODAY'S DERIVATION, NAMED ONCE
-- ===========================================================================
-- ⚠ THIS FUNCTION IS BORN DEPRECATED AND THAT IS ITS JOB. It exists so the
-- mint, the backfill and the revert above all read "the default" through ONE
-- expression instead of three hand-copies of a two-branch SELECT — and so that
-- step 3 can delete the concept by dropping ONE function and finding every
-- caller. It mirrors `ensure_default_workspace`'s own SELECT exactly: legacy
-- `slug='default'` first, then oldest owned, STANDARD in both branches.
CREATE OR REPLACE FUNCTION public.default_workspace_of(p_owner_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM public.workspaces
   WHERE owner_id = p_owner_id AND kind = 'standard'
   ORDER BY (slug = 'default') DESC, created_at ASC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.default_workspace_of(uuid) IS
  'DEPRECATED ON ARRIVAL (B11). The one SQL spelling of the DERIVED default workspace, kept only so the personal-container mint and its revert agree. Dropped with the default-workspace concept in 20260923120000.';

-- ===========================================================================
-- 3. `ensure_personal_container` — race-proof SELECT-or-INSERT
-- ===========================================================================
-- Same shape as `ensure_default_workspace` (20260802200000): a per-owner
-- advisory lock around check-then-insert, and a `created` flag telling the
-- caller whether THIS call minted the row. Catch-23505 cannot substitute — the
-- caller needs `created` either way, and the unique index above would surface
-- as an error rather than as an answer.
--
-- ⚠ `p_public_id` IS THE CALLER'S, exactly as `ensure_default_workspace` takes
-- one: public ids are minted by `src/shared/lib/id/public-id.ts` so one
-- generator serves every row in the tree. The backfill below passes a
-- session-local twin of it.
--
-- ⚠ `kind` IS RETURNED HERE AND IS **NOT** RETURNED BY `ensure_default_workspace`
-- — the difference is load-bearing, not cosmetic. `mapWorkspaceRow` reads an
-- ABSENT `kind` as `'standard'` (INVARIANTS §4A), which is right for a function
-- whose every row is standard and WRONG for this one: omitting it would hand
-- the app a personal container labelled `standard`, and `isStandardWorkspace`
-- would then put it in the rail.
CREATE OR REPLACE FUNCTION public.ensure_personal_container(
  p_owner_id uuid,
  p_public_id text
)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  name text,
  slug text,
  public_id text,
  description text,
  icon_url text,
  kind text,
  created_at timestamptz,
  updated_at timestamptz,
  created boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  w public.workspaces%rowtype;
  origin public.workspaces%rowtype;
BEGIN
  -- Serialize per owner. `hashtextextended` gives a stable bigint key; the
  -- constant seed namespaces this lock away from every other advisory use,
  -- including `ensure_default_workspace`'s — the two must not block each other.
  PERFORM pg_advisory_xact_lock(hashtextextended('ensure_personal_container:' || p_owner_id::text, 0));

  SELECT * INTO w FROM public.workspaces
   WHERE workspaces.owner_id = p_owner_id AND workspaces.kind = 'personal'
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT w.id, w.owner_id, w.name, w.slug, w.public_id,
      w.description, w.icon_url, w.kind, w.created_at, w.updated_at, false;
    RETURN;
  END IF;

  -- ⚠ MINTED **FROM** TODAY'S DEFAULT, SO NOTHING IS INVENTED (spec §3): the
  -- NAME and `created_at` are the default workspace's, which is what makes the
  -- revert above exact and keeps account history in one order. A user with no
  -- standard workspace at all (invited-only, or a link claimed before anything
  -- else) has no default to copy and gets the only neutral answer there is.
  SELECT * INTO origin FROM public.workspaces WHERE workspaces.id = public.default_workspace_of(p_owner_id);

  -- ⚠ THE SLUG IS THE ONE FIELD **NOT** COPIED, AND DELIBERATELY SO.
  -- `repository.ts › findMemberWorkspaceBySlug` — the legacy slug-only URL
  -- fallback — answers NULL on 2+ matches among a caller's memberships, so
  -- copying the origin's slug would 404 every legacy URL of the workspace the
  -- container was minted from. A constant is also what the row IS: this
  -- container is never routed to by slug (it has its own surface, `/home`).
  -- ⚠ Slug uniqueness is not enforced anywhere since
  -- `20260504000000_workspaces_public_id.sql` — `public_id` is the unique key —
  -- so one constant across every user is legal, and F-561 records the residual
  -- (a user whose OWN workspace is slugged `personal` makes that legacy
  -- fallback ambiguous, which fails closed to a 404; `kind='link'` containers
  -- have carried the same hazard since 2026-08-23).
  INSERT INTO public.workspaces (owner_id, name, slug, public_id, description, kind, created_at)
    VALUES (
      p_owner_id,
      COALESCE(origin.name, 'Personal'),
      'personal',
      p_public_id,
      NULL,
      'personal',
      COALESCE(origin.created_at, now())
    )
    RETURNING * INTO w;

  -- 🔒 THE OWNER MEMBERSHIP IS NOT OPTIONAL. Every read fence in the tree —
  -- `resolve-resource.ts` clause 2, `is_workspace_member`, every RLS policy
  -- B7 repaired — asks about MEMBERSHIP, not ownership. Without this row the
  -- owner cannot resolve, list or launch anything on their own shelf.
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status, joined_at)
    VALUES (w.id, p_owner_id, 'owner', 'active', now());

  RETURN QUERY SELECT w.id, w.owner_id, w.name, w.slug, w.public_id,
    w.description, w.icon_url, w.kind, w.created_at, w.updated_at, true;
END;
$$;

-- Write model: service role only, restated because `create or replace`
-- preserves grants and a self-contained file is worth three cheap lines.
REVOKE ALL ON FUNCTION public.ensure_personal_container(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.ensure_personal_container(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_personal_container(uuid, text) FROM authenticated;

-- ===========================================================================
-- 4. Backfill — one container per user, THROUGH THE FUNCTION
-- ===========================================================================
-- ⚠ THE BACKFILL IS A LOOP OVER `ensure_personal_container`, NOT A SECOND
-- `INSERT … SELECT`. A hand-written bulk insert is the standard way a backfill
-- and its runtime path drift on the day one of them gains a column; here the
-- 15 rows cost nothing and the mint is provably the same code.
--
-- `pg_temp.gen_public_id_12` is the same 12-char base62 shape
-- `shared/lib/id/public-id.ts` produces, session-local exactly as
-- `20260504000000_workspaces_public_id.sql` used it for the original backfill.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION pg_temp.gen_public_id_12() RETURNS text AS $$
DECLARE
  alphabet text := '0123456789abcdefghijklmnopqrstuvwxyz';
  bytes bytea := gen_random_bytes(12);
  result text := '';
  i int;
BEGIN
  FOR i IN 0..11 LOOP
    result := result || substr(alphabet, (get_byte(bytes, i) % 36) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

DO $$
DECLARE
  u record;
BEGIN
  FOR u IN SELECT id FROM auth.users LOOP
    PERFORM public.ensure_personal_container(u.id, pg_temp.gen_public_id_12());
  END LOOP;
END
$$;

-- ===========================================================================
-- 5. The shelf moves into the container
-- ===========================================================================
-- 🔒 ⚠ **KEYED ON `created_by`, NEVER ON THE WORKSPACE'S OWNER.** A
-- `home_scoped` row is the CREATOR's — that is the whole of the three-part
-- fence `resolveHomeScope` applies (a person's credential, `private`, their own
-- default workspace) — and in a workspace with several members the owner is not
-- always the author. Filing someone's private shelf under another person's
-- container would be the one mistake this migration could make that no read
-- would report.
--
-- ⚠ ROWS WITH A NULL `created_by` ARE LEFT WHERE THEY ARE. There is nobody to
-- give them to, and inventing an owner is worse than leaving a row on the
-- workspace shelf where its `home_scoped` marker still describes it.
--
-- ⚠ NO SLUG/NAME COLLISION IS POSSIBLE. A user's `home_scoped` rows all lived
-- in ONE workspace (their derived default — the fence admitted no other), so
-- they were already unique among themselves under
-- `knowledge_bases (workspace_id, slug)`, and the container they move into is
-- new and empty.
--
-- Idempotent: re-running matches nothing, because the source predicate requires
-- the row to still be OUTSIDE its author's container.
UPDATE public.knowledge_bases k
   SET workspace_id = p.id
  FROM public.workspaces p
 WHERE p.kind = 'personal'
   AND p.owner_id = k.created_by
   AND k.home_scoped IS TRUE
   AND k.workspace_id <> p.id;

UPDATE public.agent_templates t
   SET workspace_id = p.id
  FROM public.workspaces p
 WHERE p.kind = 'personal'
   AND p.owner_id = t.created_by
   AND t.home_scoped IS TRUE
   AND t.workspace_id <> p.id;
