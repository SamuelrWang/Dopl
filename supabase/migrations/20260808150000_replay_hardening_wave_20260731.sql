-- REPLAY of the 2026-07-31 "bounds / hardening" wave -- objects recorded APPLIED
-- but ABSENT from production. UNAPPLIED. DO NOT run without reading this header.
--
-- -----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--
-- Four migrations from 2026-07-31 have rows in
-- supabase_migrations.schema_migrations -- so `supabase db push` / the dashboard
-- believe they are deployed -- but NONE of their objects exist in production.
-- This was confirmed object-by-object against the live project
-- `mrefkedvdehahjejreae` on 2026-08-08 (read-only introspection of pg_constraint,
-- pg_indexes, pg_proc). The signature -- history row present, object absent -- is
-- what `supabase migration repair --status applied <version>` produces: it
-- inserts the history row WITHOUT executing the SQL. The three FEATURE migrations
-- interleaved with these (...120000 channel_agents, ...130000 channel_task_participants,
-- ...140000 channel_agent_engagement) DID execute and left real objects, which is
-- only possible if the push got PAST the earlier hardening files by marking them
-- applied rather than running them. So the wave was skipped as a group, not
-- blocked by data.
--
-- WHAT WAS FOUND (live DB, 2026-08-08), source migration -> prod reality:
--   20260731090000  profiles_display_name_check          -> ABSENT
--                   handle_new_user() sanitising body     -> prod has the OLD
--                                                            passthrough body
--                                                            (copies raw provider
--                                                            metadata unfiltered)
--   20260731100000  channels_name_check (charset-bounded) -> prod has the LOOSE
--                                                            length-only inline
--                                                            CHECK (1..120) from
--                                                            20260725120000
--                   channels_topic_check                  -> ABSENT
--   20260731110000  14 x *_charset_check                  -> ALL 14 ABSENT
--   20260731150000  DROP channel_agents_engaged_idx       -> index still PRESENT
--
-- DIRTY-DATA PRE-FLIGHT -- the reason a CHECK on a populated table can silently
-- fail to add is a pre-existing violating row. Every bounded column was checked
-- against LIVE data on 2026-08-08, two independent ways: (a) the escape-form
-- regex the constraints use, and (b) a codepoint decomposition that needs no
-- regex class at all (ascii() over each character, numeric ranges). BOTH agree:
--   profiles.display_name .......... 8 rows,  0 violations
--   channels.name / .topic ......... 21 rows, 0 / 0 violations
--   all 14 *_charset_check columns .. 0 violations (0 control, 0 zero-width/bidi,
--                                     0 untrimmed, 0 over-length)
-- So EVERY object below applies CLEANLY today. Nothing is omitted for dirty data.
--
-- A NOTE ON THE CHARACTER CLASS. The zero-width/bidi/separator class is written
-- as backslash-u-XXXX escape sequences, NEVER pasted as literal invisible
-- characters. A literal paste is invisible in review and mangles in transit
-- (it can collapse a range endpoint into an ordinary space and turn the class
-- into "matches any name with a space", reporting whole tables as violating).
-- standard_conforming_strings is `on` on this DB (verified), so the escapes
-- survive the string literal and reach the regex engine intact, and
-- pg_get_constraintdef renders them legibly.
--
-- WHAT THIS FILE DELIBERATELY OMITS
--   * Nothing on data-cleanliness grounds -- all rows are clean (see above).
--   * It does NOT touch supabase_migrations.schema_migrations. The four original
--     history rows stay as they are; this replay carries its own new version
--     (20260808150000). Applying this file makes the OBJECTS real without
--     rewriting history. (If you would rather the originals reflect reality, that
--     is a `migration repair` decision to make separately and deliberately -- do
--     not fold it into a DDL file.)
--   * The jsonb-nested ontology labels and all prose/body/description columns --
--     exactly as the source 20260731110000 omitted them, and for the same reason
--     (they are legitimately multi-line). The one prose exception,
--     workspaces.description, is bounded here exactly as the source bounded it
--     (newline/tab ALLOWED, only true control + invisible chars banned).
--
-- IDEMPOTENT: every statement guards itself (CREATE OR REPLACE, DROP ... IF EXISTS
-- then ADD, DROP INDEX IF EXISTS), so this file is safe to run more than once and
-- safe to run on a database where some of these objects already exist.
--
-- ORDER IS LOAD-BEARING inside the profiles block: the signup trigger is
-- sanitised BEFORE the column CHECK is added, so a future signup whose provider
-- name violates the CHECK cannot abort the auth.users insert.
--
-- NOT APPLIED. This is a repo file only. Review, then apply with the project's
-- normal migration flow when you choose to.
-- -----------------------------------------------------------------------------


-- == From 20260731090000 -- profiles.display_name ============================

-- 1a. Sanitise the signup trigger FIRST (control chars -> space; zero-width / bidi
--     / line-separator dropped; whitespace collapsed; trimmed; clipped to 80;
--     empty -> NULL). CREATE OR REPLACE is idempotent.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name text;
BEGIN
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    ''
  );

  v_name := regexp_replace(v_name, '[[:cntrl:]]', ' ', 'g');
  v_name := regexp_replace(
    v_name,
    '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]',
    '',
    'g'
  );
  v_name := btrim(regexp_replace(v_name, '[[:space:]]+', ' ', 'g'));
  v_name := btrim(left(v_name, 80));

  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(v_name, ''),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$function$;

