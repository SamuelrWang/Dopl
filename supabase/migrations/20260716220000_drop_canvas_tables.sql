-- Drop the legacy free-form canvas.
--
-- The infinite-canvas UI (features/canvas) and its routing entity are
-- retired: the graph view was promoted to the Canvas tab and the
-- workflow backend was rebuilt on workflow_steps / workflow_step_edges
-- (20260716210000_workflow_steps), which no longer touch these tables.
--
-- Tables removed:
--   canvas_edges  — workflow connector edges (composite FK → canvas_panels)
--   canvas_panels — per-panel UI + node/workflow data
--   canvas_state  — per-workspace viewport / camera state
--   canvases      — workspace routing slugs (one 'main' row per workspace)
--
-- DROP TABLE auto-removes a table from every publication and drops its
-- policies / constraints / indexes, so CASCADE + IF EXISTS is enough for
-- a clean, re-runnable teardown. The explicit publication drops below are
-- belt-and-suspenders and guarded so the migration stays idempotent.

-- ── 1. Detach the realtime-published tables from supabase_realtime ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'canvas_edges'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.canvas_edges;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'canvas_panels'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.canvas_panels;
  END IF;
END
$$;

-- ── 2. Drop the dangling cleanup triggers FIRST ──
-- 20260502110000_cluster_attachment_safeguards attached AFTER DELETE
-- triggers to knowledge_bases / skills whose plpgsql bodies run
-- `DELETE FROM canvas_panels ...`. DROP TABLE ... CASCADE does NOT remove
-- them (they hang off other tables, and Postgres doesn't track table refs
-- inside function bodies) — left in place they'd abort EVERY kb/skill hard
-- delete (incl. the workspace-deletion cascade) with "relation does not
-- exist" once canvas_panels is gone.
DROP TRIGGER IF EXISTS kb_delete_cleanup_canvas_panels ON public.knowledge_bases;
DROP TRIGGER IF EXISTS skill_delete_cleanup_canvas_panels ON public.skills;
DROP FUNCTION IF EXISTS public.cleanup_canvas_panels_on_kb_delete();
DROP FUNCTION IF EXISTS public.cleanup_canvas_panels_on_skill_delete();

-- ── 3. Drop the tables (edges first — composite FK into canvas_panels) ──
-- NOTE (ordering): production's step graphs were ported to workflow_steps/
-- workflow_step_edges via scripts/port-workflows.mts BEFORE this migration
-- was applied. Fresh environments have no canvas data, so applying
-- 20260716210000 and this file back-to-back is safe there.
DROP TABLE IF EXISTS public.canvas_edges  CASCADE;
DROP TABLE IF EXISTS public.canvas_panels CASCADE;
DROP TABLE IF EXISTS public.canvas_state  CASCADE;
DROP TABLE IF EXISTS public.canvases      CASCADE;
