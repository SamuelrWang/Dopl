-- ============================================================================
-- RLS: pin workspace-membership checks to the caller (M-9) + auth_rls_initplan
-- ============================================================================
--
-- THREE things happen here, in strict order. This DROP+CREATEs ~73 LIVE RLS
-- policies, so it is the highest-risk change in the audit. Every policy below
-- is recreated with its qual / with_check / cmd / roles reproduced EXACTLY;
-- the ONLY transformations applied are the two mechanical, provably
-- semantics-preserving rewrites described in PART 1 and PART 2. Policy
-- *topology* (which policies exist, their names, cmd, and target roles) is
-- unchanged — no merges, no splits — so the effective row visibility for every
-- (table, role, cmd) is identical before and after.
--
-- ---------------------------------------------------------------------------
-- M-9 (security): kill the arbitrary-user oracle
-- ---------------------------------------------------------------------------
-- `is_workspace_member(workspace_id, auth.uid(), role)` is SECURITY DEFINER and
-- was granted to `authenticated`. Because the *caller* supplies the user-id
-- argument, an authenticated user could call it via PostgREST RPC with ANY
-- user-id and learn that user's workspace/role membership (a membership
-- oracle). Every RLS policy passes auth.uid() there, but the grant itself is
-- the leak. Fix: introduce SECURITY DEFINER `is_current_workspace_member(ws,
-- role)` which hard-codes the subject to auth.uid() (the caller can no longer
-- choose it), repoint every policy at it, then REVOKE EXECUTE on the 3-arg
-- form from `authenticated` (service_role + owner keep it).
--
-- PRECONDITION VERIFIED (read-only, at authoring time): all 62 policies that
-- call the 3-arg form pass `auth.uid()` (or `(select auth.uid())`) as the 2nd
-- argument — NONE passes a different/foreign user-id — so replacing the call
-- with the caller-pinned function is a strict no-op on evaluated semantics.
--
-- ---------------------------------------------------------------------------
-- auth_rls_initplan (performance): 70 lints -> 0
-- ---------------------------------------------------------------------------
-- Bare `auth.uid()` in a policy expression is re-evaluated per row. Wrapping it
-- as `(select auth.uid())` makes the planner hoist it to a once-per-query
-- InitPlan. Semantically identical. Two ways this is cleared here:
--   * PART 1 (Group A, 62 policies): the membership call's auth.uid() moves
--     INSIDE is_current_workspace_member (out of the policy expression), and any
--     remaining bare auth.uid() (created_by / owner_id / team-join comparisons)
--     is wrapped as `(select auth.uid())`.
--   * PART 2 (Group B, 11 policies): owner-scoped policies that never call
--     is_workspace_member — only their bare auth.uid() is wrapped. These are
--     initplan-ONLY and are unrelated to M-9; PART 2 may be dropped
--     independently if the reviewer wants to keep this migration minimal.
--
-- ---------------------------------------------------------------------------
-- multiple_permissive_policies (36 lints): INTENTIONALLY NOT ADDRESSED HERE
-- ---------------------------------------------------------------------------
-- See the note at the very bottom. Consolidating those would change policy
-- topology on the most sensitive tables; correctness > perf, so it is deferred
-- to a separate migration.
--
-- ---------------------------------------------------------------------------
-- ATOMICITY: apply as a SINGLE transaction (Supabase apply_migration / a single
-- psql invocation of this file both do this). A partial apply would leave some
-- tables with policies dropped-but-not-recreated (deny-all for members). Do not
-- split this file across separate statements sessions.
--
-- ROLLBACK: there is no auto-down migration. To revert, re-run the prior
-- policy definitions (recreate each policy below with the ORIGINAL
-- `is_workspace_member(workspace_id, auth.uid(), '<role>')` calls and un-wrapped
-- auth.uid()), then
--   GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid,uuid,text) TO authenticated;
-- and optionally DROP FUNCTION public.is_current_workspace_member(uuid,text).
-- The exact pre-image of every policy is preserved in git history / pg_policies
-- prior to apply; capture `SELECT * FROM pg_policies WHERE schemaname='public'`
-- before applying if an in-band snapshot is wanted.
-- ============================================================================