-- 1b. Never re-introduce a PUBLIC/anon/authenticated EXECUTE grant.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 1c. Then constrain the column.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_display_name_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_display_name_check
  CHECK (
    display_name IS NULL
    OR (
      char_length(display_name) BETWEEN 1 AND 80
      AND display_name = btrim(display_name)
      AND display_name !~ '[[:cntrl:]]'
      AND display_name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );


-- == From 20260731100000 -- channels.name / channels.topic ===================
-- Drops the LOOSE length-only channels_name_check that prod actually carries,
-- and re-adds it charset-bounded (strictly narrower -- no row that passed the
-- loose one can fail the new one), plus the missing channels_topic_check.
ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_name_check;
ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_topic_check;

ALTER TABLE public.channels
  ADD CONSTRAINT channels_name_check
  CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

ALTER TABLE public.channels
  ADD CONSTRAINT channels_topic_check
  CHECK (
    topic = ''
    OR (
      char_length(topic) BETWEEN 1 AND 2000
      AND topic = btrim(topic)
      AND topic !~ '[[:cntrl:]]'
      AND topic !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );


-- == From 20260731110000 -- the 14 short-label charset constraints ============
-- Each is drop-then-add for idempotency. Names are NEW (no collision with the
-- existing length-only chats_title_check / chat_folders_name_check /
-- teams_name_check / skills_folder_len, which are left in place).

-- Highest reach: the workspace directory.
ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_name_charset_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

-- workspaces.description is PROSE: newline and tab are ALLOWED here; only true
-- control chars (minus TAB/LF/CR) and invisible/bidi chars are banned.
ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_description_charset_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_description_charset_check
  CHECK (
    description IS NULL
    OR description = ''
    OR (
      char_length(description) BETWEEN 1 AND 2000
      AND description = btrim(description)
      AND description !~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
      AND description !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

-- Editor-writable tables: the CHECK is the load-bearing layer.
ALTER TABLE public.clusters DROP CONSTRAINT IF EXISTS clusters_name_charset_check;
ALTER TABLE public.clusters
  ADD CONSTRAINT clusters_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

ALTER TABLE public.knowledge_bases DROP CONSTRAINT IF EXISTS knowledge_bases_name_charset_check;
ALTER TABLE public.knowledge_bases
  ADD CONSTRAINT knowledge_bases_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

ALTER TABLE public.skills DROP CONSTRAINT IF EXISTS skills_name_charset_check;
ALTER TABLE public.skills
  ADD CONSTRAINT skills_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

ALTER TABLE public.skills DROP CONSTRAINT IF EXISTS skills_folder_charset_check;
ALTER TABLE public.skills
  ADD CONSTRAINT skills_folder_charset_check
  CHECK (
    folder IS NULL
    OR folder = ''
    OR (
      char_length(folder) BETWEEN 1 AND 80
      AND folder = btrim(folder)
      AND folder !~ '[[:cntrl:]]'
      AND folder !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

ALTER TABLE public.workflows DROP CONSTRAINT IF EXISTS workflows_name_charset_check;
ALTER TABLE public.workflows
  ADD CONSTRAINT workflows_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

-- workflow_steps.title is NOT NULL DEFAULT '' and prod holds untitled steps, so
-- '' stays legal.
ALTER TABLE public.workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_title_charset_check;
ALTER TABLE public.workflow_steps
  ADD CONSTRAINT workflow_steps_title_charset_check
  CHECK (
    title = ''
    OR (
      char_length(title) BETWEEN 1 AND 200
      AND title = btrim(title)
      AND title !~ '[[:cntrl:]]'
      AND title !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_name_charset_check;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 80
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

ALTER TABLE public.ontology_clusters DROP CONSTRAINT IF EXISTS ontology_clusters_name_charset_check;
ALTER TABLE public.ontology_clusters
  ADD CONSTRAINT ontology_clusters_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 200
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

ALTER TABLE public.ontology_objects DROP CONSTRAINT IF EXISTS ontology_objects_name_charset_check;
ALTER TABLE public.ontology_objects
  ADD CONSTRAINT ontology_objects_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 300
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

-- Service-role-only tables: defense in depth.
ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_title_charset_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_title_charset_check
  CHECK (
    char_length(title) BETWEEN 1 AND 200
    AND title = btrim(title)
    AND title !~ '[[:cntrl:]]'
    AND title !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

ALTER TABLE public.chats DROP CONSTRAINT IF EXISTS chats_project_charset_check;
ALTER TABLE public.chats
  ADD CONSTRAINT chats_project_charset_check
  CHECK (
    project IS NULL
    OR (
      char_length(project) BETWEEN 1 AND 120
      AND project = btrim(project)
      AND project !~ '[[:cntrl:]]'
      AND project !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

ALTER TABLE public.chat_folders DROP CONSTRAINT IF EXISTS chat_folders_name_charset_check;
ALTER TABLE public.chat_folders
  ADD CONSTRAINT chat_folders_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 80
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );


-- == From 20260731150000 -- drop the unused partial index =====================
-- COST, not correctness. `channel_agents_engaged_idx` (channel_id, engaged_at)
-- WHERE engaged_at IS NOT NULL serves no query -- every server read of
-- channel_agents filters on id (PK), (channel_id, lower(name)), or channel_id
-- alone. The engagement WRITE path is retired (agents-dto.ts: engaged_by "Never
-- written any more"), so it is not even paying write-amplification now -- it is
-- simply a dead index. Dropping it is safe: no plan, RLS policy, constraint,
-- trigger, or publication depends on it. Independent of every constraint above;
-- omit this one line if you want to land only the security hardening.
DROP INDEX IF EXISTS public.channel_agents_engaged_idx;
