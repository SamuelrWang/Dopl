-- Knowledge bases: add `public_id`, the new opaque routing handle.
--
-- URLs become `/{workspace-segment}/knowledge/{kb-slug}-{kb-public_id}`.
-- The publicId is the URL routing key (stable across renames, immune
-- to enumeration). Slug uniqueness within workspace is preserved here
-- because the MCP `kb_*` tools address bases by slug — keeping that
-- handle unambiguous matters more than the workspace-side simplification.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE knowledge_bases ADD COLUMN public_id text;

CREATE OR REPLACE FUNCTION pg_temp.gen_kb_public_id_12() RETURNS text AS $$
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

UPDATE knowledge_bases SET public_id = pg_temp.gen_kb_public_id_12()
  WHERE public_id IS NULL;

ALTER TABLE knowledge_bases ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX knowledge_bases_public_id_uidx ON knowledge_bases(public_id);