-- ===========================================================================
-- STEP 1 — caller-pinned membership function (M-9 core)
-- ===========================================================================
-- SECURITY DEFINER so it runs as the owner (postgres), which retains EXECUTE on
-- is_workspace_member even after STEP 4 revokes it from `authenticated`.
-- auth.uid() reads the request JWT claim and is therefore the REAL caller
-- regardless of the executing role — that is precisely what pins the subject.
-- `(select auth.uid())` in the body keeps it a single InitPlan per call.
CREATE OR REPLACE FUNCTION public.is_current_workspace_member(
  p_workspace_id uuid,
  p_min_role text DEFAULT 'viewer'::text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
  SELECT public.is_workspace_member(p_workspace_id, (SELECT auth.uid()), p_min_role);
$function$;

-- Lock down default PUBLIC execute, then grant explicitly (mirrors the grant
-- set of is_workspace_member minus the arbitrary-user hazard).
REVOKE ALL ON FUNCTION public.is_current_workspace_member(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_current_workspace_member(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_workspace_member(uuid, text) TO service_role;


-- ===========================================================================
-- STEP 2 + 3 — PART 1 (Group A): recreate every policy that calls the 3-arg
-- is_workspace_member, swapping it for is_current_workspace_member and wrapping
-- any remaining bare auth.uid() as (select auth.uid()).
-- ===========================================================================

-- ---- clusters --------------------------------------------------------------
DROP POLICY IF EXISTS clusters_member_select ON clusters;
CREATE POLICY clusters_member_select ON clusters
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS clusters_editor_insert ON clusters;
CREATE POLICY clusters_editor_insert ON clusters
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS clusters_editor_update ON clusters;
CREATE POLICY clusters_editor_update ON clusters
  FOR UPDATE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS clusters_editor_delete ON clusters;
CREATE POLICY clusters_editor_delete ON clusters
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- knowledge_bases -------------------------------------------------------
DROP POLICY IF EXISTS knowledge_bases_member_select ON knowledge_bases;
CREATE POLICY knowledge_bases_member_select ON knowledge_bases
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS knowledge_bases_editor_insert ON knowledge_bases;
CREATE POLICY knowledge_bases_editor_insert ON knowledge_bases
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS knowledge_bases_editor_update ON knowledge_bases;
CREATE POLICY knowledge_bases_editor_update ON knowledge_bases
  FOR UPDATE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  )
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS knowledge_bases_editor_delete ON knowledge_bases;
CREATE POLICY knowledge_bases_editor_delete ON knowledge_bases
  FOR DELETE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  );

-- ---- knowledge_entries -----------------------------------------------------
DROP POLICY IF EXISTS knowledge_entries_member_select ON knowledge_entries;
CREATE POLICY knowledge_entries_member_select ON knowledge_entries
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_entries.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
  );

DROP POLICY IF EXISTS knowledge_entries_editor_insert ON knowledge_entries;
CREATE POLICY knowledge_entries_editor_insert ON knowledge_entries
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS knowledge_entries_editor_update ON knowledge_entries;
CREATE POLICY knowledge_entries_editor_update ON knowledge_entries
  FOR UPDATE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_entries.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
  )
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_entries.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
    AND (last_edited_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS knowledge_entries_editor_delete ON knowledge_entries;
CREATE POLICY knowledge_entries_editor_delete ON knowledge_entries
  FOR DELETE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_entries.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
  );

-- ---- knowledge_folders -----------------------------------------------------
DROP POLICY IF EXISTS knowledge_folders_member_select ON knowledge_folders;
CREATE POLICY knowledge_folders_member_select ON knowledge_folders
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_folders.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
  );

