-- CHANNEL SCOPE IS A HOME-CHANNEL MECHANISM — the container-KIND fence on
-- `resource_grants`, and the conversion of the rows written before it existed.
--
-- APPLIED 2026-09-17, by name (`channel_scope_workspace_fence`), byte-exact.
-- Re-derive with `supabase migration list` / MCP `list_migrations`, joined on
-- the NAME — the history version is not this file's prefix (F-304).
--
-- ═══ THE RULING (Samuel, 2026-09-17), VERBATIM ══════════════════════════════
--
-- "for workspaces, I don't want knowledge bases to be scoped to specific
--  channels. Knowledge bases and workspaces are scoped to the entire workspace,
--  not a specific channel. If that was implemented, that needs to be reverted.
--  There's no such thing as a knowledge base being shared to just a channel,
--  because the whole workspace is scoped. The idea of a workspace is that
--  everyone in the workspace should have access, essentially, to all resources.
--  Therefore, I don't want that to be scoped by channel. If anything, knowledge
--  bases are scoped by teams… In workspaces, resource access is not scoped by
--  channels. It's instead scoped by teams… I don't know if it was applied to
--  other stuff besides knowledge base, but if it was, then we have to revert."
--
-- ═══ WHAT IS NARROWED, AND WHAT IS DELIBERATELY NOT ═════════════════════════
--
-- 🔒 **THE MECHANISM SURVIVES; ITS AUDIENCE DOES NOT.** A HOME channel is a
-- `kind='link'` container holding exactly one channel (INVARIANTS §4A), so
-- "share into this channel" there IS the container grant — Samuel's home-sharing
-- model, unchanged. A `kind='personal'` container has one member and is likewise
-- untouched. **Only `kind='standard'` refuses.**
--
-- ⚠ **`COALESCE(kind,'standard') <> 'standard'`, NEVER `= 'link'`.** This is the
-- SQL spelling of `workspaces/types.ts › isStandardWorkspace` negated (§4A,
-- F-295): a `= 'link'` arm would silently refuse every kind added to the union
-- later, `personal` included, which is the same class of bug from the other
-- side. `ontology_channel_shares` asks the opposite question (`= 'link'`,
-- `20261001120000`) because it is HOME-ONLY by design rather than
-- STANDARD-REFUSING; both are positive tests of the kind they are about.
--
-- ⚠ **THE `team` SCOPE IS NOT TOUCHED BY ANY STATEMENT HERE.** Teams are what
-- the ruling names as the sub-workspace scope that stays, and `scope_type='team'`
-- rows are read by `dopl_teams_mode_visible()` / `listEffectiveAccess`, which
-- this file does not open. Nor is `scope_type='container'`.
--
-- ═══ ROLLBACK ═══════════════════════════════════════════════════════════════
--
-- ⚠ **THE DDL REVERSES; THE DATA DOES NOT.** Two halves, and only the first is a
-- rollback in the usual sense:
--
--   (a) THE FENCE. Restore `dopl_grant_admits` from `20260923140000` verbatim
--       (drop the one `AND public.dopl_channel_scope_allowed(g.scope_id)` line),
--       then `DROP FUNCTION IF EXISTS public.dopl_channel_scope_allowed(uuid);`.
--       Revert `src/shared/tenancy/channel-scope.ts` in the same change — §5A,
--       the two halves of one rule move together or neither does.
--
--   (b) THE CONVERSION IS ONE-WAY. Step 3 DELETEs channel grants and WIDENS
--       `visibility`, and records no prior value of either. **To be able to undo
--       it, snapshot the grant rows BEFORE applying** and keep the table:
--
--         CREATE TABLE public._rb_20261011120000 AS
--         SELECT g.*
--           FROM public.resource_grants g
--           JOIN public.channels   ch ON ch.id = g.scope_id
--           JOIN public.workspaces w  ON w.id  = ch.workspace_id
--          WHERE g.scope_type = 'channel'
--            AND COALESCE(w.kind, 'standard') = 'standard';
--
--       ⚠ **THAT RESTORES THE GRANTS, NOT THE VISIBILITIES.** The widened
--       `visibility` values are lost on apply, and a row already at the widest
--       value is indistinguishable afterwards from one this file widened — so
--       snapshot `(id, visibility)` for the five resource tables too, or accept
--       that the widening stands. Reverting (a) alone turns the fence off over a
--       table this file has already emptied, which is the worse of the two.
--
-- ═══ 🔒 THE TS TWIN, WHICH MOVES IN THE SAME CHANGE ═════════════════════════
--
-- `src/shared/tenancy/channel-scope.ts` holds the same rule for the service
-- role: `channelsWhereScopeIsIgnored` (read) and
-- `assertChannelScopeAllowedInContainer` (write). ⚠ §5A: ONE RULE WRITTEN TWICE
-- AND THE HALVES MUST MOVE TOGETHER — `scripts/check-rls-pair-gate.ts` proves
-- each predicate still has its named policy twin, and
-- `src/features/knowledge/server/rls-redteam.test.ts` proves the two AGREE.
--
-- ═══ RE-DERIVE THE BLAST RADIUS (a COMMAND, never a number) ═════════════════
--
-- How many rows this file will convert, by resource type and level — run it
-- BEFORE and AFTER; the "after" must be zero on every row:
--
--   SELECT g.resource_type, g.level, count(*)
--     FROM public.resource_grants g
--     JOIN public.channels   ch ON ch.id = g.scope_id
--     JOIN public.workspaces w  ON w.id  = ch.workspace_id
--    WHERE g.scope_type = 'channel'
--      AND COALESCE(w.kind, 'standard') = 'standard'
--    GROUP BY 1, 2
--    ORDER BY 1, 2;
--
-- And the ontology half, which should already be empty — its own trigger has
-- refused non-`link` channels since `20261001120000`:
--
--   SELECT count(*)
--     FROM public.ontology_channel_shares s
--     JOIN public.channels   ch ON ch.id = s.channel_id
--     JOIN public.workspaces w  ON w.id  = ch.workspace_id
--    WHERE COALESCE(w.kind, 'standard') = 'standard';


