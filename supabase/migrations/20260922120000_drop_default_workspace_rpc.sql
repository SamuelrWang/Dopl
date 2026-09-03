-- THE DERIVED DEFAULT WORKSPACE IS DELETED FROM THE DATABASE (2026-09-02, wave B B14).
--
-- Samuel's ruling B10, in his words: *"We're going to remove that entire logic
-- of a default workspace because the home channel is now the default … there
-- should no longer be any default workspace. The home is the default workspace,
-- so all workspaces are just normal workspaces."*
--
-- ⚠ **WRITTEN, NOT APPLIED. REPLAY HAS NEVER RUN** (Docker has been down for
-- all of wave A and all of wave B). Deploy state is a MEASUREMENT: re-derive
-- with `supabase migration list` / the MCP `list_migrations`, and **JOIN ON THE
-- NAME** — `20260823150000` applied as `20260823205007` and `20260823160000` as
-- `20260823205026`, so a filename prefix is not an applied version
-- (INVARIANTS §12, F-304).
--
-- ── ORDERING, AND IT IS A HARD ONE ─────────────────────────────────────────
--
-- 🔒 **THIS FILE MUST RUN AFTER `20260920120000_workspace_kind_personal.sql`,
-- AND THAT FILE'S OWN F-564 PRECONDITION STILL GATES IT.** Two reasons, and the
-- second is the one that would bite:
--
--   1. `ensure_default_workspace` is what the APP calls today for "the caller's
--      workspace". The code that replaces that call
--      (`workspaces/server/service.ts › ensurePersonalContainer`) reaches
--      `ensure_personal_container`, which `20260920120000` creates. Dropping the
--      old function before that one exists leaves the boot path with neither.
--   2. `default_workspace_of()` is a **LIVE DEPENDENCY** of
--      `ensure_personal_container`, not a leftover: the mint reads it for the
--      NAME and `created_at` it inherits, so nothing about a container is
--      invented. Dropping it out from under that function is a runtime failure
--      on the next mint, not a tidy-up — plpgsql resolves the call when it runs.
--
-- ── WHAT CHANGES ───────────────────────────────────────────────────────────
--
--   §1  `default_workspace_of(uuid)` is REPLACED BY A NAMED SUCCESSOR,
--       `personal_container_origin_of(uuid)` — same body, same one SQL spelling,
--       a name that describes what it actually answers.
--   §2  `ensure_personal_container` is restated to call the successor. ⚠ The
--       ONLY difference from `20260920120000` §3 is that one call; a plpgsql
--       function cannot be patched a line at a time, so `CREATE OR REPLACE` has
--       to carry the whole body (the house pattern — `assert_team_grant_workspace`
--       has a five-migration chain of exactly this shape).
--   §3  `default_workspace_of(uuid)` is DROPPED.
--   §4  `ensure_default_workspace(uuid, text, text, text)` is DROPPED — and its
--       KIND GUARD goes with it, because the guard IS that function's body
--       (`20260823160000` is a `CREATE OR REPLACE` of it, not a separate
--       object). ⚠ Nothing is lost: the guard existed only to stop a
--       `kind='link'` container becoming somebody's default, and with no default
--       it has nothing to guard.
--
-- ── WHY THE HELPER IS RENAMED RATHER THAN INLINED ──────────────────────────
--
-- F-560 records that `20260920120000`'s revert is EXACT precisely because the
-- mint and the revert read "where this container came from" through ONE
-- expression. Inlining would have deleted that property to save a name. What is
-- deleted instead is the CONCEPT: this successor does not answer "the default
-- workspace" — it answers "the standard workspace a personal container inherits
-- its name and creation date from", which is a question about provenance and
-- has exactly one caller.
--
-- ⚠ **`20260920120000`'s HEADER REVERT BLOCK STILL NAMES `default_workspace_of`,
-- AND IT IS A COMMENT, NOT CODE.** An operator reverting B11 after this file has
-- run substitutes `public.personal_container_origin_of` in the two `UPDATE`s;
-- the shape is unchanged. Recorded here rather than by editing another slice's
-- migration (F-630).
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────
--
-- Re-create both dropped functions from `20260802200000` / `20260823160000`
-- (the latter is the live body) and `20260920120000` §2, then restate
-- `ensure_personal_container` calling `default_workspace_of` again. Nothing here
-- touches a ROW, so a revert loses no data — which is the whole reason the
-- concept could be deleted for free: **there is no `is_default` column anywhere
-- in the tree** (verified across `*.sql`, `*.ts`, `*.tsx`; wave-B spec §1.1).
--
-- Idempotent throughout: `CREATE OR REPLACE` + `DROP … IF EXISTS`.

-- ===========================================================================
-- 1. `personal_container_origin_of` — the successor, same body
-- ===========================================================================
-- Verbatim from `20260920120000` §2 apart from the name and the comment: legacy
-- `slug='default'` first, then oldest owned, STANDARD in both branches.
--
-- ⚠ THE `slug = 'default'` TIE-BREAK SURVIVES **HERE AND NOWHERE ELSE**, and
-- that is deliberate. It is not a rule any more — the TypeScript side dropped it
-- with `findDefaultWorkspaceForUser` — it is a fact about which row 2026's
-- accounts were minted from, and changing it now would change which workspace a
-- container inherits its name from between one apply and the next.
CREATE OR REPLACE FUNCTION public.personal_container_origin_of(p_owner_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM public.workspaces
   WHERE owner_id = p_owner_id AND kind = 'standard'
   ORDER BY (slug = 'default') DESC, created_at ASC
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.personal_container_origin_of(uuid) IS
  'The standard workspace a personal container inherits its NAME and created_at from, so nothing about the container is invented (B11). One caller: ensure_personal_container. Successor to default_workspace_of, dropped with the default-workspace concept in 20260922120000 (ruling B10).';

-- ===========================================================================
-- 2. `ensure_personal_container` — restated against the successor
-- ===========================================================================
-- ⚠ ONE LINE DIFFERS from `20260920120000` §3 (the `SELECT … INTO origin`).
-- Everything else — the signature, the advisory-lock key, the returned `kind`,
-- the owner membership, the constant slug — is byte-identical, and each of those
-- decisions is argued in that file rather than re-argued here.
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
  PERFORM pg_advisory_xact_lock(hashtextextended('ensure_personal_container:' || p_owner_id::text, 0));

  SELECT * INTO w FROM public.workspaces
   WHERE workspaces.owner_id = p_owner_id AND workspaces.kind = 'personal'
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT w.id, w.owner_id, w.name, w.slug, w.public_id,
      w.description, w.icon_url, w.kind, w.created_at, w.updated_at, false;
    RETURN;
  END IF;

  SELECT * INTO origin FROM public.workspaces WHERE workspaces.id = public.personal_container_origin_of(p_owner_id);

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
-- 3. The concept's two remaining objects
-- ===========================================================================
-- ⚠ NOT `CASCADE`. Nothing may depend on either of these by the time this runs
-- — §2 above is what makes that true for the first — and a `CASCADE` here would
-- silently take whatever a future migration had hung off them. A dependency
-- failing this DROP is the correct outcome: it is a caller nobody moved.
DROP FUNCTION IF EXISTS public.default_workspace_of(uuid);

-- The RPC, and with it `20260823160000`'s kind guard, which is this function's
-- body and has no separate object to drop.
DROP FUNCTION IF EXISTS public.ensure_default_workspace(uuid, text, text, text);