DROP POLICY IF EXISTS knowledge_folders_editor_insert ON knowledge_folders;
CREATE POLICY knowledge_folders_editor_insert ON knowledge_folders
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS knowledge_folders_editor_update ON knowledge_folders;
CREATE POLICY knowledge_folders_editor_update ON knowledge_folders
  FOR UPDATE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_folders.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
  )
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_folders.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
  );

DROP POLICY IF EXISTS knowledge_folders_editor_delete ON knowledge_folders;
CREATE POLICY knowledge_folders_editor_delete ON knowledge_folders
  FOR DELETE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE ((kb.id = knowledge_folders.knowledge_base_id)
        AND ((kb.visibility = 'public'::text) OR (kb.created_by = (SELECT auth.uid()))))
    ))
  );

-- ---- chats (chats_member_select only; chats_owner_select is in PART 2) ------
DROP POLICY IF EXISTS chats_member_select ON chats;
CREATE POLICY chats_member_select ON chats
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'admin'::text)
    OR (
      (visibility = 'public'::text)
      AND (access_mode = 'workspace'::text)
      AND is_current_workspace_member(workspace_id, 'viewer'::text)
    )
    OR (
      (visibility = 'public'::text)
      AND (access_mode = 'teams'::text)
      AND is_current_workspace_member(workspace_id, 'viewer'::text)
      AND (EXISTS (
        SELECT 1
        FROM (team_resource_access tra
          JOIN team_members tm ON ((tm.team_id = tra.team_id)))
        WHERE ((tra.resource_type = 'chat'::text)
          AND (tra.resource_id = chats.id)
          AND (tm.user_id = (SELECT auth.uid())))
      ))
    )
  );

-- ---- chat_messages ---------------------------------------------------------
DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE ((c.id = chat_messages.chat_id)
        AND (
          (c.owner_id = (SELECT auth.uid()))
          OR is_current_workspace_member(c.workspace_id, 'admin'::text)
          OR (
            (c.visibility = 'public'::text)
            AND (c.access_mode = 'workspace'::text)
            AND is_current_workspace_member(c.workspace_id, 'viewer'::text)
          )
          OR (
            (c.visibility = 'public'::text)
            AND (c.access_mode = 'teams'::text)
            AND is_current_workspace_member(c.workspace_id, 'viewer'::text)
            AND (EXISTS (
              SELECT 1
              FROM (team_resource_access tra
                JOIN team_members tm ON ((tm.team_id = tra.team_id)))
              WHERE ((tra.resource_type = 'chat'::text)
                AND (tra.resource_id = c.id)
                AND (tm.user_id = (SELECT auth.uid())))
            ))
          )
        ))
    )
  );

-- ---- mcp_tool_calls --------------------------------------------------------
DROP POLICY IF EXISTS mcp_tool_calls_admin_select ON mcp_tool_calls;
CREATE POLICY mcp_tool_calls_admin_select ON mcp_tool_calls
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'admin'::text));

-- ---- ontology_clusters -----------------------------------------------------
DROP POLICY IF EXISTS ontology_clusters_member_select ON ontology_clusters;
CREATE POLICY ontology_clusters_member_select ON ontology_clusters
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS ontology_clusters_editor_insert ON ontology_clusters;
CREATE POLICY ontology_clusters_editor_insert ON ontology_clusters
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS ontology_clusters_editor_update ON ontology_clusters;
CREATE POLICY ontology_clusters_editor_update ON ontology_clusters
  FOR UPDATE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS ontology_clusters_editor_delete ON ontology_clusters;
CREATE POLICY ontology_clusters_editor_delete ON ontology_clusters
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- ontology_memberships (FOR ALL) ---------------------------------------
DROP POLICY IF EXISTS ontology_memberships_member_select ON ontology_memberships;
CREATE POLICY ontology_memberships_member_select ON ontology_memberships
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS ontology_memberships_editor_write ON ontology_memberships;
CREATE POLICY ontology_memberships_editor_write ON ontology_memberships
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'editor'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- ontology_objects ------------------------------------------------------
DROP POLICY IF EXISTS ontology_objects_member_select ON ontology_objects;
CREATE POLICY ontology_objects_member_select ON ontology_objects
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS ontology_objects_editor_insert ON ontology_objects;
CREATE POLICY ontology_objects_editor_insert ON ontology_objects
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS ontology_objects_editor_update ON ontology_objects;
CREATE POLICY ontology_objects_editor_update ON ontology_objects
  FOR UPDATE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS ontology_objects_editor_delete ON ontology_objects;
