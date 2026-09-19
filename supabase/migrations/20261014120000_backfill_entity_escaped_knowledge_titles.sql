-- ============================================================================
-- BACKFILL ENTITY-ESCAPED KNOWLEDGE TITLES / NAMES — `R&amp;D` → `R&D` (S35)
-- ============================================================================
--
-- ⚠ **WRITTEN, NOT APPLIED** — this directory's standing gate; replay is OWED
-- and recorded rather than glossed (Docker is unavailable on this machine, so
-- `supabase db reset` cannot start; CI's `rls-redteam` job is the replay).
--
-- 🔒 **APPLY IT BY NAME (`backfill_entity_escaped_knowledge_titles`), NEVER BY
-- FILENAME VERSION** — F-304's re-stamp (INVARIANTS §12). Deploy state is a
-- MEASUREMENT (CLAUDE.md doc rule 4): re-derive with `supabase migration list` /
-- MCP `list_migrations`, JOINED ON THE NAME.
--
-- **APPLY ORDER: after `drop_knowledge_soft_delete` (`20261013120000`)**, the
-- highest filename version in this directory at write time. It depends on
-- nothing structural — it writes three `text` columns and creates and drops one
-- helper function — and nothing depends on it.
--
-- ── WHAT WENT WRONG, AND WHERE IT DID NOT ──────────────────────────────────
--
-- ⚠ **NOTHING IN THE APPLICATION EVER ESCAPED A TITLE.** Titles and names ride
-- RAW from the client to the column and back out again. Re-derive rather than
-- trust this line — the single hit is a renderer, not a writer:
--
--   grep -rn --include='*.ts' --include='*.tsx' 'escapeHtml' src packages apps
--   -- one match: src/features/search/server/snippet.ts (search popup markup)
--
-- So every escaped row was escaped by whatever WROTE it — a client that read
-- `innerHTML`, an agent that pasted rendered HTML — and it landed with **no
-- signal of any kind**: the row is valid, `NAME_RE` passes (an entity is plain
-- ASCII), and every surface has printed `R&amp;D` ever since.
--
-- The write side is fixed in the same change:
-- `src/features/knowledge/schema.ts › decodeHtmlEntities`, applied through
-- `› decodedLabel` BEFORE the charset and length rules on the entry title, the
-- folder name and the base name. This file is the rows that predate it.
--
-- ⚠ **ONE RESIDUE IS LEFT ON PURPOSE AND IT IS NOT A MISS.** An entry written
-- with no `title` takes its title from the path LEAF
-- (`server/service-paths.ts › writeFileByPath`), and a path is an ADDRESS:
-- decoding it would create `R&D` under a path `resolvePath` then matches
-- byte-for-byte against stored titles and fails. Those rows arrive escaped
-- until the caller passes a real `title`, which is why the MCP read path also
-- carries a live signal (`packages/mcp-server/src/tools/knowledge-entity-titles.ts
-- › escapedTitleLine`) rather than treating this one-shot backfill as the end
-- of the story.
--
-- ── THE DECODE IS ONE PASS, AND THAT IS A CORRECTNESS RULE ──────────────────
--
-- 🔴 **NEVER `replace(replace(col,'&amp;','&'),'&lt;','<')` AND NEVER A LOOP.**
-- Nested/global replaces re-scan their own output: `&amp;lt;` becomes `&lt;` on
-- the first call and `<` on the second, so a title a user typed on purpose is
-- rewritten into a different one, and no later read can tell. The helper below
-- scans strictly left to right, consuming each match and never re-examining
-- what it emitted — the same rule, the same reason, as the TypeScript
-- normalizer, which relies on `String.replace` not re-scanning substitutions.
--
-- The entity set is the normalizer's, term for term: `&amp; &lt; &gt; &quot;
-- &apos;` plus decimal `&#NN;` and hex `&#xNN;`. A code point that is zero, a
-- lone surrogate, or above U+10FFFF is LEFT AS WRITTEN — `chr()` raises on the
-- first two, and a failed migration over a malformed entity in one title would
-- be a far worse answer than the title.
--
-- ── ⚠ A COLLIDING DECODE IS SKIPPED, NOT FORCED ────────────────────────────
--
-- `knowledge_entries_unique_active (knowledge_base_id, folder_id, title)` and
-- `knowledge_folders_unique_active (knowledge_base_id, parent_id, name)` are
-- PARTIAL UNIQUE indexes (`20260501010000_api_keys_workspace_scoping_and_kb_unique.sql`).
-- A base holding both `R&amp;D` and `R&D` in one folder is a legitimate state,
-- and decoding the first would collide with the second — a `23505` that rolls
-- the whole statement back and reverts every other row this file fixed. The
-- UPDATEs therefore exclude any row whose decoded value already exists among its
-- siblings, and §4 RAISEs a NOTICE naming what it left behind. **A skipped row
-- is not a failure**: it is two entries a human has to merge, it still reads
-- correctly, and the MCP read signal keeps pointing at it.
--
-- `knowledge_bases.name` carries NO unique index (the slug does, and slugs are
-- not touched here), so its UPDATE needs no such guard.
--
-- ── ROLLBACK — PROSE, NOT COMMENTED-OUT SQL ────────────────────────────────
--
-- (`dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this
-- directory WITHOUT stripping comments, so a commented-out DDL block is read as
-- if it were live.)
--
-- 🔴 **THERE IS NO MECHANICAL REVERT, AND PRETENDING OTHERWISE IS THE TRAP.**
-- Re-encoding `&` → `&amp;` would also escape every ampersand that was always a
-- plain ampersand, which is most of them. If a row here was decoded wrongly, fix
-- THAT ROW — `UPDATE … SET title = '…' WHERE id = '…'` — from the `revisions`
-- history or from the operator. No object is created that outlives this file:
-- the helper function is dropped in §5.

-- ── 1. The helper, created and dropped inside this file ────────────────────
-- ⚠ IT IS NOT PART OF THE SCHEMA. Nothing outside this migration may call it,
-- and §5 removes it — a decoder living permanently in the database would be a
-- second opinion about what an entity is, competing with the TypeScript one
-- that actually guards writes.
-- 🔒 `search_path = ''` per this directory's standing rule: the body names only
-- `pg_catalog` builtins, which stay reachable regardless.
CREATE OR REPLACE FUNCTION public.dopl_decode_entities_once(value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  -- Everything already emitted; never re-examined. This is the one-pass rule.
  done TEXT := '';
  rest TEXT := value;
  hit  TEXT[];
  whole TEXT;
  at   INT;
  cp   INT;
  sub  TEXT;
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;
  LOOP
    -- Capture groups: 1 = decimal digits, 2 = hex digits, 3 = named form.
    hit := regexp_match(
      rest,
      '&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));'
    );
    EXIT WHEN hit IS NULL;

    -- ⚠ The same pattern WITHOUT groups gives the matched text itself, and
    -- `position` then finds it at the match site: an earlier occurrence of that
    -- literal would itself have been the leftmost match.
    whole := substring(
      rest from '&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos);'
    );
    at := position(whole in rest);

    IF hit[3] IS NOT NULL THEN
      sub := CASE hit[3]
               WHEN 'amp'  THEN '&'
               WHEN 'lt'   THEN '<'
               WHEN 'gt'   THEN '>'
               WHEN 'quot' THEN '"'
               ELSE ''''
             END;
    ELSE
      IF hit[1] IS NOT NULL THEN
        cp := hit[1]::INT;
      ELSE
        -- Hex → INT without a cast that Postgres does not have.
        cp := ('x' || lpad(hit[2], 8, '0'))::BIT(32)::INT;
      END IF;
      -- ⚠ ZERO, LONE SURROGATES AND ANYTHING ABOVE U+10FFFF SURVIVE VERBATIM.
      IF cp < 1 OR cp > 1114111 OR (cp >= 55296 AND cp <= 57343) THEN
        sub := whole;
      ELSE
        sub := chr(cp);
      END IF;
    END IF;

    done := done || left(rest, at - 1) || sub;
    rest := substring(rest from at + length(whole));
  END LOOP;
  RETURN done || rest;
END;
$fn$;

-- ── 2. Entry titles ────────────────────────────────────────────────────────
-- ⚠ THE `WHERE` IS THE SAME DETECTION CLASS AS THE TYPESCRIPT PREDICATE, so a
-- row this file skips is a row the MCP read path does not flag either.
UPDATE public.knowledge_entries AS e
   SET title = public.dopl_decode_entities_once(e.title)
 WHERE e.title ~ '&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});'
   AND public.dopl_decode_entities_once(e.title) <> e.title
   -- 🔒 The collision guard. NULLS NOT DISTINCT on the index, hence
   -- `IS NOT DISTINCT FROM` on the nullable `folder_id` rather than `=`.
   AND NOT EXISTS (
     SELECT 1 FROM public.knowledge_entries AS sib
      WHERE sib.knowledge_base_id = e.knowledge_base_id
        AND sib.folder_id IS NOT DISTINCT FROM e.folder_id
        AND sib.id <> e.id
        AND sib.title = public.dopl_decode_entities_once(e.title)
   );

-- ── 3. Folder names, then base names ───────────────────────────────────────
UPDATE public.knowledge_folders AS f
   SET name = public.dopl_decode_entities_once(f.name)
 WHERE f.name ~ '&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});'
   AND public.dopl_decode_entities_once(f.name) <> f.name
   AND NOT EXISTS (
     SELECT 1 FROM public.knowledge_folders AS sib
      WHERE sib.knowledge_base_id = f.knowledge_base_id
        AND sib.parent_id IS NOT DISTINCT FROM f.parent_id
        AND sib.id <> f.id
        AND sib.name = public.dopl_decode_entities_once(f.name)
   );

-- ⚠ NO GUARD HERE, AND THAT IS CHECKED, NOT ASSUMED: the unique index on this
-- table is `knowledge_bases_workspace_slug_active_unique`, over the SLUG, which
-- this file never touches. Re-derive:
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'knowledge_bases' AND indexdef LIKE '%UNIQUE%';
UPDATE public.knowledge_bases AS b
   SET name = public.dopl_decode_entities_once(b.name)
 WHERE b.name ~ '&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});'
   AND public.dopl_decode_entities_once(b.name) <> b.name;

-- ── 4. Report what was deliberately left behind (INVARIANTS §12) ───────────
-- ⚠ A NOTICE, NEVER AN EXCEPTION. A collision is a human merge, not a broken
-- migration, and failing here would revert every row §2 and §3 just fixed.
DO $$
DECLARE
  stuck INT;
BEGIN
  SELECT count(*) INTO stuck
    FROM public.knowledge_entries e
   WHERE e.title ~ '&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});';
  IF stuck > 0 THEN
    RAISE NOTICE
      'entity-escaped entry titles left: % (decode would collide with a sibling, or the entity is malformed) — list them with the SELECT in this file''s header',
      stuck;
  END IF;

  SELECT count(*) INTO stuck
    FROM public.knowledge_folders f
   WHERE f.name ~ '&(amp|lt|gt|quot|apos|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});';
  IF stuck > 0 THEN
    RAISE NOTICE 'entity-escaped folder names left: %', stuck;
  END IF;

  -- 🔒 THE SURVIVOR IS ASSERTED TOO, or "the helper ran" is a pass this file
  -- would also get by decoding nothing at all.
  IF public.dopl_decode_entities_once('a&amp;b&amp;lt;c') <> 'a&b&lt;c' THEN
    RAISE EXCEPTION 'decoder is not single-pass — it re-scanned its own output';
  END IF;
END $$;

-- ── 5. The helper leaves with the migration ────────────────────────────────
-- ⚠ ARGUMENT TYPES ARE PART OF THE NAME; a `DROP FUNCTION IF EXISTS` with the
-- wrong signature is a silent no-op, not an error.
DROP FUNCTION IF EXISTS public.dopl_decode_entities_once(TEXT);