-- ── 1. The fence, as one function both arms of the read call ────────────────
-- ⚠ A SEPARATE FUNCTION rather than an inline EXISTS, for the reason
-- `dopl_grant_admits` itself is one: the day a second policy reads a channel
-- scope, it asks this and cannot ask it differently.
CREATE OR REPLACE FUNCTION public.dopl_channel_scope_allowed(p_channel_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.channels ch
      JOIN public.workspaces w ON w.id = ch.workspace_id
     WHERE ch.id = p_channel_id
       -- 🔒 `isStandardWorkspace` negated. A channel whose container cannot be
       -- read at all answers FALSE by the EXISTS, which is the same fail-closed
       -- reading `channelsWhereScopeIsIgnored` takes for a missing row.
       AND COALESCE(w.kind, 'standard') <> 'standard'
  );
$function$;

REVOKE ALL ON FUNCTION public.dopl_channel_scope_allowed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dopl_channel_scope_allowed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.dopl_channel_scope_allowed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dopl_channel_scope_allowed(uuid) TO service_role;

COMMENT ON FUNCTION public.dopl_channel_scope_allowed(uuid) IS
  'Samuel 2026-09-17: a resource is lent to a CHANNEL only in a non-standard container (home/personal). In a standard workspace, scope is the whole workspace, narrowed by TEAMS. TS twin: src/shared/tenancy/channel-scope.ts.';


