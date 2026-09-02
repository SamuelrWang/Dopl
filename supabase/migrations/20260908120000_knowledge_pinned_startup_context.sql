-- ============================================================================
-- knowledge_bases.pinned / knowledge_entries.pinned — PINNED STARTUP CONTEXT
-- (T81). The user curates a small set of knowledge that is auto-included in
-- every agent session launched in this workspace or container.
--
-- WHAT THIS IS FOR
-- An agent starts every session knowing nothing about the room it landed in,
-- and the operator re-pastes the same three documents by hand. `pinned` is the
-- noun for "always hand this to a new session": the desktop reads
-- `GET /api/knowledge/startup-context` at launch and folds the answer into the
-- spawn prompt. Nothing else changes — a pinned base is an ordinary base, with
-- the same audience it had a second earlier.
--
-- 🔒 IT IS A WORKSPACE-WIDE FACT ON THE ROW, NOT A PER-USER STAR, AND THAT IS
-- THE RULING RATHER THAN A SHORTCUT. `20260812130000_knowledge_base_stars.sql`
-- argues the opposite case for a FAVOURITE: a star belongs to one person, two
-- members see different orders, and nothing about the base changes when
-- somebody stars it — so it is a join table on `auth.users`. A pin is the other
-- shape exactly: it says what the WORKSPACE'S agents start with, every session
-- launched here gets the same answer, and a per-user pin would make one
-- operator's launch context invisible to the member who set it up. Two columns,
-- no join table, no `user_id` anywhere in this file.
--
-- ⚠ `pinned` IS PATCHABLE AND `home_scoped` IS NOT — the difference is the one
-- thing to carry away from this file. `20260831120000_knowledge_base_home_scoped
-- .sql` ships a column that is set at CREATE and never written again, because a
-- shelf move is a TENANCY question (F-342; Samuel's ruling Q8, 2026-08-28) —
-- which workspace a row belongs to, and who can therefore reach it. `pinned`
-- changes no audience, no tenancy and no visibility: it decides only whether an
-- agent is HANDED content that its caller could already read. So it gets two
-- idempotent verbs of its own (`PUT`/`DELETE` on `.../pin`, MCP
-- `dopl_kb(op="pin"|"unpin")`) and is deliberately ABSENT from
-- `features/knowledge/schema.ts › KnowledgeBaseUpdateSchema` and from
-- `server/repository-bases.ts › UpdateBasePatch`: a PATCH arm would be a second
-- door onto one write, with a second gate to keep in step.
--
-- ⚠ THE COLUMN IS NEVER PROJECTED ONTO THE ROW, exactly as `home_scoped` is
-- not. It stays out of `server/dto.ts › KNOWLEDGE_BASE_COLS`,
-- `› KNOWLEDGE_ENTRY_COLS` and `› KNOWLEDGE_ENTRY_META_COLS`, off
-- `KnowledgeBaseRow`/`KnowledgeEntryRow`, and off the `KnowledgeBase` /
-- `KnowledgeEntry` domain types. Postgres filters happily on a column the
-- SELECT omits, and keeping it off the row buys the same three things:
-- `scripts/check-knowledge-type-drift.ts` has nothing new to compare, no cached
-- payload gains a field a pre-deploy bundle reads as `undefined` (INVARIANTS
-- §8), and no client can re-implement the read. The surface that must SHOW a
-- pin gets a SIBLING key on the list response — `pinnedBaseIds` on
-- `GET /api/knowledge/bases`, beside `starredBaseIds` / `homeScopedBaseIds`.
--
-- WHAT ENFORCES IT
-- Writes: `features/knowledge/server/service-pins.ts › pinBase` / `› pinEntry`,
-- both gated through `service-bases.ts › getBaseById` — the foundational lookup
-- that composes M-10 visibility, the teams gate AND the agent audience ceiling.
-- An entry is chased UP to its base first, the way `service-entries.ts ›
-- getEntry` does it, and refuses with the entry's own 404 so "no such entry",
-- "its base is invisible to you" and "its base is outside your audience" stay
-- one answer.
-- Reads: `service-startup-context.ts › getStartupContext` builds its base list
-- through `service-bases.ts › listBases` (post-visibility) and uses THAT id set
-- as the entire fence for the entry read.
--
-- RLS — NO NEW POLICY, AND THE EXISTING ONES ARE ALREADY THE RULE THIS TICKET
-- ASKS FOR. T81 wants "RLS matching the base's visibility", and that is
-- verbatim what is already in force:
--   * `knowledge_bases_member_select` (20260504030000) — workspace viewer AND
--     (`visibility = 'public'` OR `created_by = auth.uid()`).
--   * `knowledge_entries_member_select` (same file) — workspace viewer AND an
--     EXISTS over the PARENT BASE with that same disjunction.
-- A boolean added to those tables inherits both policies the moment it exists;
-- writing a third policy for it would be a second authorization story over one
-- row. **No policy, no grant and no replica identity is touched here**, and the
-- closing `DO $$` block asserts that rather than trusting it.
--
-- REALTIME (§7) — BOTH TABLES ARE PUBLISHED AND THE NEW COLUMN RIDES CDC
-- `knowledge_bases` and `knowledge_entries` are both in `supabase_realtime`
-- (`20260501030000_knowledge_security_hardening.sql`), so a pin flip ships in
-- the UPDATE frames those tables already send, and the flag appears inside
-- them. That is acceptable here and the reasoning is worth stating rather than
-- assuming: the value is a BOOLEAN CURATION FLAG with no PII and no bearing on
-- who may read anything, and a subscriber only receives a frame for a row the
-- SELECT policies above already admit. A subscriber that can see the pin is one
-- that can already read the base. Nothing widens.
--
-- NO INDEX, AND THE REASON IS THE READ SHAPE (the `home_scoped` argument, one
-- table further down)
-- Three queries touch these columns, and an existing partial index already
-- narrows each of them:
--   * `workspace_id = ? AND deleted_at IS NULL AND pinned = true`
--     → `knowledge_bases_workspace_active_idx (workspace_id) WHERE deleted_at
--       IS NULL` — one workspace's live bases, a shelf and not a feed.
--   * `knowledge_base_id IN (…) AND deleted_at IS NULL AND pinned = true`
--     → `knowledge_entries_kb_folder_active_idx (knowledge_base_id, folder_id)
--       WHERE deleted_at IS NULL` — leading column, one base's live entries.
--   * `workspace_id = ? AND id IN (…) AND pinned = true` → the primary key.
-- A boolean has two distinct values, so a composite or partial index over it
-- would be a heap-fetch multiplier the planner would decline anyway.
-- ⚠ THE CONDITION THAT RE-OPENS THIS: a read that asks for pinned rows ACROSS
-- workspaces (no `workspace_id`, no base-id set) — a query that does not exist
-- today and would not use either index above either. That read, not a bigger
-- table, is what would buy `… (workspace_id) WHERE pinned` its statement.
--
-- NO BACKFILL — `DEFAULT FALSE` **IS** THE GUARANTEE
-- Every existing base and entry is unpinned, which is precisely the behaviour
-- that shipped before this file: a startup-context read over a workspace that
-- has pinned nothing returns an empty list and the launch prompt is
-- byte-identical to today's. There is deliberately no `UPDATE` in this file.
-- Choosing what to pin is a product act performed by a person in the app; a
-- migration that hardcoded row ids would not be a schema change, it would be a
-- data edit every future environment replays. ⚠ NOTHING IN THIS FILE NAMES A
-- WORKSPACE, A USER OR A BASE — the feature is user-generic by construction.
--
-- ⚠ REPLAY IS OWED, NOT RUN — this directory's standing gate (§12) is
-- `supabase db reset` → exit 0, and **Docker is unavailable on this machine**,
-- so the local stack cannot start. This file has NOT been applied anywhere.
-- Recording that is the point: deploy state is a measurement, and the repo
-- holds only the claim. Re-derive with `supabase migration list --linked`
-- **joined on the NAME** (`knowledge_pinned_startup_context`, F-304's re-stamp
-- makes the version differ from this filename), then read the VERIFICATION
-- block below back off the catalog.
--
-- ⚠ NEW FILE, ADDITIVE ONLY — it edits no applied migration.
--
-- ROLLBACK (prose, per §12) — SAFE IN EITHER ORDER, NO DATA LOSS THAT MATTERS,
-- AND IT FAILS **CLOSED**.
--   ALTER TABLE knowledge_entries DROP COLUMN IF EXISTS pinned;
--   ALTER TABLE knowledge_bases   DROP COLUMN IF EXISTS pinned;
-- Dropping the columns while the app still reads them makes the startup-context
-- read and the pin writes ERROR (42703, unknown column) rather than widen — the
-- desktop's launch path degrades to "no startup context", which is the
-- pre-feature behaviour, and no content reaches anybody who could not already
-- read it. Rolling the APP back first is the quiet order. ⚠ THE ONE REAL COST
-- is that the curation itself is destroyed: which rows an operator chose lives
-- nowhere else in the schema, so re-applying the migration comes back to an
-- all-`false` table and every pin has to be set again by hand.
-- ============================================================================

ALTER TABLE knowledge_bases
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN knowledge_bases.pinned IS
  'PINNED STARTUP CONTEXT (T81). TRUE = every entry of this base is auto-included in the payload of GET /api/knowledge/startup-context, which the desktop reads when it launches an agent session here. A WORKSPACE-WIDE curation fact, not a per-user favourite (that is knowledge_base_stars). It changes no visibility, no audience and no tenancy — unlike home_scoped it IS patchable, through its own two idempotent verbs (PUT/DELETE .../pin) and never through the base PATCH. Never projected onto the KnowledgeBase row type.';

COMMENT ON COLUMN knowledge_entries.pinned IS
  'PINNED STARTUP CONTEXT (T81), the single-entry half of knowledge_bases.pinned: TRUE = this one entry is auto-included at session launch even when its base is not pinned. De-duplicated against a pinned base''s entries by entry id. Workspace-wide, patchable through PUT/DELETE .../pin only, and never projected onto the KnowledgeEntry row type.';

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- A partially-applied file must RAISE here rather than ship half a feature.
-- Each condition gets its own RAISE naming the CONSEQUENCE, because "something
-- is wrong with pinned" is not a message anybody can act on.
--
-- The three column properties are each load-bearing: BOOLEAN so no read has to
-- interpret a string, NOT NULL so no read has to spell "false OR null", and
-- DEFAULT FALSE because that default IS the no-backfill guarantee above.
--
-- The last three checks assert what this migration did NOT do. An absence is
-- what silently stops being true (`20260812130000`'s `favorited_at` lesson, and
-- `20260907120000`'s replica-identity assertion): losing a replica-identity
-- index stops every UPDATE frame reaching a subscriber, and a policy count that
-- moved would mean somebody wrote the third authorization story this file
-- argues against.
DO $$
DECLARE
  tbl            TEXT;
  peer_col       TEXT;
  col_nullable   BOOLEAN;
  col_default    TEXT;
  col_type       TEXT;
  select_policy  TEXT;
  policy_count   INT;
  identity       "char";
BEGIN
  FOREACH tbl IN ARRAY ARRAY['knowledge_bases', 'knowledge_entries'] LOOP
    -- A column that has been on the table since `20260501000000`, used below as
    -- the yardstick for "no grant was issued here".
    peer_col := CASE tbl WHEN 'knowledge_bases' THEN 'visibility' ELSE 'title' END;

    SELECT (is_nullable = 'YES'), column_default, data_type
      INTO col_nullable, col_default, col_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = tbl
       AND column_name = 'pinned';

    IF col_type IS NULL THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: %.pinned was not created — the startup-context read would 42703 on every launch', tbl;
    END IF;

    IF col_type <> 'boolean' THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: %.pinned is %, expected boolean — a non-boolean pin is a value every read has to interpret', tbl, col_type;
    END IF;

    IF col_nullable THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: %.pinned must be NOT NULL — a NULL pin is a row neither pinned nor unpinned, and every read would have to spell "false OR null"', tbl;
    END IF;

    IF col_default IS NULL OR col_default NOT LIKE 'false%' THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: %.pinned must DEFAULT FALSE — that default IS the no-backfill guarantee, and without it existing rows are pinned by accident (got %)', tbl, COALESCE(col_default, '(none)');
    END IF;

    -- The policy this file leans on instead of writing its own. It must still
    -- gate on the base's visibility, or `pinned` rides a row PostgREST hands
    -- out more widely than the service does.
    SELECT qual INTO select_policy
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = tbl
       AND policyname = tbl || '_member_select';

    IF select_policy IS NULL THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: %_member_select is gone — this migration adds NO policy because that one already matches the base visibility, so its absence means the new column is governed by nothing', tbl;
    END IF;

    IF select_policy NOT LIKE '%visibility%' THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: %_member_select no longer mentions visibility — the "RLS matching the base visibility" this file relies on is not in force', tbl;
    END IF;

    -- Untouched: the policy SET, the replica identity, and the client grants.
    SELECT count(*) INTO policy_count
      FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl;
    IF policy_count <> 4 THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: % carries % policies, expected the 4 it had (select/insert/update/delete) — this migration writes none, so a different number means somebody added a second authorization story for this column', tbl, policy_count;
    END IF;

    SELECT relreplident INTO identity FROM pg_class
     WHERE oid = ('public.' || tbl)::regclass;
    IF identity <> 'i' THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: % replica identity is %, expected i (USING INDEX, 20260807150000) — this migration does not touch it, and losing it stops every UPDATE frame reaching a subscriber', tbl, identity;
    END IF;

    -- ⚠ ASSERTED AS SAMENESS, NOT AS ZERO. A column added by `ALTER TABLE`
    -- inherits the table-wide grant, and `information_schema.column_privileges`
    -- reports that inheritance as a row — so "no rows for pinned" is not a
    -- property this schema can have. What IS assertable is that this migration
    -- issued nothing of its own: `pinned` must be reachable to a client role
    -- EXACTLY as far as the column beside it, no further and no less.
    IF has_column_privilege('authenticated', ('public.' || tbl)::regclass, 'pinned', 'SELECT')
       <> has_column_privilege('authenticated', ('public.' || tbl)::regclass, peer_col, 'SELECT') THEN
      RAISE EXCEPTION 'knowledge_pinned_startup_context: %.pinned is reachable differently from %.% for authenticated — this migration issues no GRANT and no REVOKE, so a difference means a privilege nobody decided to give (or a per-column grant list that forgot the new column)', tbl, tbl, peer_col;
    END IF;
  END LOOP;
END $$;