CREATE POLICY ontology_objects_editor_delete ON ontology_objects
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- ontology_relationships (FOR ALL) -------------------------------------
DROP POLICY IF EXISTS ontology_relationships_member_select ON ontology_relationships;
CREATE POLICY ontology_relationships_member_select ON ontology_relationships
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS ontology_relationships_editor_write ON ontology_relationships;
CREATE POLICY ontology_relationships_editor_write ON ontology_relationships
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'editor'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- skill_events ----------------------------------------------------------
DROP POLICY IF EXISTS skill_events_member_select ON skill_events;
CREATE POLICY skill_events_member_select ON skill_events
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

-- ---- skill_versions --------------------------------------------------------
DROP POLICY IF EXISTS skill_versions_member_select ON skill_versions;
CREATE POLICY skill_versions_member_select ON skill_versions
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

-- ---- skills ----------------------------------------------------------------
DROP POLICY IF EXISTS skills_member_select ON skills;
CREATE POLICY skills_member_select ON skills
  FOR SELECT
  USING (
    is_current_workspace_member(workspace_id, 'viewer'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS skills_editor_insert ON skills;
CREATE POLICY skills_editor_insert ON skills
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS skills_editor_update ON skills;
CREATE POLICY skills_editor_update ON skills
  FOR UPDATE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  )
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  );

DROP POLICY IF EXISTS skills_editor_delete ON skills;
CREATE POLICY skills_editor_delete ON skills
  FOR DELETE
  USING (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND ((visibility = 'public'::text) OR (created_by = (SELECT auth.uid())))
  );

-- ---- team_members (FOR ALL) -----------------------------------------------
DROP POLICY IF EXISTS team_members_member_select ON team_members;
CREATE POLICY team_members_member_select ON team_members
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS team_members_admin_write ON team_members;
CREATE POLICY team_members_admin_write ON team_members
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'admin'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'admin'::text));

-- ---- team_resource_access (FOR ALL) ---------------------------------------
DROP POLICY IF EXISTS team_resource_access_member_select ON team_resource_access;
CREATE POLICY team_resource_access_member_select ON team_resource_access
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS team_resource_access_admin_write ON team_resource_access;
CREATE POLICY team_resource_access_admin_write ON team_resource_access
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'admin'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'admin'::text));

-- ---- teams (FOR ALL) -------------------------------------------------------
DROP POLICY IF EXISTS teams_member_select ON teams;
CREATE POLICY teams_member_select ON teams
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS teams_admin_write ON teams;
CREATE POLICY teams_admin_write ON teams
  FOR ALL
  USING (is_current_workspace_member(workspace_id, 'admin'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'admin'::text));

