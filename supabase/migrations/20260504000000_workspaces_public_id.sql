-- Workspaces: add `public_id`, the new opaque routing handle.
--
-- URLs become `/{slug}-{public_id}/...`. The slug stays human-readable
-- but is no longer required to be unique — `public_id` is the unique
-- key the route resolver looks up by. Renames now only touch `slug`;
-- old URLs survive because the canonical lookup is publicId-based.
--
-- The 12-char base62 IDs are generated server-side via
-- `src/shared/lib/id/public-id.ts` for new rows. For the backfill
-- we use a temporary plpgsql function so each row gets its own sample.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE workspaces ADD COLUMN public_id text;

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

UPDATE workspaces SET public_id = pg_temp.gen_public_id_12() WHERE public_id IS NULL;

ALTER TABLE workspaces ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX workspaces_public_id_uidx ON workspaces(public_id);

-- Slug uniqueness is now redundant. Drop it so renames + future-feature
-- duplicates don't 23505. The `public_id` index is the new unique key.
ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_slug_unique;
DROP INDEX IF EXISTS workspaces_slug_unique;
