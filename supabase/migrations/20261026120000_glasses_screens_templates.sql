-- ============================================================================
-- GLASSES MCP PROTOTYPE — agent-built screens + templates (2026-09-26)
-- ============================================================================
-- Extends `20261025120000_glasses_messages.sql` for `glasses_render` /
-- `glasses_update` / `glasses_*_template` (`src/features/glasses/screen-*.ts`).
-- ADDITIVE ONLY and confined to the glasses prototype's own tables:
--   * the `kind` CHECK is WIDENED to admit 'screen' (every existing row still
--     passes; no row is rewritten);
--   * `spec` is a new NULLABLE column: the agent's original blocks, kept so an
--     update can re-compile from the spec;
--   * `glasses_templates` is a new table.
-- Apply by name; replays cleanly.

ALTER TABLE public.glasses_messages
  DROP CONSTRAINT IF EXISTS glasses_messages_kind_check;

ALTER TABLE public.glasses_messages
  ADD CONSTRAINT glasses_messages_kind_check
  CHECK (kind IN ('notify', 'show', 'ask', 'screen'));

ALTER TABLE public.glasses_messages
  ADD COLUMN IF NOT EXISTS spec jsonb NULL;

CREATE TABLE IF NOT EXISTS public.glasses_templates (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  spec jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);

ALTER TABLE public.glasses_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS glasses_templates_owner_select ON public.glasses_templates;
CREATE POLICY glasses_templates_owner_select ON public.glasses_templates
  FOR SELECT USING (auth.uid() = user_id);
