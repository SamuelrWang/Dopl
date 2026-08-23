-- `agent_templates` + `agent_template_teams` + `agent_template_knowledge_bases`
-- — PERSISTENT AGENT IDENTITIES (Samuel's spec, 2026-08-22).
--
-- ⚠️ WRITTEN, NOT APPLIED (Samuel's standing gate on this directory).
--
-- ── WHAT IT IS ─────────────────────────────────────────────────────────────
-- A SESSION IS EPHEMERAL; THE TEMPLATE IS THE DURABLE THING. One row = one
-- named, reusable agent identity: a name, an optional description, a free-text
-- INSTRUCTIONS block (system-prompt shaped), an optional default MODEL, a
-- user-defined `fields` array, and a set of attached knowledge bases held BY
-- REFERENCE. Spawning an agent from one is a LATER phase by another builder;
-- what ships here is storage + the read/write surface + the flattened
-- launch-resolution payload that phase consumes.
--
-- ── THE TEAM-LINKAGE SHAPE: WHAT WAS FOUND, AND WHAT IS MIRRORED ──────────
-- The brief allowed either `team_id` FK or a join table, and said to mirror
-- whatever the shipped features do. **They use a JOIN TABLE, not a column**:
-- `team_resource_access` (`20260611020000_teams.sql`), polymorphic over
-- `resource_type`, extended to `'chat'`/`'chat_folder'` by
-- `20260707210000_chat_team_sharing.sql` and to `'skill'` by
-- `20260708150001_skill_team_sharing.sql`. So the linkage here is a JOIN TABLE
-- and team visibility is MANY-teams, exactly as skills/chats/KBs are — a
-- nullable `team_id` would have been a NARROWER model than the one the product
-- already ships.
--
-- ⚠ IT IS A DEDICATED JOIN TABLE (`agent_template_teams`), NOT A FIFTH
-- `resource_type` ON `team_resource_access`, AND THAT IS A DELIBERATE
-- DIVERGENCE WORTH READING BEFORE ANYONE "FIXES" IT (filed as F-277):
--   1. `team_resource_access` carries a `level` ('read' | 'edit'). Agent
--      templates have no edit-grant concept — team visibility is READ, and
--      writes are creator-or-workspace-admin, full stop. A `level` column that
--      is always `'read'` is a field that will eventually be believed.
--   2. Joining that table means widening
--      `src/features/teams/access-levels.ts › TeamResourceType`, and that union
--      is not a type — it is a CONTRACT with four consumers outside this lane:
--      `teams/server/repository-resources.ts › RESOURCE_TABLES` (a
--      `satisfies Record<TeamResourceType, …>` that assumes every member has an
--      `access_mode` column — this table has `visibility` instead),
--      `listTeamsModeResources` (feeds the `my-access` payload the SPA caches),
--      `members/components/member-bits.tsx › RESOURCE_META` (a
--      `Record<TeamResourceType, …>` of labels + icons), and the hand-copied
--      mirror in `packages/mcp-server/src/tools/members-render.ts`. A grant row
--      of an unmodelled type reaching the members access matrix renders through
--      an undefined lookup.
--   THE SHAPE IS MIRRORED; THE POLYMORPHIC TABLE IS NOT REUSED. Same PK shape,
--   same `teams(id) ON DELETE CASCADE`, same denormalized `workspace_id`, same
--   `team_members`-join RLS predicate. If the members surface later learns to
--   render agent templates, folding this table into `team_resource_access` is a
--   mechanical migration and F-277 is where the argument is recorded.
--
-- ── VISIBILITY IS ONE COLUMN, NOT TWO ─────────────────────────────────────
-- Skills/chats/KBs spell the three-way scope as a PAIR — `visibility`
-- ('public'|'private') × `access_mode` ('workspace'|'teams') — and every one of
-- those migrations says why: `access_mode` was ADDED to a live table and
-- `DEFAULT 'workspace'` was the BACKFILL ("nothing changes visibility until an
-- admin explicitly scopes a resource", `20260611020000`). There is nothing to
-- backfill here. The repo's own derived answer is already the three-value form
-- — `src/features/skills/scope.ts › skillScope` collapses the pair back to
-- `'private' | 'team' | 'workspace'` — so this table stores what that helper
-- computes. **A reader porting a predicate from the skills service must
-- translate: `visibility='team'` here == `visibility='public' AND
-- access_mode='teams'` there.**
--
-- ── `fields`: SHAPE IN ZOD, SIZE IN SQL ───────────────────────────────────
-- `fields` is an ARRAY of `{key, value}` string pairs. The per-element shape is
-- validated in `src/features/agent-templates/schema.ts`, NOT here: a jsonb
-- element walk on every write is the cost `20260731110000` declined to pay for
-- the ontology labels, and this table is service-role-write-only, so the
-- service IS the fence (there is no editor-writable path a zod-only bound could
-- leave open). What SQL owns is the DoS bound the service cannot be trusted to
-- re-derive: total serialized size ≤ 8 KB.
--
-- ── HARD DELETE, NO TOMBSTONE (Samuel's standing ruling) ──────────────────
-- No `deleted_at`. A delete is a `DELETE`, and both junctions go with it via
-- `ON DELETE CASCADE` — including the team grants, which is the one thing the
-- `team_resource_access` model needed an AFTER DELETE trigger for
-- (`drop_skill_grants`, `20260708150001`). A real FK does it here.
--
-- ── REALTIME: NOT PUBLISHED, DELIBERATELY ─────────────────────────────────
-- §7's rule is that a published table with no subscriber costs WAL decode plus
-- a per-subscription RLS evaluation on every write, forever, and that the
-- decision is written down where the table is created. **The answer is NO.**
-- A template is edited by one person in a form and read at spawn time by a
-- desktop that is already making an HTTP request; there is no peer event to
-- deliver and no live surface to keep warm. This is the same answer
-- `channel_mention_reads` (`20260818140000`) got, for the same reason. It also
-- follows that these tables need no `workspace_id`-bearing replica identity —
-- that requirement exists only to make DELETE frames deliverable, and there are
-- no frames. `dopl-desktop-app/test/ui-sync-tables.test.mjs` pins the
-- publication inventory in BOTH directions, so publishing this table without a
-- subscriber fails on purpose.
--
-- ── RLS: SELECT ONLY. EVERY WRITE IS SERVICE-ROLE ────────────────────────
-- INSERT/UPDATE/DELETE are REVOKEd from `authenticated`/`anon` and there is no
-- write policy on any of the three tables. The service layer is the fence: it
-- stamps `created_by`, gates create/update/delete to creator-or-workspace-admin
-- and validates every KB attachment against what the CALLER can read. A write
-- policy would be a second, weaker statement of the same rule — and the KB
-- attach check (which reads a DIFFERENT table's visibility) cannot be expressed
-- as one at all.
--
-- ⚠ THE SELECT POLICY AND THE SERVICE'S `canSeeTemplate` ARE THE SAME MATRIX,
-- AND KEEPING THEM THE SAME IS THE POINT. `20260716150000_chats_team_aware_rls.sql`
-- exists because they had drifted for chats: the original policy let ANY member
-- read a team-scoped row through PostgREST/realtime, bypassing the service gate.
-- One arm here is deliberately TIGHTER than that file's — workspace admins get a
-- read of `team` templates (they administer sharing) and NOT of other people's
-- `private` ones. Argued at the policy itself.
--
-- ⚠ THE JUNCTION POLICIES RESTATE THE PARENT PREDICATE, THEY DO NOT NEST IT.
-- A junction row is readable exactly when its template is, and the predicate is
-- written out again rather than deferred to `agent_templates`' own RLS via a
-- bare `EXISTS (SELECT 1 FROM agent_templates …)`: a policy expression runs as the
-- TABLE OWNER, so a subquery on a sibling table does not re-apply that table's
-- RLS, and the nested form would silently be a no-op fence.
-- `chat_messages_select` restates for the same reason.
--
-- ── VERIFICATION (AFTER APPLYING) ─────────────────────────────────────────
--   -- 1. Three tables, SELECT policies only:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' AND tablename LIKE 'agent_template%';
--   -- 2. NOT published (expect zero rows):
--   SELECT * FROM pg_publication_tables WHERE tablename LIKE 'agent_template%';
--   -- 3. THE BEHAVIOUR, which the catalog cannot confirm: a member of a granted
--   --    team sees a 'team' template through PostgREST; a member of no granted
--   --    team does not; and neither can UPDATE one.
--
-- ── ROLLBACK ──────────────────────────────────────────────────────────────
--   -- In a NEW migration:
--   --   DROP TABLE public.agent_template_knowledge_bases;
--   --   DROP TABLE public.agent_template_teams;
--   --   DROP TABLE public.agent_templates;
--   -- Written as prose rather than commented-out SQL because
--   -- `dopl-desktop-app/test/ui-sync-replica-identity.test.mjs` regexes this
--   -- directory WITHOUT stripping comments.

-- ===========================================================================
-- 1. agent_templates
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.agent_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- ⚠ SET NULL, not CASCADE, matching `skills.created_by` /
  -- `knowledge_bases.created_by`: a departing member must not take the team's
  -- shared templates with them. The consequence is stated so nobody reads it as
  -- a bug — a `private` template whose creator is gone becomes visible to
  -- workspace ADMINS only (the `created_by = auth.uid()` arm can never match a
  -- NULL), which is the fail-closed direction.
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  -- The system-prompt-shaped block. PROSE, not a label — deliberately
  -- unbounded in charset beyond the NUL/zero-width class below, and multi-line
  -- by definition. Same argument `skills.description` / `when_to_use` carry.
  instructions  TEXT,
  -- Model identifier the desktop passes through at spawn. Free text on purpose:
  -- the model roster lives in the desktop and moves faster than a migration.
  model         TEXT,
  -- ARRAY of {key, value} string pairs. Shape in zod; size below.
  fields        JSONB NOT NULL DEFAULT '[]'::jsonb,
  visibility    TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private', 'team', 'workspace')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Bounds ────────────────────────────────────────────────────────────────
-- `name` is a SHORT LABEL in the sense of `src/shared/lib/safe-label.ts`: it is
-- spliced into lines the server writes (the launch payload an agent reads, the
-- template picker). The four clauses are exactly `20260731110000`'s shape —
-- length, already-trimmed, C0+DEL, zero-width/bidi/line-separator.
ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_name_charset_check
  CHECK (
    char_length(name) BETWEEN 1 AND 120
    AND name = btrim(name)
    AND name !~ '[[:cntrl:]]'
    AND name !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
  );

-- `model` is a short label too — it is rendered into the launch payload and
-- into desktop UI. Nullable, and '' is not legal (the service normalizes a
-- cleared field to NULL, so an empty string reaching here is a service bug and
-- should fail loudly rather than become a model named "").
ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_model_charset_check
  CHECK (
    model IS NULL
    OR (
      char_length(model) BETWEEN 1 AND 120
      AND model = btrim(model)
      AND model !~ '[[:cntrl:]]'
      AND model !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
    )
  );

-- `description` and `instructions` are PROSE: newline and tab are ALLOWED, the
-- rest of the control block is not. Same clause `workspaces.description` uses.
-- '' is legal for both — a form that clears the textarea sends the empty field.
ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_prose_charset_check
  CHECK (
    (
      description IS NULL
      OR description = ''
      OR (
        char_length(description) <= 2000
        AND description !~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
        AND description !~ '[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]'
      )
    )
    AND (
      instructions IS NULL
      OR instructions = ''
      OR (
        -- 32 KB. The instructions block is a system prompt, not a document —
        -- `skills.body` is the place for a procedure and it has its own 1 MB
        -- bound. This is a DoS floor, not a style rule.
        char_length(instructions) <= 32768
        AND instructions !~ E'[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]'
      )
    )
  );

-- ⚠ SIZE ONLY, AND `jsonb` IS NOT `text`. `octet_length(fields::text)` measures
-- the SERIALIZED form the API round-trips, which is the number the 8 KB bound
-- is about; `pg_column_size` would measure the compressed on-disk form and
-- would let a highly-compressible 400 KB payload through. Top-level
-- array-ness IS asserted here because it is one cheap type test and the column
-- default depends on it — everything below that (element shape, key/value
-- types, per-key length) is zod's, per the header.
ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_fields_shape_check
  CHECK (
    jsonb_typeof(fields) = 'array'
    AND octet_length(fields::text) <= 8192
  );

-- ── Indexes: one per named statement, and an FK cascade counts as one ─────
-- THE LIST READ: "templates in this workspace", ordered by name. Every list
-- endpoint and the launch picker issue exactly this.
CREATE INDEX IF NOT EXISTS agent_templates_workspace_name_idx
  ON public.agent_templates (workspace_id, name);

-- FK cover for `auth.users(id) ON DELETE SET NULL`, and the "my private
-- templates" arm of the SELECT policy. Leading `created_by` is what the user
-- delete needs; `workspace_id` second keeps the policy arm covered too.
CREATE INDEX IF NOT EXISTS agent_templates_creator_idx
  ON public.agent_templates (created_by, workspace_id);

-- ⚠ NO UNIQUE INDEX ON `name`, AND THAT IS A MIRROR, NOT AN OVERSIGHT.
-- `skills` is unique on `(workspace_id, slug) WHERE deleted_at IS NULL`
-- (`20260501090000`) and has NO name constraint; `knowledge_bases` likewise.
-- `teams` IS unique on `(workspace_id, lower(name))` — but a team is a
-- directory entry every member must address unambiguously, and a template is
-- not: two people may each keep a private "Researcher" and neither can see the
-- other's. Uniqueness across a visibility boundary would leak the existence of
-- a private row through a conflict error. Templates carry no slug, so there is
-- nothing else to make unique.

-- Reuse the generic updated_at trigger (`touch_knowledge_updated_at`, defined
-- in `20260501000000_knowledge_bases.sql`; its body is `NEW.updated_at :=
-- now()` and the name is historical). §12: `updated_at` is stamped by a
-- TRIGGER, not by the writer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'agent_templates_touch_updated_at'
  ) THEN
    CREATE TRIGGER agent_templates_touch_updated_at
      BEFORE UPDATE ON public.agent_templates
      FOR EACH ROW EXECUTE FUNCTION touch_knowledge_updated_at();
  END IF;
END $$;

-- ===========================================================================
-- 2. agent_template_teams — the 'team' visibility linkage
-- ===========================================================================
-- Shape mirrored from `team_resource_access` (composite PK, `teams(id)`
-- CASCADE, denormalized `workspace_id`) minus the polymorphic `resource_type`
-- and the `level` — see the header for why the polymorphic table is not
-- reused. Rows are inert while `visibility <> 'team'`: the SELECT policy joins
-- them only on that arm, and the service replaces the whole set on a
-- visibility write.

CREATE TABLE IF NOT EXISTS public.agent_template_teams (
  template_id   UUID NOT NULL REFERENCES public.agent_templates(id) ON DELETE CASCADE,
  team_id       UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  granted_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, team_id)
);

-- FK cover: `teams(id) ON DELETE CASCADE`. Also the RLS join's driving side.
CREATE INDEX IF NOT EXISTS agent_template_teams_team_idx
  ON public.agent_template_teams (workspace_id, team_id);

-- FK cover: `workspaces(id) ON DELETE CASCADE`.
CREATE INDEX IF NOT EXISTS agent_template_teams_workspace_idx
  ON public.agent_template_teams (workspace_id);

-- FK cover: `auth.users(id) ON DELETE SET NULL`.
CREATE INDEX IF NOT EXISTS agent_template_teams_granted_by_idx
  ON public.agent_template_teams (granted_by);

-- Consistency backstop, same pattern and same failure messages as
-- `assert_team_grant_workspace` (`20260611020000`): a grant may not point a
-- team at a template in another workspace, and the junction's denormalized
-- `workspace_id` must agree with both.
CREATE OR REPLACE FUNCTION public.assert_agent_template_team_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE team_ws UUID; tpl_ws UUID;
BEGIN
  SELECT workspace_id INTO team_ws FROM teams WHERE id = NEW.team_id;
  SELECT workspace_id INTO tpl_ws FROM agent_templates WHERE id = NEW.template_id;
  IF team_ws IS NULL THEN
    RAISE EXCEPTION 'agent_template_teams: team % does not exist', NEW.team_id;
  END IF;
  IF tpl_ws IS NULL THEN
    RAISE EXCEPTION 'agent_template_teams: template % does not exist', NEW.template_id;
  END IF;
  IF team_ws <> NEW.workspace_id OR tpl_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'agent_template_teams: workspace mismatch (junction=%, team=%, template=%)',
      NEW.workspace_id, team_ws, tpl_ws;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agent_template_team_workspace_check ON public.agent_template_teams;
CREATE TRIGGER agent_template_team_workspace_check
  BEFORE INSERT OR UPDATE ON public.agent_template_teams
  FOR EACH ROW EXECUTE FUNCTION public.assert_agent_template_team_workspace();

-- Trigger functions never need direct EXECUTE from the API roles
-- (advisor 0028/0029) — the same REVOKE `20260611020000` ends with.
REVOKE EXECUTE ON FUNCTION public.assert_agent_template_team_workspace()
  FROM anon, authenticated;

-- ===========================================================================
-- 3. agent_template_knowledge_bases — attachments, BY REFERENCE
-- ===========================================================================
-- Mirrors `cluster_knowledge_bases` (`20260502100000`) column-for-column in
-- shape: composite PK so a KB cannot be attached twice, both FKs CASCADE,
-- denormalized `workspace_id`, an attributed `added_by_user_id` / `added_at`.
--
-- ⚠ THE ONE PLACE IT DOES NOT MIRROR IT IS THE WRITE POLICIES, AND THAT IS THE
-- CURRENT RULE WINNING OVER THE OLDER FILE. `cluster_knowledge_bases` carries
-- `_editor_insert` / `_editor_delete` policies from an era when the client
-- wrote junctions directly. This table's writes are service-role only, like
-- every table added since (`channel_launch_directives`, `20260822160000`), for
-- a reason specific to it: the attach gate is "a KB the CALLER can currently
-- read", which is a predicate over `knowledge_bases`' OWN visibility plus team
-- grants — not something a `WITH CHECK` on this table can express. A write
-- policy here would look like a fence and enforce nothing.
--
-- ⚠ ATTACHMENT IS A REFERENCE, NEVER A COPY. Nothing about the KB's content is
-- denormalized here — the resolve payload carries `{id, name}` and the agent
-- reads the base through the knowledge tools, so a KB that later goes private
-- or is deleted degrades to "gone", not to a stale copy in a template.

CREATE TABLE IF NOT EXISTS public.agent_template_knowledge_bases (
  template_id        UUID NOT NULL REFERENCES public.agent_templates(id) ON DELETE CASCADE,
  knowledge_base_id  UUID NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  added_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, knowledge_base_id)
);

-- FK cover: `knowledge_bases(id) ON DELETE CASCADE`.
CREATE INDEX IF NOT EXISTS agent_template_knowledge_bases_kb_idx
  ON public.agent_template_knowledge_bases (knowledge_base_id);

-- FK cover: `workspaces(id) ON DELETE CASCADE`.
CREATE INDEX IF NOT EXISTS agent_template_knowledge_bases_workspace_idx
  ON public.agent_template_knowledge_bases (workspace_id);

-- FK cover: `auth.users(id) ON DELETE SET NULL`.
CREATE INDEX IF NOT EXISTS agent_template_knowledge_bases_added_by_idx
  ON public.agent_template_knowledge_bases (added_by_user_id);

CREATE OR REPLACE FUNCTION public.assert_agent_template_kb_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE tpl_ws UUID; kb_ws UUID;
BEGIN
  SELECT workspace_id INTO tpl_ws FROM agent_templates WHERE id = NEW.template_id;
  SELECT workspace_id INTO kb_ws FROM knowledge_bases WHERE id = NEW.knowledge_base_id;
  IF tpl_ws IS NULL THEN
    RAISE EXCEPTION 'agent_template_knowledge_bases: template % does not exist', NEW.template_id;
  END IF;
  IF kb_ws IS NULL THEN
    RAISE EXCEPTION 'agent_template_knowledge_bases: knowledge base % does not exist', NEW.knowledge_base_id;
  END IF;
  IF tpl_ws <> NEW.workspace_id OR kb_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'agent_template_knowledge_bases: workspace mismatch (junction=%, template=%, kb=%)',
      NEW.workspace_id, tpl_ws, kb_ws;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agent_template_kb_workspace_check
  ON public.agent_template_knowledge_bases;
CREATE TRIGGER agent_template_kb_workspace_check
  BEFORE INSERT OR UPDATE ON public.agent_template_knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION public.assert_agent_template_kb_workspace();

REVOKE EXECUTE ON FUNCTION public.assert_agent_template_kb_workspace()
  FROM anon, authenticated;

-- ===========================================================================
-- 4. RLS — SELECT only, visibility-aware. No write policies anywhere.
-- ===========================================================================

ALTER TABLE public.agent_templates                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_template_teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_template_knowledge_bases ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON public.agent_templates                FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_template_teams           FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_template_knowledge_bases FROM authenticated, anon;

-- THE MATRIX. Arms in the order the service's `canSeeTemplate` evaluates them:
--   creator            -> always
--   workspace admin    -> always (mirrors `chats_member_select`'s admin arm)
--   visibility=workspace -> any active member
--   visibility=team    -> an active member of a linked team
--   visibility=private -> nobody else
-- `is_current_workspace_member` (caller-pinned, M-9 — `20260720211005`) is the
-- outer fence on every arm; `(SELECT auth.uid())` is the initplan form that
-- migration standardized.
CREATE POLICY agent_templates_member_select ON public.agent_templates
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (
      created_by = (SELECT auth.uid())
      OR visibility = 'workspace'
      OR (
        visibility = 'team'
        AND (
          -- ⚠ THE ADMIN ARM IS INSIDE THE 'team' BRANCH, NOT ABOVE IT, AND
          -- THAT IS THE ONE PLACE THIS POLICY IS TIGHTER THAN
          -- `chats_member_select`. That policy leads with a blanket
          -- `is_workspace_member(.., 'admin')`, so an admin reads every PRIVATE
          -- chat. Here `private` means private: an admin can administer the
          -- SHARING of a team template (which is why they pass here) and has no
          -- read of someone else's private one. The service's `canSeeTemplate`
          -- evaluates the same arms in the same order, so the API and the
          -- database agree — which is the property `20260716150000` existed to
          -- restore for chats after RLS and the service had drifted apart.
          is_current_workspace_member(workspace_id, 'admin'::text)
          OR EXISTS (
            SELECT 1
            FROM agent_template_teams att
            JOIN team_members tm ON tm.team_id = att.team_id
            WHERE att.template_id = agent_templates.id
              AND tm.user_id = (SELECT auth.uid())
          )
        )
      )
    )
  );

-- ⚠ RESTATED, NOT NESTED — see the header. A junction row is readable exactly
-- when its template is.
CREATE POLICY agent_template_teams_member_select ON public.agent_template_teams
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agent_templates t
      WHERE t.id = agent_template_teams.template_id
        AND is_current_workspace_member(t.workspace_id, 'viewer'::text)
        AND (
          t.created_by = (SELECT auth.uid())
          OR t.visibility = 'workspace'
          OR (
            t.visibility = 'team'
            AND (
              is_current_workspace_member(t.workspace_id, 'admin'::text)
              OR EXISTS (
                SELECT 1
                FROM agent_template_teams att
                JOIN team_members tm ON tm.team_id = att.team_id
                WHERE att.template_id = t.id
                  AND tm.user_id = (SELECT auth.uid())
              )
            )
          )
        )
    )
  );