-- ── 2. `dopl_grant_admits()` gains the fence on its CHANNEL arm ─────────────
-- ⚠ THE `container` AND `team` ARMS ARE BYTE-IDENTICAL TO `20260923140000`.
-- Only the channel arm changes; the whole body is restated because
-- `CREATE OR REPLACE FUNCTION` has no patch form.
CREATE OR REPLACE FUNCTION public.dopl_grant_admits(
  p_resource_type text,
  p_resource_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.resource_grants g
     WHERE g.resource_type = p_resource_type
       AND g.resource_id   = p_resource_id
       AND CASE g.scope_type
             WHEN 'container' THEN
               public.is_current_workspace_member(g.scope_id, 'viewer')
             WHEN 'channel' THEN
               g.level = 'visible'
               AND public.is_channel_member(g.scope_id)
               -- 🔒 Samuel 2026-09-17. ⚠ AND-ed onto the arm rather than
               -- replacing it: an existing row in a standard workspace is
               -- IGNORED, not assumed absent — step 3 below converts them, and
               -- a policy that assumed a clean table would be wrong for every
               -- minute between the deploy and the apply.
               AND public.dopl_channel_scope_allowed(g.scope_id)
             ELSE false
           END
  );
$function$;


-- ── 3. The conversion — widen, then delete ─────────────────────────────────
--
-- 🔒 **`visible` CONVERTS; `agent_only` ONLY DELETES.** They are two AUDIENCES,
-- not a high/low pair (`20260827120000`). `visible` named the HUMANS in one
-- room, so its workspace-wide equivalent is the widest `visibility` value the
-- resource's own table carries. `agent_only` named NO human at all — widening it
-- would hand a base to every member of the workspace on the strength of a row
-- that never reached a person. It is dropped, and it already reached nobody:
-- `service-audience.ts › resolveAgentAudience` answers `unrestricted` for every
-- container that is not `kind='link'`, so the agent ceiling has never read these
-- rows in a standard workspace either.
--
-- ⚠ **`access_mode` IS NOT TOUCHED.** A teams-mode row stays teams-mode: the
-- ruling makes TEAMS the sub-workspace scope, so "workspace-wide" here means the
-- widest VISIBILITY, still narrowed by whatever team grants exist. Flipping
-- `access_mode` would be the one direction this file must not widen.
--
-- ⚠ **EVERY UPDATE IS GUARDED BY `WHERE visibility <> <widest>`**, so a resource
-- already workspace-visible is not written at all — that is the "or deletes them
-- if the resource is already workspace-visible" half, spelled as a no-op UPDATE
-- followed by the DELETE every row gets.
DO $$
DECLARE
  v_widened  integer := 0;
  v_n        integer;
  v_deleted  integer;
