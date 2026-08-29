-- ============================================================================
-- agent_templates.home_scoped — THE /home SHELF, FOR TEMPLATES
-- (Samuel's ruling 2026-08-27: converge the Agents face on the Knowledge one.)
--
-- WHAT THIS IS FOR
-- The sibling of `20260831120000_knowledge_base_home_scoped.sql`, and the same
-- argument applies word for word: `/home` → Agents → "across all channels"
-- listed every private template the caller owned in their default standard
-- workspace, including ones authored months earlier on the WORKSPACE Agents
-- page that had never been near a channel. A pill labelled with a CHANNEL range
-- was delivering a WORKSPACE range. This column is the missing noun:
--
--     home_scoped = true   → /home → Agents → "Personal"
--     home_scoped = false  → /{workspaceSegment}/agents (the workspace page)
--
-- ⚠ SEPARATION BOTH WAYS. The workspace Agents page EXCLUDES home-scoped
-- templates. A shelf that is its own place in one direction only is a filter.
--
-- 🔒 IT IS A SHELF AXIS AND IT DOES NOT TOUCH THE VISIBILITY AXIS. `visibility`
-- ('private' | 'team' | 'workspace') answers WHO MAY READ THIS; `home_scoped`
-- answers WHICH SURFACE LISTS IT. In particular **nothing here interacts with
-- F-333/F-336** (`server/service-shared.ts › canSeeTemplate`, arm 2's
-- `isSharedCredential`): that arm decides whether a credential stands for a
-- person, this column decides which of the operator's own two shelves a row sits
-- on, and `canSeeTemplate` neither reads nor is passed this value. A
-- container-session credential sees exactly what it saw before. ⚠ The RLS policy
-- `agent_templates_member_select` (`20260822200000_agent_templates.sql`) is
-- likewise untouched and must stay so: RLS and `canSeeTemplate` are ONE RULE
-- WRITTEN TWICE and both are about visibility, not about shelves.
--
-- WHAT ENFORCES IT
-- Writes: `features/agent-templates/server/service-writes.ts ›
-- resolveTemplateHomeScope`. Three conditions, all required, checked
-- server-side and never inferred from a header:
--   1. a PERSON asked (`shared/auth/credential-audience.ts › isSharedCredential`
--      is false) — a credential that may be shared between humans has no
--      personal shelf;
--   2. the RESOLVED visibility is `private` — the shelf is "yours alone", and
--      a template has no grant table, so `private` IS the whole audience
--      statement for it (this is the KB fence's condition 2 adapted: there,
--      `private` + a channel grant could still be shared; here `private` is
--      terminal);
--   3. the target IS the caller's own default standard workspace
--      (`features/workspaces/server/repository.ts › findDefaultWorkspaceForUser`
--      — the same answer `POST /api/boot` gives the page, so the fence and the
--      surface cannot disagree about which workspace "home" is).
-- Anything else that asks is refused 403 TEMPLATE_HOME_SCOPE_FORBIDDEN rather
-- than quietly downgraded: a create that silently lands on the other shelf is
-- invisible on the surface that made it.
-- Reads: `server/service-reads.ts › listTemplates` takes a `shelf` and
-- `server/repository.ts › listTemplatesForWorkspace` turns it into
-- `.eq('home_scoped', …)`. ABSENT shelf = NO filter — which is what keeps MCP,
-- the launch picker and `resolveTemplateForLaunch` seeing the whole workspace.
--
-- ⚠ THE COLUMN IS NEVER PROJECTED. Not in `server/dto.ts ›
-- AGENT_TEMPLATE_COLS`, not on `AgentTemplateRow`, not on the `AgentTemplate`
-- domain type. Postgres filters fine on a column the SELECT omits, and keeping
-- it off the row means the cached template payload gains NO new field — so
-- INVARIANTS §8's stale-cache rule has nothing to apply to here, and no client
-- can re-implement the fence over a list it was handed.
--
-- FALSE IS THE OVERWHELMING MAJORITY AND MEANS "THE WORKSPACE SHELF"
-- Every existing row stays `false`. **There is no backfill in this file, by
-- instruction** — and measured against production 2026-08-27 none is needed:
-- the operator's default standard workspace holds exactly two templates, one
-- `workspace`-visible (so it was never on the Personal shelf) and one `private`
-- but owned by a DIFFERENT user (so it was never his). Nothing of his vanishes.
--
-- NO INDEX, AND THE REASON IS THE READ SHAPE
-- The only queries touching this column are `workspace_id = ? AND home_scoped
-- = ?` ordered by name, and `agent_templates_workspace_name_idx
-- (workspace_id, name)` already narrows that to ONE workspace's templates — a
-- shelf, not a feed. A boolean has two distinct values, so a composite over it
-- would be a heap-fetch multiplier the planner would decline. ⚠ Re-open this
-- only if a shelf read is ever made ACROSS workspaces; no such query exists.
--
-- REALTIME + RLS (§7)
-- `agent_templates` is NOT in `supabase_realtime` (verified 2026-08-27), so
-- nothing rides CDC. Its single policy is untouched, as is its replica identity
-- and every column grant. Nothing in §7 applies beyond this sentence.
--
-- ROLLBACK (prose, per §12) — SAFE IN EITHER ORDER, AND IT FAILS OPEN.
--   ALTER TABLE agent_templates DROP COLUMN IF EXISTS home_scoped;
-- Dropping the column while the app still sends `?shelf=` makes both list reads
-- ERROR (unknown column) rather than widen — the pane shows its error card and
-- nothing leaks. Rolling the APP back first is the quiet order: every read
-- returns to unfiltered, i.e. the pre-wave behaviour. Neither order can put a
-- template in front of anybody who could not already read it, because this
-- column is not on the visibility axis at all.
-- ============================================================================

ALTER TABLE agent_templates
  ADD COLUMN IF NOT EXISTS home_scoped BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN agent_templates.home_scoped IS
  'Which SHELF this template lives on. FALSE (default) = the workspace Agents page. TRUE = the /home Agents pane''s "Personal" section. The two surfaces exclude each other BOTH ways (Samuel''s ruling 2026-08-27). Set only by createTemplate, and only for a private template in the caller''s own default standard workspace under a person-standing credential. NOT a visibility axis — canSeeTemplate and agent_templates_member_select neither read it nor are affected by it.';

-- ── VERIFICATION ────────────────────────────────────────────────────────────
-- A partially-applied file must RAISE here rather than ship a shelf that does
-- not separate. NOT NULL means no read has to spell "false OR null"; DEFAULT
-- FALSE is what makes every pre-existing row a workspace-shelf row with no
-- backfill.
DO $$
DECLARE
  col_nullable BOOLEAN;
  col_default  TEXT;
  col_type     TEXT;
BEGIN
  SELECT (is_nullable = 'YES'), column_default, data_type
    INTO col_nullable, col_default, col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'agent_templates'
     AND column_name = 'home_scoped';

  IF col_type IS NULL THEN
    RAISE EXCEPTION 'agent_template_home_scoped: agent_templates.home_scoped was not created';
  END IF;

  IF col_type <> 'boolean' THEN
    RAISE EXCEPTION 'agent_template_home_scoped: home_scoped is %, expected boolean', col_type;
  END IF;

  IF col_nullable THEN
    RAISE EXCEPTION 'agent_template_home_scoped: home_scoped must be NOT NULL — a NULL shelf is a row neither surface would list';
  END IF;

  IF col_default IS NULL OR col_default NOT LIKE 'false%' THEN
    RAISE EXCEPTION 'agent_template_home_scoped: home_scoped must DEFAULT FALSE — that default IS the no-backfill guarantee (got %)', COALESCE(col_default, '(none)');
  END IF;
END $$;
