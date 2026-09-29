-- ============================================================================
-- GLASSES — review hardening (2026-09-26)
-- ============================================================================
-- ADDITIVE ONLY, on the glasses prototype's own tables:
--   * `glasses_messages.updated_at` is stamped by the DATABASE clock on every
--     UPDATE (it was the app server's clock), so the device inbox cursor
--     compares one clock with itself. The one exception keeps the cursor
--     stable: the inbox's own pending → delivered flip leaves `updated_at`
--     alone, otherwise every delivery would re-surface its row.
--     Inserts already take `DEFAULT now()`; the app stops sending the column.
--   * `glasses_pairings (status, expires_at)` index for the expiry sweep and
--     the stale-row cleanup.
-- Apply by name; replays cleanly.

CREATE OR REPLACE FUNCTION public.glasses_messages_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'delivered'
     AND NEW.payload IS NOT DISTINCT FROM OLD.payload
     AND NEW.answer IS NOT DISTINCT FROM OLD.answer
     AND NEW.expires_at IS NOT DISTINCT FROM OLD.expires_at THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS glasses_messages_touch_updated_at ON public.glasses_messages;
CREATE TRIGGER glasses_messages_touch_updated_at
  BEFORE UPDATE ON public.glasses_messages
  FOR EACH ROW EXECUTE FUNCTION public.glasses_messages_touch_updated_at();

CREATE INDEX IF NOT EXISTS glasses_pairings_status_expires_idx
  ON public.glasses_pairings (status, expires_at);