BEGIN
  -- The (resource_type, resource_id) pairs whose HUMAN audience has to be
  -- preserved. ⚠ Materialised BEFORE any delete, because step 3b removes the
  -- rows this reads.
  -- ⚠ `IF EXISTS` FIRST: `ON COMMIT DROP` clears this at COMMIT, so a re-run in the
  -- same session with no enclosing transaction would otherwise hit a live table.
  DROP TABLE IF EXISTS _channel_scope_converts;
  CREATE TEMP TABLE _channel_scope_converts ON COMMIT DROP AS
  SELECT DISTINCT g.resource_type, g.resource_id
    FROM public.resource_grants g
    JOIN public.channels   ch ON ch.id = g.scope_id
    JOIN public.workspaces w  ON w.id  = ch.workspace_id
   WHERE g.scope_type = 'channel'
     AND g.level      = 'visible'
     AND COALESCE(w.kind, 'standard') = 'standard';

  UPDATE public.knowledge_bases t SET visibility = 'public'
   WHERE t.visibility <> 'public'
     AND EXISTS (SELECT 1 FROM _channel_scope_converts c
                  WHERE c.resource_type = 'knowledge_base' AND c.resource_id = t.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_widened := v_widened + v_n;

  UPDATE public.skills t SET visibility = 'public'
   WHERE t.visibility <> 'public'
     AND EXISTS (SELECT 1 FROM _channel_scope_converts c
                  WHERE c.resource_type = 'skill' AND c.resource_id = t.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_widened := v_widened + v_n;

  UPDATE public.chats t SET visibility = 'public'
   WHERE t.visibility <> 'public'
     AND EXISTS (SELECT 1 FROM _channel_scope_converts c
                  WHERE c.resource_type = 'chat' AND c.resource_id = t.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_widened := v_widened + v_n;

  UPDATE public.chat_folders t SET visibility = 'public'
   WHERE t.visibility <> 'public'
     AND EXISTS (SELECT 1 FROM _channel_scope_converts c
                  WHERE c.resource_type = 'chat_folder' AND c.resource_id = t.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_widened := v_widened + v_n;

  -- ⚠ `'workspace'`, NOT `'public'` — `agent_templates` speaks a THIRD
  -- vocabulary (`private | team | workspace`, `20260822200000`), and its widest
  -- value is the one that means "everyone in this container".
  UPDATE public.agent_templates t SET visibility = 'workspace'
   WHERE t.visibility <> 'workspace'
     AND EXISTS (SELECT 1 FROM _channel_scope_converts c
                  WHERE c.resource_type = 'agent_template' AND c.resource_id = t.id);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_widened := v_widened + v_n;

  -- 3b. Every channel-scoped row in a standard container goes, at BOTH levels.
  DELETE FROM public.resource_grants g
   USING public.channels ch, public.workspaces w
   WHERE g.scope_type = 'channel'
     AND ch.id = g.scope_id
     AND w.id  = ch.workspace_id
     AND COALESCE(w.kind, 'standard') = 'standard';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE 'channel_scope_workspace_fence: widened % resource rows, deleted % channel grants', v_widened, v_deleted;
END $$;


-- ── 4. The ontology half — defensive, and expected to be a no-op ───────────
-- `assert_ontology_share_scope()` has refused a non-`link` channel since
-- `20261001120000`, so there should be nothing here. ⚠ **"SHOULD BE" IS NOT
-- "IS"**: the trigger is `BEFORE INSERT OR UPDATE`, so a row that predates it,
-- or a container whose `kind` was changed AFTER the share was written, is not
-- covered by it. The statement costs nothing and closes both.
DELETE FROM public.ontology_channel_shares s
 USING public.channels ch, public.workspaces w
 WHERE ch.id = s.channel_id
   AND w.id  = ch.workspace_id
   AND COALESCE(w.kind, 'standard') = 'standard';


-- ── 5. ABORT IF THE END STATE IS NOT THE ONE THIS FILE CLAIMS ──────────────
-- ⚠ A migration that reports success having converted nothing is how the
-- "applied" box gets ticked over a table that still holds the rows.
DO $$
DECLARE
  v_left integer;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.resource_grants g
    JOIN public.channels   ch ON ch.id = g.scope_id
    JOIN public.workspaces w  ON w.id  = ch.workspace_id
   WHERE g.scope_type = 'channel'
     AND COALESCE(w.kind, 'standard') = 'standard';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ABORT: % channel-scoped resource_grants still sit in standard workspaces', v_left;
  END IF;

  SELECT count(*) INTO v_left
    FROM public.ontology_channel_shares s
    JOIN public.channels   ch ON ch.id = s.channel_id
    JOIN public.workspaces w  ON w.id  = ch.workspace_id
   WHERE COALESCE(w.kind, 'standard') = 'standard';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'ABORT: % ontology_channel_shares still sit in standard workspaces', v_left;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'dopl_channel_scope_allowed'
  ) THEN
    RAISE EXCEPTION 'ABORT: dopl_channel_scope_allowed did not survive this migration';
  END IF;

  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'dopl_grant_admits')
       NOT LIKE '%dopl_channel_scope_allowed%' THEN
    RAISE EXCEPTION 'ABORT: dopl_grant_admits does not reach the channel-scope fence';
  END IF;

  RAISE NOTICE 'channel_scope_workspace_fence: end state verified — no channel scope in any standard workspace';
END $$;