-- ---- workflow_knowledge_bases ---------------------------------------------
DROP POLICY IF EXISTS workflow_knowledge_bases_member_select ON workflow_knowledge_bases;
CREATE POLICY workflow_knowledge_bases_member_select ON workflow_knowledge_bases
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS workflow_knowledge_bases_editor_insert ON workflow_knowledge_bases;
CREATE POLICY workflow_knowledge_bases_editor_insert ON workflow_knowledge_bases
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (added_by_user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS workflow_knowledge_bases_editor_delete ON workflow_knowledge_bases;
CREATE POLICY workflow_knowledge_bases_editor_delete ON workflow_knowledge_bases
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- workflow_skills -------------------------------------------------------
DROP POLICY IF EXISTS workflow_skills_member_select ON workflow_skills;
CREATE POLICY workflow_skills_member_select ON workflow_skills
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS workflow_skills_editor_insert ON workflow_skills;
CREATE POLICY workflow_skills_editor_insert ON workflow_skills
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (added_by_user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS workflow_skills_editor_delete ON workflow_skills;
CREATE POLICY workflow_skills_editor_delete ON workflow_skills
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- workflow_step_edges ---------------------------------------------------
DROP POLICY IF EXISTS workflow_step_edges_member_select ON workflow_step_edges;
CREATE POLICY workflow_step_edges_member_select ON workflow_step_edges
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS workflow_step_edges_editor_insert ON workflow_step_edges;
CREATE POLICY workflow_step_edges_editor_insert ON workflow_step_edges
  FOR INSERT
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS workflow_step_edges_editor_update ON workflow_step_edges;
CREATE POLICY workflow_step_edges_editor_update ON workflow_step_edges
  FOR UPDATE
  USING (is_current_workspace_member(workspace_id, 'editor'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS workflow_step_edges_editor_delete ON workflow_step_edges;
CREATE POLICY workflow_step_edges_editor_delete ON workflow_step_edges
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- workflow_steps --------------------------------------------------------
DROP POLICY IF EXISTS workflow_steps_member_select ON workflow_steps;
CREATE POLICY workflow_steps_member_select ON workflow_steps
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS workflow_steps_editor_insert ON workflow_steps;
CREATE POLICY workflow_steps_editor_insert ON workflow_steps
  FOR INSERT
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS workflow_steps_editor_update ON workflow_steps;
CREATE POLICY workflow_steps_editor_update ON workflow_steps
  FOR UPDATE
  USING (is_current_workspace_member(workspace_id, 'editor'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS workflow_steps_editor_delete ON workflow_steps;
CREATE POLICY workflow_steps_editor_delete ON workflow_steps
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- workflows -------------------------------------------------------------
DROP POLICY IF EXISTS workflows_member_select ON workflows;
CREATE POLICY workflows_member_select ON workflows
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));

DROP POLICY IF EXISTS workflows_editor_insert ON workflows;
CREATE POLICY workflows_editor_insert ON workflows
  FOR INSERT
  WITH CHECK (
    is_current_workspace_member(workspace_id, 'editor'::text)
    AND (user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS workflows_editor_update ON workflows;
CREATE POLICY workflows_editor_update ON workflows
  FOR UPDATE
  USING (is_current_workspace_member(workspace_id, 'editor'::text))
  WITH CHECK (is_current_workspace_member(workspace_id, 'editor'::text));

DROP POLICY IF EXISTS workflows_editor_delete ON workflows;
CREATE POLICY workflows_editor_delete ON workflows
  FOR DELETE
  USING (is_current_workspace_member(workspace_id, 'editor'::text));

-- ---- workspace_billing -----------------------------------------------------
DROP POLICY IF EXISTS workspace_billing_member_select ON workspace_billing;
CREATE POLICY workspace_billing_member_select ON workspace_billing
  FOR SELECT
  USING (is_current_workspace_member(workspace_id, 'viewer'::text));


-- ===========================================================================
-- STEP 3 — PART 2 (Group B): auth_rls_initplan-ONLY rewrites.
-- These policies do NOT call is_workspace_member; they are recreated solely to
-- wrap bare auth.uid() as (select auth.uid()). No membership/M-9 involvement.
-- This whole PART 2 block may be dropped independently without affecting M-9.
-- ===========================================================================

-- ---- chat_folders ----------------------------------------------------------
DROP POLICY IF EXISTS chat_folders_owner_select ON chat_folders;
CREATE POLICY chat_folders_owner_select ON chat_folders
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ---- chats (owner path) ----------------------------------------------------
DROP POLICY IF EXISTS chats_owner_select ON chats;
CREATE POLICY chats_owner_select ON chats
  FOR SELECT
  USING (owner_id = (SELECT auth.uid()));

-- ---- profiles --------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_own ON profiles;
CREATE POLICY profiles_select_own ON profiles
  FOR SELECT
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own ON profiles
  FOR UPDATE
  USING (id = (SELECT auth.uid()));

-- ---- user_preferences ------------------------------------------------------
DROP POLICY IF EXISTS user_preferences_select_own ON user_preferences;
CREATE POLICY user_preferences_select_own ON user_preferences
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_preferences_insert_own ON user_preferences;
CREATE POLICY user_preferences_insert_own ON user_preferences
  FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_preferences_update_own ON user_preferences;
CREATE POLICY user_preferences_update_own ON user_preferences
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_preferences_delete_own ON user_preferences;
CREATE POLICY user_preferences_delete_own ON user_preferences
  FOR DELETE
  USING (user_id = (SELECT auth.uid()));

-- ---- workspace_invitations -------------------------------------------------
DROP POLICY IF EXISTS workspace_invitations_admin_select ON workspace_invitations;
CREATE POLICY workspace_invitations_admin_select ON workspace_invitations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE ((m.workspace_id = workspace_invitations.workspace_id)
        AND (m.user_id = (SELECT auth.uid()))
        AND (m.status = 'active'::text)
        AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))
    )
  );

-- ---- workspace_members -----------------------------------------------------
DROP POLICY IF EXISTS workspace_members_self_select ON workspace_members;
CREATE POLICY workspace_members_self_select ON workspace_members
  FOR SELECT
  USING (user_id = (SELECT auth.uid()));

-- ---- workspaces ------------------------------------------------------------
DROP POLICY IF EXISTS workspaces_member_select ON workspaces;
CREATE POLICY workspaces_member_select ON workspaces
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE ((m.workspace_id = workspaces.id)
        AND (m.user_id = (SELECT auth.uid()))
        AND (m.status = 'active'::text))
    )
  );


-- ===========================================================================
-- STEP 4 — revoke the arbitrary-user oracle (M-9 close-out)
-- ===========================================================================
-- Only safe AFTER every policy above is off the 3-arg form. Verified at
-- authoring time: no VIEW and no other DB FUNCTION references
-- is_workspace_member, and no application code calls
-- `.rpc('is_workspace_member')` (only the generated types.ts type entry exists).
-- The SECURITY DEFINER is_current_workspace_member still reaches it as its owner
-- (postgres), and service_role keeps EXECUTE.
--
-- POST-APPLY GATE (run before considering this done):
--   -- expect 0 rows: any surviving policy still on the 3-arg form
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname='public'
--     AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'is_workspace_member\s*\([^)]*,\s*auth\.uid';
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid, text) FROM authenticated;


