-- Skills: add `public_id`, the new opaque routing handle.
--
-- URLs become `/{workspace-segment}/skills/{slug}-{public_id}`. PublicId
-- is the URL routing key (stable across renames, immune to enumeration).
-- Slug uniqueness within workspace is preserved — MCP `skill_*` tools
-- address skills by slug and that handle must stay unambiguous.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE skills ADD COLUMN public_id text;

CREATE OR REPLACE FUNCTION pg_temp.gen_skill_public_id_12() RETURNS text AS $$
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

UPDATE skills SET public_id = pg_temp.gen_skill_public_id_12()
  WHERE public_id IS NULL;

ALTER TABLE skills ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX skills_public_id_uidx ON skills(public_id);
