-- M-10 follow-up: prevent private-resource leak through workspace-shared canvas panels.
--
-- canvas_panels is a workspace-shared table. RLS today only checks
-- workspace membership, so a panel of type 'knowledge-base' or 'skill'
-- that points at a private KB / skill leaks the resource's NAME (in
-- panel_data) to every workspace member, even though the underlying
-- KB / skill row is RLS-hidden via M-10's visibility check.
--
-- This rewrites SELECT to additionally check the underlying resource:
-- if the panel points at a private resource the caller can't see,
-- the panel is hidden too. UPDATE/DELETE/INSERT policies are unchanged
-- — those write paths are gated separately by the canvas-add API
-- guard (assertKbWritable / assertSkillWritable).

DROP POLICY IF EXISTS canvas_panels_member_select ON canvas_panels;
CREATE POLICY canvas_panels_member_select ON canvas_panels
  FOR SELECT
  USING (
    is_workspace_member(workspace_id, auth.uid(), 'viewer')
    AND CASE
      WHEN panel_type = 'knowledge-base' THEN
        EXISTS (
          SELECT 1 FROM knowledge_bases kb
          WHERE kb.id::text = (panel_data ->> 'knowledgeBaseId')
            AND (kb.visibility = 'public' OR kb.created_by = auth.uid())
        )
      WHEN panel_type = 'skill' THEN
        EXISTS (
          SELECT 1 FROM skills s
          WHERE s.id::text = (panel_data ->> 'skillId')
            AND (s.visibility = 'public' OR s.created_by = auth.uid())
        )
      ELSE TRUE
    END
  );