-- ===========================================================================
-- DEFERRED — multiple_permissive_policies (36 lints) — NOT done here.
-- ===========================================================================
-- Two shapes, both left intact on purpose (correctness > perf):
--   (a) FOR ALL admin/editor write policy + FOR SELECT member policy overlap on
--       SELECT (team_members, team_resource_access, teams, ontology_memberships,
--       ontology_relationships). The write policy's SELECT arm is subsumed by
--       the member SELECT (admin/editor implies viewer), so it *is* provably
--       redundant for SELECT — but removing it requires splitting FOR ALL into
--       FOR INSERT/UPDATE/DELETE, i.e. changing policy topology on the most
--       sensitive tables. Deferred to its own migration + isolation test.
--   (b) chats: two FOR SELECT policies (chats_owner_select OR chats_member_select).
--       Mergeable (permissive = OR) with identical semantics, but merging still
--       changes topology and buys little; deferred.
-- Recommended follow-up: a separate migration that (a) replaces each *_admin_write
-- / *_editor_write FOR ALL policy with explicit FOR INSERT + FOR UPDATE + FOR
-- DELETE policies (same USING/WITH CHECK), leaving the FOR SELECT member policy
-- as the sole SELECT policy; and (b) optionally folds chats_owner_select into
-- chats_member_select. Ship behind the same no-regression isolation test.
