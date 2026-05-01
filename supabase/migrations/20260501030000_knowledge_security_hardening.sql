-- Knowledge security hardening (audit PR-1).
--
-- Bundles four fixes the deep audit surfaced:
--
--   1. Anon DML on `knowledge_packs` / `knowledge_pack_files` — RLS was
--      disabled on both tables and PostgREST grants gave the `anon` role
--      full SELECT/INSERT/UPDATE/DELETE. Anyone unauthenticated could
--      poison or wipe pack content. Lock to read-only for anon +
--      authenticated; service_role keeps full DML for the sync flow.
--
--   2. UPDATE policies on `knowledge_bases` / `knowledge_folders` /
--      `knowledge_entries` had `USING` only — no `WITH CHECK`. An editor
--      in workspace A could `UPDATE … SET workspace_id = <B>` and the
--      row would silently move out of A. Add `WITH CHECK` mirroring the
--      `USING` clause. App code is safe today because it uses the
--      service-role client (bypasses RLS); the policy gap matters for
--      any future user-session UPDATE.
--
--   3. Audit trail: `knowledge_entries.last_edited_by` had no policy
--      constraint. A workspace member could write someone else's name
--      into the audit trail. Enforce `last_edited_by = auth.uid()` in
--      the UPDATE WITH CHECK. Service-role bypasses; the service layer
--      always passes ctx.userId on user-session writes.
--
--   4. Realtime publication: the original migration didn't add the
--      knowledge_* tables to `supabase_realtime`. The live DB happens to
--      have folders + entries (added out-of-band), but a fresh apply on
--      a preview branch or restored backup would silently break
--      realtime. Add all three tables idempotently.
--
-- Idempotent — the DROP/CREATE on the read-all policies and the DO-block
-- guard on the publication adds let this run cleanly on any environment.

-- ════════════════════════════════════════════════════════════════════
-- 1. knowledge_packs / knowledge_pack_files lockdown
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE knowledge_packs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_pack_files ENABLE ROW LEVEL SECURITY;

-- Tighten table-level grants. Without this, RLS-bypass-by-policy still
-- requires a SELECT grant for PostgREST to expose the row at all.
REVOKE ALL ON knowledge_packs      FROM anon, authenticated;
REVOKE ALL ON knowledge_pack_files FROM anon, authenticated;
GRANT SELECT ON knowledge_packs      TO anon, authenticated;
GRANT SELECT ON knowledge_pack_files TO anon, authenticated;
-- service_role retains BYPASSRLS implicitly + full DML grants.

DROP POLICY IF EXISTS knowledge_packs_read_all      ON knowledge_packs;
DROP POLICY IF EXISTS knowledge_pack_files_read_all ON knowledge_pack_files;

-- Packs are public read-only content; everyone gets SELECT.
CREATE POLICY knowledge_packs_read_all ON knowledge_packs
  FOR SELECT
  USING (true);

CREATE POLICY knowledge_pack_files_read_all ON knowledge_pack_files
  FOR SELECT
  USING (true);

-- ════════════════════════════════════════════════════════════════════
-- 2. WITH CHECK on knowledge_* UPDATE policies
-- ════════════════════════════════════════════════════════════════════
--
-- Without WITH CHECK, an editor can flip `workspace_id` mid-UPDATE and
-- send the row to another workspace. Mirror the USING clause so the
-- post-image must also satisfy editor-membership in the destination.
-- knowledge_entries additionally pins `last_edited_by` so the audit
-- trail can't be forged.

ALTER POLICY knowledge_bases_editor_update ON knowledge_bases
  USING      (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));

ALTER POLICY knowledge_folders_editor_update ON knowledge_folders
  USING      (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (is_workspace_member(workspace_id, auth.uid(), 'editor'));

ALTER POLICY knowledge_entries_editor_update ON knowledge_entries
  USING      (is_workspace_member(workspace_id, auth.uid(), 'editor'))
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid(), 'editor')
    AND last_edited_by = auth.uid()
  );

-- ════════════════════════════════════════════════════════════════════
-- 3. Realtime publication membership
-- ════════════════════════════════════════════════════════════════════
--
-- The original Item-3 migration omitted these. Wrapped in DO blocks
-- because ALTER PUBLICATION raises if the table is already a member —
-- matches the pattern in 20260419000000_realtime_canvas_brain.sql.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'knowledge_bases'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_bases;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'knowledge_folders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_folders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'knowledge_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_entries;
  END IF;
END $$;