CREATE POLICY agent_template_knowledge_bases_member_select
  ON public.agent_template_knowledge_bases
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM agent_templates t
      WHERE t.id = agent_template_knowledge_bases.template_id
        AND is_current_workspace_member(t.workspace_id, 'viewer'::text)
        AND (
          t.created_by = (SELECT auth.uid())
          OR t.visibility = 'workspace'
          OR (
            t.visibility = 'team'
            AND (
              is_current_workspace_member(t.workspace_id, 'admin'::text)
              OR EXISTS (
                SELECT 1
                FROM agent_template_teams att
                JOIN team_members tm ON tm.team_id = att.team_id
                WHERE att.template_id = t.id
                  AND tm.user_id = (SELECT auth.uid())
              )
            )
          )
        )
    )
  );

-- ===========================================================================
-- 5. Assert the outcome instead of trusting it.
-- ===========================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_templates',
    'agent_template_teams',
    'agent_template_knowledge_bases'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND cmd <> 'SELECT'
    ) THEN
      RAISE EXCEPTION
        'ABORT: % has a non-SELECT policy — every write must go through the agent-templates service on the admin client, which is the only layer that can check a KB attachment against what the caller may read', t;
    END IF;

    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION
        'ABORT: authenticated/anon retain DML on % — the service is the fence and a direct write would bypass the creator/admin gate', t;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      RAISE EXCEPTION
        'ABORT: % is published to supabase_realtime — this table has no subscriber by design (see the header); publishing it buys WAL decode and a per-subscription RLS evaluation on every write and delivers nothing', t;
    END IF;
  END LOOP;

  RAISE NOTICE
    'agent_templates created: 3 tables, SELECT-only policies, service-role writes, NOT published. Team visibility is agent_template_teams (a dedicated junction, NOT team_resource_access — see F-277).';
END
$$;
