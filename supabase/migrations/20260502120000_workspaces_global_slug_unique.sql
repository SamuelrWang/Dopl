-- Workspaces: enforce globally-unique slugs.
--
-- Background: pre-S-4, the unique constraint was (owner_id, slug), so
-- two different users could each own a workspace with slug 'default'
-- (or any other slug). Since the URL is /[workspaceSlug]/..., shared
-- workspaces become ambiguous for any invitee who already owns a
-- workspace with that slug — `findMemberWorkspaceBySlug` resolves to
-- their OWN workspace first, and they can never reach the one they
-- were invited to.
--
-- Fix:
--   1. Backfill colliding slugs: per slug, keep the lex-smallest id
--      (treated as "first") at its original slug; suffix every other
--      with the first 4 hex chars of its id (e.g. 'default-5291').
--      Suffix length picked because UUIDs are random enough that 4
--      hex chars give >65k buckets — collisions in practice are zero.
--   2. Drop the per-owner unique index.
--   3. Add a global unique constraint on slug.
--
-- All FKs are by workspace UUID, so this is a pure URL/slug rewrite —
-- no panel / cluster / membership data moves. Existing bookmarks for
-- collided slugs become stale (acceptable — those URLs were already
-- ambiguous and probably routing to the wrong workspace).

UPDATE workspaces
SET slug = slug || '-' || LEFT(REPLACE(id::text, '-', ''), 4)
WHERE id::text > (
  SELECT MIN(other.id::text)
  FROM workspaces other
  WHERE other.slug = workspaces.slug
);

ALTER TABLE workspaces
  DROP CONSTRAINT IF EXISTS workspaces_owner_slug_unique;
DROP INDEX IF EXISTS workspaces_owner_slug_unique;

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_slug_unique UNIQUE (slug);
